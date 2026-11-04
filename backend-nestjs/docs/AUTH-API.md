# McZEN authentication API — implemented Phase 6C contracts

This document describes the **running backend**, not the broader endpoint
proposal in `PHASE-6A-ARCHITECTURE.md`. The approved architecture and its R1
amendment are unchanged. No dashboard auth client, tenant-management API,
widget/API-key authentication or voice endpoints are included in this phase.

## Transport and common rules

- Production clients must use HTTPS, provided by the deployment's TLS edge.
  The Nest listener itself is HTTP; TLS termination is not installed here.
- User authentication is `Authorization: Bearer <accessToken>`. Refresh and
  pending credentials travel in JSON bodies, never URLs or cookies.
- All auth bodies are plain JSON objects. Unknown fields, including tenant,
  role, permission or session selectors, are rejected with a safe 400.
- Emails are trimmed and lowercased (ASCII mailbox/domain syntax, at most 255
  characters). Passwords are never trimmed, normalized or truncated. New
  passwords require 12–128 JavaScript UTF-16 code units; login accepts 1–128.
- IDs are UUIDv7 strings backed by `BINARY(16)` columns.
- Auth responses/errors are `Cache-Control: no-store`; no `Set-Cookie` is used.
  Requests reaching the guard get a server-generated `X-Request-Id`; early
  parser/CORS/edge failures may not have one. `Retry-After` accompanies 429s.
- Explicit public endpoints do not authenticate an optional bearer header.
  An invalid bearer on a protected endpoint never falls back to the demo header.

### Response types

```ts
type User = {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
};
type MemberTenant = {
  id: string;
  name: string;
  slug: string;
  tenantStatus: 'active' | 'suspended' | 'closed';
  role: string;
};
type TokenGrant = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access-token lifetime in seconds, normally 900
};
type AuthResult = TokenGrant & {
  user: User;
  activeTenantId: string | null;
  tenants: MemberTenant[];
};
```

`tenants[]` contains **only the caller's active membership rows**, excluding
soft-deleted tenants. A suspended/closed tenant may appear with its status for
display, but cannot be activated or used. Password hashes, refresh hashes,
session metadata and role catalogs are never included in these DTOs.

## Endpoint reference

### `POST /api/auth/register` — public, 201

Create a business workspace:

```json
{
  "email": "owner@example.test",
  "password": "a sufficiently long passphrase",
  "name": "Workspace owner",
  "tenantName": "Example business",
  "tenantSlug": "example-business"
}
```

`name` is optional, at most 150 characters. `tenantName` is trimmed, nonempty,
and at most 150 characters before trimming. `tenantSlug` is 2–63 lowercase
letters/digits/hyphens, starting and ending with a letter/digit.

The user, active workspace, settings, owner membership, email-verification
token, session and refresh token are created in **one database transaction**.
The response is `AuthResult`, initially **`activeTenantId: null`** even for a
new workspace; activate it using the endpoint below, or log in again.

Invite registration instead supplies `{ email, password, name?, inviteToken }`
or the `invite_token` alias, **not both**, and no workspace fields. The existing
single-use pending token must bind the normalized mailbox, active tenant and
an allowed tenant role. Clients cannot choose those bindings. Invite issuance
is not implemented; its management workflow belongs to 6D.

Errors: 400 invalid input; 401 invalid/unusable invitation; 409 generic
`This email or workspace identifier is already registered.`; 503 unavailable
database/mail configuration; 429 quota. Registration's 409 still permits
account/workspace availability inference; login/reset errors do not expose it.

Verification is sent after commit. A transport delivery failure logs only
`AUTH_MAIL_DELIVERY_FAILED` and **does not undo registration or change its 201**.
There is no durable mail outbox/resend endpoint; see deployment concerns below.

### `POST /api/auth/login` — public, 200

Body: `{ email, password }`. Returns `AuthResult`.

- Exactly one active membership, whose tenant is active: select that tenant.
- Several active membership rows, no membership, or a single unusable tenant:
  return identity-only access with `activeTenantId: null`. No multi-tenant guess.
- Each login creates an independently revocable device session.
- Wrong, unknown, disabled/erased and currently locked accounts all return the
  same 401: `Invalid email or password.` Unknown accounts perform a dummy
  Argon2id verification; known accounts verify even when disabled/locked.
- Five failures within 15 minutes trigger a one-minute cooldown. Further
  failures in the window escalate 2, 4, 8, … minutes, capped at 60. Success
  clears counters/window/lock and updates `last_login_at`. Failure evidence
  commits before the 401 is returned.

Malformed object/unknown-field errors are 400; invalid credential values use
the generic 401. A uniform HTTP response is not a formal whole-request timing
guarantee; database/transport scheduling still varies.

### `POST /api/auth/refresh` — public, 200

Body: `{ refreshToken }`. Returns **only** `TokenGrant`.

The `mzr_` token has 32 random bytes and canonical base64url encoding. Only its
plain SHA-256 digest is stored. A valid use inserts a same-family successor,
marks the old row used and links `replaced_by`. The successor's `replaced_by`
starts NULL. The user lock serializes rotation/logout/reset/activation state;
rotation also uses row locks and a conditional write.

The access token reflects the session's current selection. Rotation **never
extends the original absolute session/family expiry**, normally 30 days.
Reuse of an already-used token commits family revocation plus session
quarantine **before returning 401**. Other device sessions are unaffected.
Concurrent refreshes of one token therefore result in one rotation and one
reuse rejection, and the family becomes unusable. Clients must serialize
refresh calls and atomically replace their stored token; blindly retrying an
old token after an uncertain network result will force re-login.

Missing, unknown, wrong-class, expired, revoked and otherwise unusable tokens
return generic 401 `Authentication required.`. A selected tenant that is
unavailable returns neutral 403. Missing/inactive membership returns 401.
An identity-only session can refresh without tenant membership.

### `POST /api/auth/logout` — access bearer, 200

Body may be omitted or `{}`; optional `{ allSessions: boolean, refreshToken? }`.
Returns `{ "success": true }`.

Default: mark the authenticated session and all its refresh tokens revoked,
invalidating access on the next request. `allSessions: true` also increments
`users.token_version` and revokes all device sessions/tokens for that user.
The optional refresh token is validated for shape but **never selects another
session/user**. This implementation marks rows revoked rather than deleting
them; eventual purging is not implemented.

Requires a live identity/session, but not usable tenant membership. A missing,
expired or already-revoked bearer is 401, not an unauthenticated idempotent
logout. A stale tenant hint is 409: refresh before retrying sign-out.

### `GET /api/auth/me` — access bearer, 200

Returns:

```ts
{
  user: User;
  activeTenantId: string | null;
  permissions: string[];
  tenants: MemberTenant[];
}
```

Identity remains accessible without active membership, including after a
tenant is suspended. When the selected membership/tenant is unusable, the
**response** has `activeTenantId: null` and empty permissions; the stored
session selection is not silently changed. This identity-only handler creates
no tenant ALS context. Permission lists are display information, not credentials.

### `POST /api/auth/tenants/:tenantId/activate` — access bearer, 200

Body: empty/omitted object only. Returns:

```ts
{ accessToken: string; expiresIn: number; permissions: string[] }
```

The URL is a membership-checked **selection request**, never an execution
context override. The transaction verifies the live user/session, active
membership and active tenant, updates `user_sessions.active_tenant_id`, and
mints a fresh access JWT. It does not rotate the refresh token.

Foreign, unknown, malformed or non-active-member targets all return the same
404. A known member's suspended/closed/soft-deleted tenant returns neutral 403.
Previously issued JWTs whose `tid` differs from the stored selection now return
409 on protected endpoints: `The access token is stale. Refresh it and retry.`
Refresh is bearer-less and can recover the current selection.

### `POST /api/auth/forgot-password` — public, 200

Body: `{ email }`. For known, unknown, disabled and malformed email values:

```json
{
  "success": true,
  "message": "If the account is eligible, password reset instructions will be sent."
}
```

Eligible active users get a hashed, single-use, 60-minute `mzp_` reset token.
Delivery is non-blocking and never changes the public response based on mailbox
eligibility. No new password, identity or token is returned normally.
Invalid body shape/unknown keys are 400. Unconfigured SMTP in production returns
a uniform 503 **before mailbox lookup**, including for unknown mailboxes.

### `POST /api/auth/reset-password` — public, 200

Body: `{ token, newPassword }`. Returns `{ "success": true }`.

A valid unexpired password-reset token atomically changes the Argon2id digest,
increments `token_version`, clears lockout state, revokes every session/refresh
token, and consumes **all** outstanding reset tokens for that user. Concurrent
uses permit only one change. A notification is sent non-blockingly afterward.
Password validation is 400; expired/used/wrong-purpose/invalid token is generic
401. Email verification and refresh tokens cannot act as reset credentials.

### `POST /api/auth/verify-email` — public, 200

Body: `{ token }`. Returns `{ "success": true }`. An unexpired, unused,
email-verification pending token marks its active user's mailbox verified and
is consumed atomically. Registration tokens last 24 hours. Used/expired,
wrong-purpose or invalid credentials return generic 401. Reset credentials
cannot act as verification tokens. Verification does not itself select a tenant.

## Authorization and tenant isolation

The global guard defaults **every unannotated application route** to verified
tenant access. Explicit identity-only/public/platform metadata changes that
mode. `@CurrentUser()` reads a non-enumerable immutable symbol-backed identity;
`@CurrentTenant()` reads the immutable ALS snapshot established at the actual
Nest/RxJS handler subscription, callbacks and teardown.

JWT claims are only `sub`, `sid`, `tid`, `iat`, `exp`, `nbf`, `iss`, `aud`.
They carry no email, roles or permissions. HS256, `typ: JWT`, named `kid`,
canonical encoding, issuer `mczen-ai`, audience `mczen-dashboard`, signature,
UUIDv7 identity and temporal ordering are verified. Expiry has no grace;
issuance/`nbf` permit at most five seconds of positive clock skew.

Every protected request rechecks active user, bound/live/unexpired session and
matching `token_version`. Tenant mode additionally checks the selected active
membership, active/non-deleted tenant and current MySQL role grants. Required
permissions are all exact `resource:action` matches, combining class and method
metadata; `*` has no special meaning.

| Seeded role | Tenant grants | Distinction |
| --- | ---: | --- |
| `tenant:owner` | 21 | All accepted tenant permissions |
| `tenant:admin` | 19 | No `api_keys:manage` or `billing:manage` |
| `tenant:editor` | 16 | Content administration subset |
| `tenant:member` | 12 | Read subset plus conversations write |
| `tenant:viewer` | 11 | Read-only subset |
| `platform:admin` | 0 | Reserved platform role, no wildcard |

`@RequirePlatform(...)` requires an active DB-assigned membership with the exact
reserved role and `roles.is_platform=1`, anchored to an active/non-deleted tenant.
An owner/admin does not imply staff. The platform handler receives **no tenant
ALS context** and cannot bypass `TenantScopedRepository`. There is no staff
onboarding/table or platform-management endpoint. The accepted seeds remain
unchanged; a separate approved provisioning policy is needed for real staff.

Headers, query/body tenant IDs, model arguments and permission arrays cannot
override the verified context. Tenant-owned queries must include the ALS tenant
predicate; a foreign resource ID returns the same 404 as an unknown one. 6C
tests exercise this through a test-only adapter over existing `tenant_settings`.
Domain CRUD repositories, write subscriber, persistent knowledge/tools and
background workers arrive in their approved later phases. The base class does
not magically rewrite arbitrary raw SQL; review and domain-specific isolation
tests remain mandatory.

### Existing agent routes

`POST /api/agent/ask` still accepts `{ question }` (trimmed, 1–2000 characters)
and returns 201 with exactly `{ success, answer, model, toolCalls, sources }`.
Additional tenant/permission fields are ignored, not used as identity. A valid
JWT invokes the unchanged agent and executor through verified context.

`GET /api/agent/tools` returns `{ success: true, tools }`; **`resolvedDevTenant`
is removed**. The existing catalogue's tenant filtering remains unchanged.
No new route-level permission is added to these legacy routes; tool execution
continues to enforce DB-derived context permissions in the protected executor.

The explicit local demo exception applies **only** to these two routes, with
no bearer header, `MCZEN_ALLOW_DEV_HEADER=1`, non-production, a raw peer equal
to `127.0.0.1`, `::1` or `::ffff:127.0.0.1`, and no `Forwarded`,
`X-Forwarded-For`, `X-Real-IP` or `X-Forwarded-Host`. It uses the existing
**database-free** `tenant-a`…`tenant-d` demo map, not DB-seeded tenants as proposed
in 6A §7.2. This is a disclosed Phase 5 compatibility deviation, never user
authentication or production access. Keep demo-enabled listeners inaccessible
to external proxies/users; a local proxy that strips every forwarding header
cannot be distinguished from a direct local caller. JWT UUID tenants are not
aliased to demo catalogue IDs. Shared knowledge remains public demo content,
not production tenant-private data.

## Configuration and deployment runbook

See `.env.example` for the **actual** supported variables. `.env` is optional;
existing process values win. Bootstrap loads it **before importing AppModule**.
No real credentials or `.env` were created by this phase.

1. Use a supported Node runtime (verified locally on Node 22), use installed
   local MySQL 8, and supply complete `DB_*` variables. XAMPP MariaDB 10.4 is
   not schema-compatible: it rejects the accepted `utf8mb4_0900_ai_ci`
   collation. Do not silently change accepted migrations or substitute that
   server for MySQL 8 verification. Use least-privilege runtime and
   separate migration credentials, not the disposable test root user.
2. Back up and rehearse the accepted 6B→6C upgrade. Run `npm run migration:run`,
   then `npm run migration:show` and `npm run migration:check`. Expect five
   applied, none pending/unknown. Application boot never runs migrations and
   always has `synchronize: false`.
3. Set `NODE_ENV=production`, a CSPRNG-generated `JWT_SECRET` of at least 32
   UTF-8 bytes, and an exact HTTPS `MCZEN_CORS_ORIGINS` allowlist. Missing/short
   production signing keys or missing DB configuration prevent boot. The known
   old example signing-key placeholder is rejected in every environment.
4. Configure SMTP host/from/optional paired user/password, verified implicit
   TLS (default port 465), or required STARTTLS (587). Debug/transport logging is
   disabled. Verify delivery and failure recovery before inviting real users.
5. Build with `npm run build`; run with `npm run start:prod`. Deploy behind TLS,
   shared rate/concurrency limits, bounded request timeouts/body sizes and
   properly redacted access logs. Backend `trust proxy` is deliberately false.
6. Do not enable demo or pending-token exposure flags on publicly reachable
   deployments. No cookie credentials means there is no cookie-session CSRF
   mechanism; the client must protect in-memory bearer/refresh tokens from XSS
   and avoid persistent browser storage and logs. The React client is unchanged.

### Signing-key rotation

Keys/configuration are read at startup. Current key signs; optional previous
key verifies. KIDs are distinct 1–64 URL-safe characters.

For rolling deployment: first distribute the **new key as the secondary** on
all replicas while the old key remains current, then make new/current and
old/previous on every replica. Wait at least the maximum 15-minute access TTL
plus clock/deployment headroom from the last old-key signer, then remove the
previous key. This avoids a replica signing tokens another cannot verify.
Environment pairs are `JWT_SECRET` + `JWT_CURRENT_KID` and
`JWT_PREVIOUS_SECRET` + `JWT_PREVIOUS_KID`. Refresh-token hashes do not depend
on signing keys. Emergency removal of a compromised key rejects its JWTs;
revoke affected sessions/token families too, rather than treating key rotation
as refresh-credential revocation. Development's missing key is ephemeral;
tokens do not survive restarts and are unsuitable across replicas.

### Rate limits and CORS

All buckets are bounded **process-local sliding 60-second windows**; only
hashed IP/session/tenant/mailbox/refresh identifiers are retained. Active keys
are not evicted to reset quotas; capacity exhaustion fails closed with 429.

| Scope | Default / maximum per minute |
| --- | ---: |
| Raw socket IP, pre-parser/CORS/routing | 300 |
| Verified session | 120 |
| Verified tenant, across sessions | 600 |
| Register / forgot / reset | 5 each, per IP |
| Login / verify | 10 each, per IP |
| Refresh | 30, per IP |

Login/forgot also limit normalized mailbox hashes across peers; refresh also
limits the presented credential hash. Configured general limits and the
10,000-key capacity can be reduced, not raised above their ceilings.
Forwarding headers never change peer identity or reset quotas. A reverse proxy
therefore shares one IP quota; trust-proxy support must not be enabled without
a separately reviewed trusted-proxy policy. Multi-instance deployments require
shared edge limits. Rate limiting is not an Argon2/Ollama concurrency semaphore
or a tenant billing quota; those controls are not claimed here.

CORS accepts only exact origins (at most 32), no wildcard/credentials/path.
Development defaults to the two existing localhost:5174 origins. Production
allows HTTPS only and denies browser origins by default. Non-browser callers
without Origin are allowed but still authenticate. The dev header is allowed
by CORS only for an explicitly enabled non-production configuration. Methods
are GET/POST/OPTIONS; exposed headers are `X-Request-Id` and `Retry-After`.
Widget origin policy is not implemented. CORS is not user authentication.

### Remaining production concerns

- SMTP is configured by environment, not connected/verified in this work.
  Registration and forgot-password fail uniformly with 503 when unconfigured
  in production. If a configured transport later fails, registration stays
  committed and notifications fail non-blockingly, with a fixed failure code.
  There is **no durable outbox, automatic retry, resend endpoint or delivery
  receipt**, so a failed verification/reset delivery may require operator
  assistance/new reset issuance. This is a readiness gap, not an atomic SMTP
  guarantee. Pending tokens are never printed as a workaround.
- No retention scheduler yet purges sessions, refresh or pending-token history.
  Never purge used refresh rows while their live family can still be reused;
  doing so would discard reuse evidence. Design bounded cleanup in a later phase.
- The accepted MySQL config has no DB TLS settings; use an appropriate private
  local network/tunnel until verified DB TLS configuration is separately added.
  The test container and mock transport prove behavior, not deployed production
  availability, failover, throughput or secret rotation operations.
- No staff provisioning, distributed quota store, durable audit, tenant CRUD,
  subscriber, background authorization, widget/API-key/voice authentication,
  persistent agent domains or dashboard JWT client are included.
- `NestJS Observe` is not registered and no production telemetry was consulted
  or claimed. Before adding telemetry, redact auth bodies/headers, SQL
  parameters and notification content. This phase makes no production-health claim.
- Native Argon2id uses the approved 19,456 KiB / 2 / 1 parameters; deployment
  hardware latency and simultaneous hashing capacity still need calibration.
- HS256 is intentionally narrow and implemented with Node crypto plus strict
  validation, not an external JOSE library; security review remains advisable.

## Verification commands

```text
npm test -- --runInBand
npm run test:e2e -- --runInBand
npx tsc --noEmit --incremental false
npm run build
```

Real-MySQL tests are opt-in. Supply a complete `DB_*` environment for the
installed local MySQL 8 server, with CREATE/DROP DATABASE permission and
`RUN_DB_TESTS=1`, then run the full
`npm test -- --runInBand` again. The three database suites create/drop their own
scratch schemas; SMTP and Ollama are mocked, **not MySQL/auth/authorization**.
Do not point these tests at production. See `PHASE-6C-AUTHORIZATION.md` for
executed results, the current local MariaDB compatibility blocker, file
inventory, integrity verification and approval boundary. Historical MySQL 8
passes do not establish a passing integration run on the installed MariaDB.

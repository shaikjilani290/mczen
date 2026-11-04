# Phase 6C — Authentication and tenant authorization

**Status: server-side implementation complete; awaiting approval. Renewed
database verification is PARTIAL / BLOCKED on runtime responsiveness.** The
user-selected Docker endpoint `127.0.0.1:13306` authenticated successfully and
verified MySQL **8.4.13** plus the approved collation. Initial migration checks
passed, but the real-DB test/reapplication run hit a host deadline. The endpoint
now accepts TCP without a MySQL greeting; test completion, reapplication and
scratch cleanup are not verified.

The user later authorized a restart of **only** the selected container. The
single restart request timed out after **90 seconds**; completion is unknown,
Docker management is unresponsive and the MySQL endpoint still gives no greeting.

The earlier XAMPP preflight identified **MariaDB 10.4.32**, which rejects the
approved `utf8mb4_0900_ai_ci` collation with errno 1273. No accepted migration
or existing database was changed to work around it. The
[database verification report](PHASE-6C-DATABASE-VERIFICATION.md) retains the
unexecuted native-installation proposal and records the current Docker path
in section 7. No new native installation or MariaDB adaptation is needed for
the user's latest server selection.

The complete backend suite previously passed against real **MySQL 8.4.13**.
Those results were obtained before the user directed that database work use
installed local MySQL rather than Docker; they are historical evidence, **not
a passing renewed verification run**. No Docker operations occurred during the
native-only follow-up. After the user's later explicit Docker authorization,
inspection attempts and disposable-schema verification were performed; no
existing application database was migrated. The subsequent narrowly authorized
container restart request has no verified outcome; no deletion/recreation or
unrelated service restart was attempted. Production deployment readiness is
not claimed.

References: approved [Phase 6A, including R1](PHASE-6A-ARCHITECTURE.md), accepted
[Phase 6B](PHASE-6B-FOUNDATION.md), and [actual API contracts/runbook](AUTH-API.md).
The eleven sections below are the requested implementation/verification report.

## 1. Inspection and scope

- Reviewed 6A §§7–9, the 6C roadmap and R1's unchanged authentication phase.
  MySQL 8, shared-schema isolation and the later voice/domain phase boundaries
  remain the approved targets.
- Reviewed accepted Domain A/B tables, binary UUIDv7 IDs, UTC timestamps,
  indexes/FKs, migration registry, session/refresh state and the seeded
  role/permission matrix. Migrations 1–3 and their seeds remain unchanged.
- Inspected existing controllers, request context, tool authorization,
  AgentService/Ollama behavior, runtime configuration, Phase 5 security tests,
  foundation tests and the React frontend's lack of a JWT/session client.
- Recorded the starting Git state and SHA-256 baselines before protecting the
  agent/executor/configuration, accepted migrations and existing frontend work.
- Found and corrected actual configured-DB Nest dependency injection: the
  TypeORM child module could not inject a parent-only `MYSQL_CONFIG` provider,
  and a default DataSource self-alias created a cycle. Real AppModule startup
  was subsequently tested; authentication tests do not substitute a fake DB.
- Found the IP limiter originally ran after parsing. Shared HTTP setup now
  installs it before parsing, CORS and routing. Bootstrap loads optional `.env`
  before importing AppModule, and runtime SQL/parameter logging is suppressed.

Scope is server-side authentication/authorization only. No AgentService,
ToolExecutorService, Ollama integration, React frontend, voice/STT/TTS,
dashboard, new agent domains or Phase 6D implementation was undertaken.

## 2. Files created, modified and retained

All paths below are relative to `backend-nestjs/`. Because the entire backend
is untracked, this is an implementation inventory, not a Git-derived diff.

### Created

| Files | Purpose |
| --- | --- |
| `src/auth/auth-context.ts`, `src/auth/auth.decorators.ts` | Immutable symbol-backed request snapshots, auth modes, parameter/permission decorators |
| `src/auth/auth.dto.ts`, `src/auth/auth.controller.ts` | Strict credential/body validation and nine auth endpoints |
| `src/auth/auth-store.service.ts`, `src/auth/auth.service.ts` | Parameterized DB access, transactional credential/session flows and current DB grants |
| `src/auth/password.service.ts`, `src/auth/token.service.ts` | Native Argon2id, strict JWTs, opaque credential generation/hashing |
| `src/auth/auth.mailer.ts`, `src/auth/auth.module.ts` | Environment-configured SMTP and global security pipeline registration |
| `src/auth/cors.config.ts`, `src/auth/http.config.ts`, `src/auth/loopback.ts` | Exact origins, pre-parser HTTP setup and hardened local-only gates |
| `src/auth/rate-limit.service.ts`, `src/auth/safe-http-exception.filter.ts` | Bounded quotas and sanitized HTTP/provider/parser failures |
| `src/auth/auth.dto.spec.ts`, `src/auth/password.service.spec.ts`, `src/auth/token.service.spec.ts` | Input, hashing and JWT/opaque-token tests |
| `src/auth/auth.mailer.spec.ts`, `src/auth/cors.config.spec.ts`, `src/auth/rate-limit.service.spec.ts`, `src/auth/safe-http-exception.filter.spec.ts` | Transport configuration, origin, quota and logging tests |
| `src/common/tenant/tenant-context.guard.ts`, `src/common/tenant/tenant-context.guard.spec.ts` | Default-deny authentication and DB-backed authorization |
| `src/common/tenant/tenant-context.interceptor.ts`, `src/common/tenant/tenant-context.interceptor.spec.ts` | ALS at actual RxJS subscription/callbacks/teardown |
| `src/database/migrations/1740000000004-AuthPendingTokens.ts` | One typed, hash-only pending-credential table |
| `src/database/migrations/1740000000005-AuthSecurityState.ts` | Failure-window timestamp and backfilled session token version |
| `src/database/migrations/auth-migrations.spec.ts` | Additive migration shape/backfill/revert assertions |
| `test/database/mysql-auth.spec.ts` | 56 real-DB auth/authz HTTP tests, using actual AppModule DI |
| `test/database/mysql-auth-migrations.spec.ts` | Three accepted-6B upgrade/backfill/revert rehearsals |
| `docs/AUTH-API.md`, `docs/PHASE-6C-AUTHORIZATION.md` | Actual contracts, operational limits and this approval report |

### Modified integrations and tests

- `src/app.module.ts`, `src/app.controller.ts`: install the security pipeline;
  explicitly annotate only root/health as public.
- `src/main.ts`: environment-before-module loading, shared HTTP setup and
  retained shutdown hooks.
- `src/database/database.module.ts`: fix configured-DB DI, remove the self-alias
  and disable runtime SQL logging without changing accepted migrations.
- `src/agent/agent.module.ts`: export the existing context service to the guard.
- `src/agent/agent.controller.ts`, `src/agent/agent.controller.spec.ts`: use
  verified context, explicitly gate the two demo routes, remove
  `resolvedDevTenant` and preserve the ask response contract.
- `src/agent/context/tenant-context.service.ts`,
  `src/agent/context/tenant-context.service.spec.ts`: normal resolution delegates
  to ALS; the separate demo resolver requires all local-only gates.
- `src/database/migrations/index.ts`,
  `src/database/migrations/migrations.spec.ts`: append refinements after the
  unchanged three-migration baseline and preserve baseline assertions.
- `src/database/mysql-config.spec.ts`,
  `test/database/mysql-foundation.spec.ts`: correct existing test typings;
  retain the real database assertions.
- `jest.config.ts`: map emitted `.js` relative imports to TypeScript sources
  for NodeNext/Jest; `test/app.e2e-spec.ts`: use shared HTTP setup and test the
  hardened demo/response behavior.
- `package.json`, `package-lock.json`: Argon2/SMTP dependencies;
  `.env.example`, `README.md`: supported settings, current contracts and the
  local MySQL/MariaDB compatibility boundary.

Installed runtime dependencies: `@node-rs/argon2` 2.2.2 and `nodemailer` 10.3.1;
SMTP typings use `@types/nodemailer` 8.0.2. Existing MySQL/TypeORM remain.
The numeric Argon2id discriminant `2` avoids the package's ambient const-enum
incompatibility with `isolatedModules`; PHC output is tested as Argon2id.

Retained foundation seams: `src/common/ids/uuid.ts`,
`src/common/tenant/tenant-context.store.ts` and
`src/common/tenant/tenant-scoped.repository.ts`. No duplicate identity,
membership, session or refresh table was introduced.

## 3. Authentication and revocation flow

### Passwords and access credentials

- Native Argon2id: **19,456 KiB memory, time cost 2, parallelism 1**, fresh
  random salt and self-describing PHC digests. New passwords are 12–128 UTF-16
  code units; passwords are never trimmed or silently truncated.
- Access JWT: HS256, strict canonical encoding/signature/claims, `typ: JWT`,
  named current/previous `kid`, issuer `mczen-ai`, audience `mczen-dashboard`.
  Only `sub/sid/tid/iat/exp/nbf/iss/aud` claims are allowed; no email, role or
  permission claims. IDs are UUIDv7. Expiry has no grace; issuance/`nbf` allow
  at most five seconds of positive clock skew.
- Access TTL defaults to **900 seconds**, configurable 600–900. Signing keys
  require at least 32 UTF-8 bytes; production requires an operator-supplied
  key. Development may use a per-process ephemeral key. The former known
  example placeholder is rejected, not accepted as a deployment secret.
- Refresh/session TTL defaults to **30 days**, configurable 1–2,592,000 seconds.
  Invalid security configuration fails closed. Refresh rotation and activity
  metadata do not extend the original absolute session horizon.

### Identity/session lifecycle

1. **Register:** atomically create the user, workspace/settings/owner membership
   or validated invite membership, verification credential, session and refresh
   credential. Initial selection is null. Duplicate email/slug rolls back
   without orphan rows and returns one generic registration-conflict message.
2. **Login:** normalize email, verify the digest outside row locks, then lock
   and reread the user. Reject a digest replaced during verification. Unknown
   accounts perform dummy Argon2 verification; disabled/locked accounts also
   verify. Wrong/unknown/disabled/locked credentials have identical 401 bodies.
   Only one listed active membership row with an active tenant auto-selects;
   multiple rows or no usable tenancy return identity-only access without
   guessing a tenant.
3. **Lockout:** five failures inside a 15-minute window cause a one-minute
   cooldown, escalating 2/4/8/... minutes up to 60 for further failures in the
   window. Failure evidence commits before the error; success clears lockout
   state. Uniform bodies/cost do not establish perfect whole-request timing.
4. **Refresh:** `mzr_` plus 32 random bytes; only its plain SHA-256 digest is
   stored. User/session/token locks and a conditional update permit one
   rotation; link the consumed row to a same-family successor. Used-token
   reuse commits family revocation and `reuse_detected` session quarantine
   before returning 401. Other device sessions stay valid. Concurrent uses
   therefore yield one rotation and one rejection, then quarantine the family.
5. **Logout:** revoke the authenticated session and its refresh rows; an optional
   refresh token never selects a foreign session. All-session logout also bumps
   `users.token_version` and revokes every device session/token for that user.
   Every later protected request rechecks live DB state, not JWT expiry alone.
6. **Reset/verify:** hash-only typed `mzp_` pending tokens; reset lasts 60 minutes,
   verification 24 hours. Purpose, expiry and single use are enforced. Reset
   atomically replaces the password, bumps token version, revokes all sessions
   and consumes all reset links. Concurrent reset permits one version bump.
7. **Invites:** server-issued mailbox/tenant/tenant-role bindings only;
   `inviteToken` or `invite_token`, never both. Wrong mailbox, platform role,
   expired or used invitations cannot create a user. Issuance remains for 6D.

Migration 4 realizes 6A's pending-token pattern as `auth_pending_tokens` with
hash uniqueness, purpose, expiry and a cleanup index. Migration 5 adds
`users.login_failure_window_started_at` and nullable session `token_version`,
backfills each session from its user, then enforces NOT NULL. Existing user
digests/versions are preserved. MySQL DDL auto-commits; upgrades require backup
and rehearsal, never silent application-boot migration.

## 4. DB-backed roles, permissions and platform access

| Accepted role | Seeded grants | Boundary |
| --- | ---: | --- |
| `tenant:owner` | 21 | All accepted tenant permissions |
| `tenant:admin` | 19 | Excludes `api_keys:manage`, `billing:manage` |
| `tenant:editor` | 16 | Content administration subset |
| `tenant:member` | 12 | Read subset plus conversations write |
| `tenant:viewer` | 11 | Read-only subset |
| `platform:admin` | 0 | Explicit reserved role; no wildcard |

`TenantAuthGuard` is global and defaults unannotated application handlers to
authenticated tenant access. Every protected request verifies live active user,
session ownership/expiry/revocation/version and consistency between JWT `tid`
and stored session selection. Tenant mode additionally checks live active
membership, active/non-deleted tenant and current MySQL grants.

`@RequirePermission()` requires every exact `resource:action` grant, combining
class and method metadata. Roles/grants are reread, so downgrades/removals take
effect on subsequent requests without waiting for JWT expiry. Client role or
permission arrays and `*` do not grant access. Contradictory public/identity-only
permission metadata fails closed rather than weakening checks.

`@RequirePlatform()` requires the exact active DB-assigned `platform:admin`
membership, `roles.is_platform=1`, and an active/non-deleted anchor tenant.
An owner/admin is not platform staff. Platform handlers receive no tenant ALS
context and no tenant-repository bypass; required platform permissions are
still checked, and unchanged seeds grant none. No staff provisioning policy or
platform-management endpoint is implemented. This constrained bridge over the
accepted schema is not a claim of completed production staff administration.

Identity-only `me`, logout and activation require a live identity/session and
selection consistency but remain accessible without usable tenant membership.
A stale selection JWT returns 409 even on those handlers; bearer-less refresh
can recover the current selection.

## 5. Tenant isolation and IDOR protection

- The guard attaches non-enumerable, symbol-backed, frozen identity/context
  snapshots, including copied/frozen permission arrays. Request JSON, query
  fields and tenant headers cannot overwrite them.
- The interceptor establishes the retained AsyncLocalStorage store during the
  actual RxJS handler subscription, notifications and teardown. Normal
  `TenantContextService.resolve()` accepts no client metadata and delegates to
  that verified scope; a guard-only `enterWith()` is not relied upon.
- `TenantScopedRepository.currentTenantId()` still fails closed outside scope.
  The real-DB test-only adapter over existing `tenant_settings` uses both the
  resource ID and verified tenant predicate. Foreign and unknown IDs produce
  identical 404s. No test-only controller/adapter is registered in production.
- Activation treats its URL as a membership-checked selection request, not an
  execution-context override. Stored selection is authoritative; old JWT hints
  return 409. Foreign/unknown/malformed activation targets share a 404.
- Tests cover simultaneous tenant/user requests across RxJS and DB awaits,
  immutable snapshots, membership deletion/loss, tenant suspend/close/delete,
  user disable/erase, foreign session binding and no context leakage afterward.

**Disclosed 6A compatibility deviation:** the two explicitly annotated agent
routes retain the existing database-free `tenant-a`...`tenant-d` Phase 5 demo
map rather than 6A §7.2's proposed DB-seeded demo identities. All gates are
required: non-production, explicit `MCZEN_ALLOW_DEV_HEADER=1`, direct loopback
socket, no forwarding headers and no bearer header. Invalid bearers never
fall back. Production rejects the header even when the flag is set.
This is not authentication and needs approval as a compatibility exception.
A local proxy stripping every forwarding header is indistinguishable from a
direct local caller; demo-enabled listeners must not be publicly reachable.

The repository base does not rewrite arbitrary SQL. Later domain repositories,
write subscriber and background authorization still need their own predicates,
composite-FK integration tests and review. UUIDv7 is not the isolation control.
Existing shared knowledge is public demonstration content; UUID tenant IDs are
not aliased to the Phase 5 catalogue's `tenant-a`/`tenant-b` IDs.

## 6. Actual endpoint contracts

Full body fields, response types and error semantics are in [AUTH-API.md](AUTH-API.md).
The implemented endpoints are:

| Endpoint | Authentication | Success |
| --- | --- | --- |
| `POST /api/auth/register` | Public | 201: user, access/refresh tokens, expiresIn, null initial selection, memberships |
| `POST /api/auth/login` | Public | 200: user, access/refresh tokens, expiresIn, selection and memberships |
| `POST /api/auth/refresh` | Opaque body credential | 200: accessToken, refreshToken, expiresIn only |
| `POST /api/auth/logout` | Access bearer, identity-only | 200: `{ success: true }`; current or all device sessions |
| `GET /api/auth/me` | Access bearer, identity-only | 200: user, activeTenantId, permissions, memberships |
| `POST /api/auth/tenants/:tenantId/activate` | Access bearer, identity-only | 200: accessToken, expiresIn, permissions; no refresh rotation |
| `POST /api/auth/forgot-password` | Public | 200: fixed eligibility-neutral success/message |
| `POST /api/auth/reset-password` | Typed pending body credential | 200: `{ success: true }` |
| `POST /api/auth/verify-email` | Typed pending body credential | 200: `{ success: true }` |

`tenants[]` is `{ id, name, slug, tenantStatus, role }`, only the caller's active
memberships, excluding soft-deleted tenants. `user` is
`{ id, email, displayName, emailVerified }`. `me` reports null/empty permissions
for unusable tenancy without silently changing stored session selection.

Transport is bearer/body credentials, never cookies or credential URLs. Auth
body objects reject unknown fields; passwords/hashes/session internals are
never response DTO fields. Auth responses/errors are no-store. Pending tokens appear
only under a separately explicit non-production direct-loopback test flag;
neither that flag nor the demo flag authorizes production exposure/access.

`POST /api/agent/ask` retains `{ question }` and the 201 response fields
`{ success, answer, model, toolCalls, sources }`. Additional tenant/permission
fields are ignored, never used as identity. `GET /api/agent/tools` returns
`{ success, tools }`, with `resolvedDevTenant` removed. No new legacy-route
permission is invented; the unchanged executor still checks DB-derived tool
permissions. Root and health remain explicitly public liveness responses,
not comprehensive database/SMTP/Ollama readiness checks.

## 7. Security controls and operational limits

- **HTTP edge:** raw-peer IP limit before body parsing/CORS/routing, including
  unknown paths and OPTIONS. A private request symbol prevents duplicate IP
  charging by the guard. Session and tenant limits still apply after auth.
- **Quotas:** sliding 60-second process-local windows; defaults/ceilings are
  IP 300, session 120, tenant 600, 10,000 retained keys. Fixed per-IP auth limits
  are register 5, login 10, refresh 30, forgot 5, reset 5, verify 10. Login/forgot
  also limit normalized mailbox hashes; refresh also limits credential hashes.
  Keys are hashed; active quotas are not evicted; full capacity fails closed
  with 429 and `Retry-After`. These are not shared cluster/billing quotas.
- **Proxy/CORS:** `trust proxy=false`; forwarding headers cannot reset quotas
  or satisfy local-only gates. Exact origins only, at most 32; production is
  HTTPS-only and defaults to no browser origins. No credential cookies.
  Origin-less API clients are allowed but still authenticate. A reverse proxy
  shares one raw-peer IP quota until an approved trusted-edge policy exists.
- **Failure/log discipline:** generic credential/reset failures, safe validation
  messages, no-store responses, server-generated request IDs after the guard,
  safe malformed/oversized JSON responses and fixed unexpected-error codes.
  Runtime SQL logging and SMTP debug/logging are disabled. Passwords, tokens,
  raw parser bodies and ORM parameters are neither returned nor logged by this
  auth pipeline. Early edge/parser/CORS errors may have no request ID.
- **SMTP:** environment-configured verified TLS/STARTTLS and bounded transport
  timeouts. Unconfigured production register/forgot uniformly fail with 503
  before identity lookup. Registration delivery is post-commit; failure logs
  only `AUTH_MAIL_DELIVERY_FAILED` and preserves 201. Reset/change notifications
  are non-blocking. Real transport delivery remains unverified.
- **Keys/expiry:** current/previous named signing keys and rolling rotation
  runbook; live DB revocation and token-version checks; minute-throttled session
  activity writes that never prolong expiry. No secrets were added to `.env`.
- **Argon calibration:** 20 sequential native verifies on this development
  machine measured median **83.9 ms**, p95 **105.7 ms**. This is not production
  throughput, formal timing equality or a concurrent-hashing capacity test.

## 8. Tests and verification actually executed

Final implementation results, before the user's local-only database direction:

| Command/check | Executed result |
| --- | --- |
| `npm test -- --runInBand`, no DB environment | **24 suites / 369 tests passed**; three opt-in DB suites / 70 tests skipped intentionally |
| Same complete command with disposable real MySQL and `RUN_DB_TESTS=1` | **27 suites / 439 tests passed**, no skipped tests |
| `npm run test:e2e -- --runInBand` | **19/19 Phase 5 HTTP tests passed**, shared HTTP setup, Ollama mocked |
| `npm run build` | Passed, exit 0 |
| `npx tsc --noEmit --incremental false` | Passed, exit 0 |
| `npm run lint` | Passed, exit 0; **14 warnings**, no lint errors; legacy/test-style warnings remain |

The real-DB run used Windows, Node **v22.23.4**, MySQL **8.4.13**, isolated
`127.0.0.1:13306`, and disposable `mczen6c`/owned scratch schemas. Credentials
were passed only through command environments. SMTP and Ollama were mocked;
MySQL, transactions, Argon2id, authentication, DB grants, ALS and rate limiting
were real. The limiter proxy delegates to fresh real limiters per test rather
than disabling quotas.

### Real-DB coverage: 70 tests

- **11 foundation tests:** schema/seed counts, FK rejection/cascade behavior,
  live-domain uniqueness, binary UUID/UTC round trips, migration ordering,
  no-op rerun, revert/reapply and failure-ledger behavior.
- **Three 6C migration tests:** upgrade only migrations 4/5 from accepted 6B,
  preserve legacy digest/version, backfill session version, no-op rerun and
  scratch-only revert/reapply. Expected total: 13 tables including the ledger.
- **56 auth/authz HTTP tests:** real AppModule DI, atomic registration and
  duplicate rollback; uniform errors/lockout; reset/verification/invite purpose,
  expiry and single use; login digest races; multi-tenant selection/stale JWTs;
  DB role/grant changes; platform separation; client override/IDOR denial;
  lost membership, tenant/user disablement; JWT/session/refresh expiry,
  revocation, version and binding; rotation/reuse quarantine; concurrent
  refresh, refresh/logout and reset races; independent devices; HTTP quotas,
  pre-parser unknown-route limiting, CORS, sanitized failures, activity expiry,
  concurrent ALS and authenticated Phase 5 contracts.

Unit tests additionally exercise strict JWT encoding/signatures/claims/key
rotation/configuration, DTO boundaries, native hashes, contradictory metadata,
quota capacity/window behavior and RxJS callback/error/teardown scope.

### Earlier MySQL migration, cleanup and compiled bootstrap evidence

- Final `npm run migration:run`: **No migrations are pending**.
- `npm run migration:show`: all five registered migrations marked applied.
- `npm run migration:check`: **5 applied, 0 pending, 0 unknown**, exit 0.
- SQL cleanup verification: **zero scratch schemas**, **13 tables** including
  `migrations`, and zero users/tenants/sessions/pending-token rows in `mczen6c`.
  Schema/catalog state was retained for reproduction, not imported into XAMPP.
- Compiled production-bootstrap probe: **10/10 checks on two consecutive runs**.
  It verified actual MySQL startup, missing-key boot rejection, production demo
  rejection even with flags set, unconfigured-SMTP responses, exact CORS/
  preflight, no credential cookies and parser/log sanitation. Owned child
  processes were stopped; registration was blocked before application rows.
  An initial auxiliary probe returned only `AUTH_BOOTSTRAP_SMOKE_FAILED`;
  safe diagnostics and both successful reruns followed without a backend fix.
  The initial failure's root cause was not established.

### Requested local database: connected, compatibility preflight failed

After the user directed **no Docker; use installed local MySQL**, inspection
identified `C:\xampp\mysql\bin\mysqld.exe` listening on local port 3306. Both
the server greeting and an authenticated `SELECT VERSION()` identify MariaDB
10.4.32, not MySQL 8. Supplied credentials were used only for the local command.

`SHOW COLLATION` found no `utf8mb4_0900_ai_ci`. An isolated, uniquely named
CREATE DATABASE compatibility probe using the accepted collation returned
**`ER_UNKNOWN_COLLATION`, errno 1273**. No schema was created; before/after
schema inventories matched. Existing XAMPP databases were not queried for
application contents or modified. No local `.env` was created or rewritten.

The complete DB suite and migration CLI were **not rerun against this
incompatible local server** after the preflight. Previous MySQL passes are
not substituted for local acceptance. Local verification requires a native
MySQL 8 connection or separately approved architecture/migration compatibility
work; silently replacing collations or patching accepted migrations is not an
authorized remedy.

### Native Windows inspection and installation approval

The follow-up native inspection found no registered MySQL service/installation
or separate server binary in the searched standard locations. XAMPP continues
to run on 3306; existing Windows listeners occupy 3307 and were not altered.
Port 3308 had no listener and passed a temporary loopback bind, which was closed.
No installer, native service/configuration, migration or native test was run.

The [final database report](PHASE-6C-DATABASE-VERIFICATION.md) supplies the official
MySQL 8.4 LTS separate-instance procedure, proposed service/paths/port, pending
verification commands and preservation limitations. A backend `.env` is now
present and is treated as existing user work; it was not created or rewritten
by this follow-up. Installation on proposed port 3308 requires approval.

The user subsequently selected the already-running Docker `mysql:8` endpoint
on port 13306 instead. At that stage its 8.4.13 greeting was reachable, but the
XAMPP credentials were rejected (1045). The user later supplied the correct
Docker credential. The native proposal is no longer the active plan; the
database report's section 7 records the subsequent verification and current
runtime blocker, with the environment-file boundary unchanged.

### Renewed Docker verification: partial results and runtime blocker

- Authenticated `SELECT VERSION()` returned **8.4.13**; container hostname and
  internal port matched the selected instance. The required collation exists.
- In owned `mczen_6c_verify_mvyknuy4_4fc02509`, migration run/check/show passed:
  **5 applied, 0 pending, 0 unknown; 13 tables**. Re-run was a no-op.
- Reverting migrations 5 and 4 restored the accepted three-migration ledger,
  12 tables and no 6C refinement table/columns. Reapplication then started.
- The Jest command targeting all three real-DB suites was launched with complete
  temporary settings, but the combined host command exceeded **360 seconds**.
  No completed Jest result or full helper report was saved, so no new test pass
  is claimed.
- No owned verification client processes remained at recovery inspection.
  The MySQL endpoint then timed out, accepting TCP without a greeting within
  15 seconds. Final migration state and disposable cleanup remain unknown.
- Final XAMPP read-only metadata still matches: MariaDB 10.4.32 on 3306,
  `mczen` with zero tables and `utf8mb4_general_ci`. All eight protected hashes
  and the existing backend `.env` match; no application runtime/source changed.
- The database report and non-secret partial evidence record this incomplete
  run. No restart had been attempted at this original interruption; the later
  narrowly authorized attempt is recorded below. No Phase 6D or new database
  installation was started.

### User-authorized restart: management access still blocked

- The user expressly approved restarting only existing container `8ab6e252374d`.
  Target-only inspection timed out after 30 seconds.
- One `docker restart --time 30 8ab6e252374d` request timed out after **90 seconds**.
  Restart completion is **unknown**; no second request or Docker Desktop-wide
  restart was attempted, and no deletion/recreation or password reset occurred.
- The post-request MySQL health check still accepted TCP on 13306 but supplied
  no greeting within 15 seconds. No new migration, test or cleanup was launched.
- Post-request XAMPP metadata and all eight protected hashes/backend `.env`
  still match. Other containers and XAMPP were not targeted for lifecycle changes.
- Action/health evidence and a preservation result were saved as non-secret
  `mczen-6c-authorized-container-restart-mvymicgt_313b1ce2.json` and
  `mczen-6c-authorized-restart-preservation-mvymicgt_313b1ce2.json` in the approved
  temporary directory. Local Docker management recovery and inspection of the
  pending request's outcome are required before verification can continue.

Earlier test-container status inspection timed out, and its subsequent
read-only direct status attempt was unavailable. Container shutdown is
**unverified**. No stop/removal/restart or further Docker access occurred during
the native-only restriction; later read-only access attempts followed explicit
user authorization. Neither the local XAMPP process nor other services were
stopped. This report does not claim infrastructure cleanup that was not verified.

## 9. Remaining concerns, deviations and readiness

1. **Current database blocker:** the user-approved existing MySQL endpoint on
   port 13306 authenticated, verified the approved collation and passed initial
   migrations, but became unresponsive during the interrupted verification.
   Need runtime restoration, final reapplication/test results and owned-schema
   cleanup. XAMPP remains untouched; no native installation, MariaDB adaptation,
   password reset, Docker Desktop-wide restart or unrelated service change is
   authorized. The one approved container restart timed out with unknown outcome.
   Local
   administrator/no-password access is not a production security model.
2. **SMTP:** no real configured transport/delivery verification, durable outbox,
   resend endpoint, retry/receipt or recovery workflow. Post-commit delivery
   failure leaves registration successful, by design, but can strand a
   verification notification. Mocked tests do not prove real mail delivery.
3. **Demo compatibility deviation:** database-free Phase 5 identities instead
   of DB-seeded 6A demo identities. Strictly local/non-production/explicit gates,
   no invalid-bearer fallback; still requires approval and no public exposure.
4. **Platform provisioning gap:** explicit reserved role over accepted
   membership rows is supported, not a completed staff lifecycle. No new staff
   table, wildcard seed, provisioning API or repository bypass was invented.
5. **Deployment controls:** no shared quotas, trusted-proxy policy, Argon2/
   Ollama concurrency semaphore, tenant billing quotas, deployment request
   timeouts or installed TLS edge. Production hardware/load calibration remains.
   Accepted DB config has no DB TLS settings; use appropriate private transport
   until separately reviewed TLS configuration exists.
6. **Retention/audit:** no scheduler for session/refresh/pending-token history
   or durable auth audit. Used refresh evidence must survive while its family
   could still be reused; premature purge would defeat quarantine detection.
7. **Later domain isolation:** no domain CRUD/subscriber, persistent agent
   repositories, background authorization, widget/API-key/voice authentication
   or dashboard session client. The base repository does not secure arbitrary
   SQL automatically. Shared Phase 5 knowledge/catalogues are demonstrations,
   not proven private production tenant data.
8. **Client/product readiness:** unchanged React has no bearer/refresh lifecycle.
   Legacy catalogue IDs are not UUID aliases, and no new legacy-route permission
   model was invented. Preserving Phase 5 service behavior is not completing
   authenticated end-to-end dashboard/product functionality.
9. **Security review/observability:** JWT handling is narrow Node-crypto HS256,
   not an external JOSE implementation; independent review remains advisable.
   NestJS Observe is not registered; no production telemetry was consulted or
   production-health claim made. Redact auth headers/bodies, SQL parameters
   and notification content before adding telemetry/access logging.
10. **Verification limitations:** 14 lint warnings remain, the initial auxiliary
    bootstrap failure is unexplained, disposable-schema cleanup is unverified,
    and the renewed selected-MySQL integration run remains blocked. No production
    availability/failover/throughput/real SMTP operation was demonstrated.

## 10. Git status and protected-file integrity

Final inspected root status remains:

```text
 M frontend/package-lock.json
 M frontend/src/App.jsx
?? backend-nestjs/
?? frontend/.env.local
?? frontend/dist/
?? frontend/vite.config.js
?? mczen.zip
```

The frontend modifications and untracked root artifacts predate 6C and were
not discarded, overwritten or staged. The entire backend remains untracked,
so ordinary Git diff cannot distinguish 6B from 6C. No commits were made.

All **eight SHA-256 protected-baseline comparisons matched**, including checks
after the local preflight and the interrupted renewed Docker verification:

- `backend-nestjs/src/agent/agent.service.ts`
- `backend-nestjs/src/agent/tools/tool-executor.service.ts`
- `backend-nestjs/src/agent/config/agent-runtime-config.service.ts`
- `backend-nestjs/src/database/migrations/1740000000001-DomainATenants.ts`
- `backend-nestjs/src/database/migrations/1740000000002-DomainBAuth.ts`
- `backend-nestjs/src/database/migrations/1740000000003-SeedGlobalCatalogs.ts`
- `frontend/src/App.jsx`
- `frontend/package-lock.json`

External evidence helpers and results are confined to the approved OpenCode
temporary directory, including `mczen-6c-protected-hashes.json`,
`mczen-auth-bootstrap-smoke.cjs`, `mczen-6c-existing-mysql-verify.cjs` and the
renewed verification's non-secret partial JSON. No real password/signing key
was stored in those helper sources/results or committed. No accepted migration
or DB compatibility workaround was made after the local database direction.

## 11. Phase 5 intactness and approval boundary

- AgentService, ToolExecutorService and runtime/Ollama configuration match
  their protected baselines. Existing tool validation/permissions, safety
  budgets, audit sanitization, timeout behavior and agent response fields remain.
- Complete backend tests and all 19 Phase 5 HTTP tests passed on the final
  implementation; the real-MySQL suite also exercised the existing agent
  with authenticated context and mocked Ollama.
- The only deliberate legacy response removal is `resolvedDevTenant` from
  `/api/agent/tools`, as required. Production requests now require actual
  JWT/session/membership authorization; local demo access is explicitly gated.
- React/user work is untouched. No voice, STT/TTS, dashboard, Phase 6D domain
  work, accepted-migration rewrite or commit was started.

**STOP for approval.** Server implementation evidence is available above;
the renewed MySQL 8 verification and cleanup remain incomplete. The disclosed
demo/platform/mail/deployment gaps must not be silently treated as approved.
No MariaDB compatibility amendment or Phase 6D work is authorized.

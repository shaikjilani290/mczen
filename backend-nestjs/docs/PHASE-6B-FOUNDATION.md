# Phase 6B — MySQL Foundation and Migration Infrastructure (Implementation Notes)

**Status:** complete, DB-verified against a real MySQL 8 (`mysql:8` docker image).
Companion document to the approved `PHASE-6A-ARCHITECTURE.md` (Part 1 + Revision R1).

---

## 1. Scope as implemented

Phase 6B implements exactly the §12.4 subset assigned to this phase:

| §12.4 step | Implemented by |
|---|---|
| baseline | Domain A + Domain B migrations (§5 A1–A4, B1–B7) + global catalog seeds |
| — (6B stops here) | Domains C, D, E, F, G, H, V explicitly **not** touched |

Out of scope for this phase (and therefore untouched): voice gateway, STT/VAD/TTS,
auth flows, dashboard, AgentService, ToolExecutorService, Ollama integration,
legacy Express `backend/`, and React frontend.

## 2. Files

**Created:**
- `src/database/mysql-config.ts` — env-based config, validation, fail-closed production rule.
- `src/database/database.module.ts` — `DatabaseModule.forRoot()`, graceful dev boot, shutdown hooks.
- `src/database/data-source.ts` — TypeORM CLI entrypoint (registry-driven, no FS globs).
- `src/database/migrations/1740000000001-DomainATenants.ts` — Domain A.
- `src/database/migrations/1740000000002-DomainBAuth.ts` — Domain B.
- `src/database/migrations/1740000000003-SeedGlobalCatalogs.ts` — global catalogs.
- `src/database/migrations/index.ts` — explicit ordered registry (`ALL_MIGRATIONS`).
- `src/database/scripts/migration-check.ts` — status check with CI exit codes.
- `src/common/ids/uuid.ts` — RFC 9562 UUIDv7 generation + BINARY(16) conversion.
- `src/common/tenant/tenant-context.store.ts` — AsyncLocalStorage tenant context (fail-closed).
- `src/common/tenant/tenant-scoped.repository.ts` — fail-closed repository base contract.
- `src/common/ids/uuid.spec.ts`, `src/database/mysql-config.spec.ts`,
  `src/common/tenant/tenant-context.store.spec.ts`, `src/database/migrations/migrations.spec.ts` — unit specs.
- `test/database/mysql-foundation.spec.ts` — opt-in integration suite against a live MySQL.

**Modified:**
- `src/app.module.ts` — imports `DatabaseModule.forRoot()` ahead of `AgentModule`.
- `src/main.ts` — `app.enableShutdownHooks()` (pool teardown on SIGINT/SIGTERM).
- `package.json` — `typeorm:cli`, `migration:run`, `migration:revert`, `migration:show`, `migration:check`.
- `.env.example` — new `DB_*` section (no `.env` was created or modified).
- `test/transform/ts-cjs-transform.js` — extend the Phase 5 Jest transformer for the new
  ESM-only dependency `@nestjs/typeorm` (see §7).

**Dependencies installed** (`@nestjs/typeorm@^12.0.2`, `typeorm@^0.3.31`, `mysql2@^3.24.6`):
Nest 12 support, the 0.3 line pinned by the architecture, and the MySQL driver.

## 3. Database configuration

Environment variables (documented in `.env.example`):

| Key | Default | Notes |
|---|---|---|
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_NAME` | — | required |
| `DB_PASSWORD` | — | key must be present (an empty value is allowed) |
| `DB_CONNECT_TIMEOUT_MS` | 10000 | 1000–120000 |
| `DB_CONNECTION_LIMIT` | 10 | 1–200, passed via `extra.connectionLimit` |

Rules enforced by `MysqlConfig`:
- **Fail closed in production**: `NODE_ENV=production` + missing/invalid `DB_*` throws
  `DatabaseConfigError` at bootstrap; the process does not start.
- **Graceful in development**: without `DB_*`, the app boots with
  `configured: false` and no connection attempt — Phase 5 behavior is preserved.
- **CLI is always explicit**: `data-source.ts` requires a complete config in every
  environment — operator action, never a silent no-database runbook.
- **Secrets discipline**: the password is private to the config instance; error
  messages and logs never contain it; driver debug output is explicitly off.
- `synchronize: false` (mandatory), `timezone: 'Z'`, `charset: utf8mb4`,
  engine semantics via per-table `ENGINE=InnoDB … utf8mb4_0900_ai_ci`.

## 4. Migration infrastructure

- Registry `src/database/migrations/index.ts` exports `ALL_MIGRATIONS`
  (`readonly MigrationCtor[]`) in strict dependency order — no filesystem globs.
- Scripts (package.json):
  - `npm run migration:run` / `migration:revert` / `migration:show` (TypeORM CLI via ts-node),
  - `npm run migration:check` — prints APPLIED/PENDING/UNKNOWN and exits non-zero
    if anything is pending or unknown (CI gate).
- `migrationsRun: false` — migrations always execute as an explicit operator/CI action.
- **Transactional semantics**: `migrationsTransactionMode: 'each'` bounds
  seed-data failure; MySQL 8 has no transactional DDL, so each DDL statement
  effectively auto-commits. The `migrations` ledger row is written *after* a
  migration completes, so a failed migration leaves a schema-partial state and a
  ledger that does (only) list what actually finished — the failure test proves
  the failed step writes nothing and is not recorded.
- **Rollback strategy**:
  1. Reversibility at migration level: every migration ships a real `down()` (table/FK drops in reverse dependency order; seeds are data-only deletes).
  2. The **seed catalog `down()` is only valid on a clean catalog** — roles are referenced by `tenant_users` (`fk_tenant_users_roles` RESTRICT), so citing memberships must be removed first. The integration suite verifies the block and the successful revert after removing memberships.
  3. Backups/rehearsal: production runs are expected against a recent snapshot per the Phase 6A §12.3 operator rules.

## 5. Tables and domains

**Domain A — `1740000000001-DomainATenants`**
`tenants` (BINARY(16) id, slug UK, status ENUM active/suspended/closed, UTC DATETIME(3)) →
`tenant_settings` (1:1, limits, feature flags JSON) →
`tenant_domains` (generated `is_live` column realizing the §4.3 partial-uniqueness convention
for the unique key `(tenant_id, domain, is_live)`; FK tenants RESTRICT) →
`tenant_api_keys` (hash-only `key_hash` CHAR(64), prefix UK, FK tenants RESTRICT;
`created_by` FK to users deferred to Domain B's migration).

**Domain B — `1740000000002-DomainBAuth`**
`users` (global identity, email UK, status active/disabled/erased, token_version, lockout fields) →
`roles` / `permissions` (global catalogs, `key` UKs) →
`role_permissions` (composite PK, FKs CASCADE) →
`tenant_users` (UK `(tenant_id, user_id)`, role FK RESTRICT, invited_by FK) →
`user_sessions` (JWT `sid` source, active_tenant FK, revocation columns) →
`refresh_tokens` (opaque hash UK, `family_id`, `replaced_by` self-FK SET NULL,
session FK **CASCADE** — §6.2 family revocation). Adds `fk_tenant_api_keys_users`.

**Seeds — `1740000000003-SeedGlobalCatalogs`** (idempotent `INSERT IGNORE`)
6 roles (5 tenant roles + reserved `platform:admin`, `is_platform=1`, zero grants) and
21 permissions (`resource:action`, same format as Phase 5's permission service).
Matrix: owner=21, admin=19 (excludes `api_keys:manage`, `billing:manage`), editor=16,
member=12, viewer=11, platform:admin=0.

## 6. Tests executed (real evidence)

Environment: Windows, Docker 29.6.2, `mysql:8` (image digest `sha256:a0225d1e…`),
container `mczen-mysql-6b` on `127.0.0.1:3306`, PHP-style root password passed
**only via the session environment** (never committed).

1. `npm run build` — exit 0.
2. `npm test` (units, no DB) — **14 suites, 207 tests, all passed**; the 11 DB tests skipped by guard.
3. `npm run test:e2e` (Phase 5 e2e) — **16/16 passed**.
4. `npm test` with `RUN_DB_TESTS=1` against the live MySQL — **15 suites, 218 tests, all passed**:
   - fresh-DB initialization runs A → B → seeds in order; ledger has exactly 3 rows;
   - second `runMigrations()` is a no-op; duplicate-migration prevention verified;
   - all 11 tables + `migrations` bookkeeping exist (`information_schema`);
   - seeded catalog counts verified by SQL (6/21/79 grants, admin exclusions, `platform:admin`=0);
   - FK enforcement: orphan `tenant_users` insert rejected with error **1452** (both tenant and user FKs); valid row inserts;
   - `tenant_domains` partial uniqueness: duplicate live row → `ER_DUP_ENTRY`; soft delete frees the pair; generated `is_live` becomes NULL;
   - BINARY(16) UUIDv7 round-trip (insert binary, read back, string equality);
   - DATETIME(3) UTC determinism over the `'Z'` timezone connection;
   - cascade-revocation: deleting `user_sessions` removes the token family (`refresh_tokens`) — 0 rows remain;
   - revert + re-run of the seeds via `undoLastMigration`/`runMigrations` (including the documented RESTRICT interplay with `tenant_users`);
   - failure propagation: a failing migration is not recorded; completed migrations stay in the ledger; failed step writes no tables.
5. CLI runbook executed against the container (live):
   - `migration:run` — all three migrations executed successfully;
   - `migration:run` again — "No migrations are pending";
   - `migration:show` — `[X] 1..3`;
   - `migration:check` — "3 applied, 0 pending, 0 unknown" (exit 0);
   - `migration:revert` — seed migration reverted (`DELETE` path); re-run reapplied cleanly;
   - scratch database `mczen_it_*` dropped automatically by the suite afterAll (databases listing confirms).

## 7. Notes and follow-ups

- The Phase 5 Jest custom transformer needed one more rule: `@nestjs/typeorm` is
  ESM-only and ships `const require = createRequire(import.meta.url)`, which
  collides with Jest's CommonJS wrapper parameter. The transform now renames the
  shadowing declaration; behavior for `@nestjs/common`/`core` is unchanged.
- A genuine bug was caught by the new `uuid.spec.ts`: the initial `newUuidv7()`
  misplaced the 48-bit timestamp (writing 8 bytes shifted it right by 2), letting the
  version/variant bytes overwrite timestamp bits. Fixed to a 6-byte `writeUIntBE`
  layout; the spec pins the RFC 9562 field layout.
- Observe telemetry (`NestJS Observe` per the repo AGENTS.md) was **not** wired:
  out of 6B scope; no keys were added to `.env.example` for it.
- The container/credentials used for verification are disposable local test
  infrastructure only (`mczen-mysql-6b`, `mczen6b`). Production DB env remains
  operator-supplied; `.env.example` documents everything a deployment needs.

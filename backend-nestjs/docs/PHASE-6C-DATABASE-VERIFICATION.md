# Phase 6C — Final database verification

**Inspection date: 2026-11-02. Current status: PARTIAL / BLOCKED by an
unresponsive MySQL runtime at `127.0.0.1:13306`.** The supplied Docker credential
authenticated successfully; `SELECT VERSION()` returned **8.4.13** and the
required collation was verified. Initial migrations/checks passed, but the
combined real-DB test/reapplication run exceeded its host deadline. The endpoint
now accepts TCP without sending a MySQL greeting. No complete test pass or
verified scratch cleanup is claimed.

The user subsequently authorized restarting **only** the selected existing
container. That single restart request timed out after **90 seconds** because
Docker management remains unresponsive; restart completion is **unknown**.
The post-request MySQL health check still received no greeting within 15 seconds.

The user has now explicitly selected the already-running Docker `mysql:8`
instance. **No separate native installation or MariaDB adaptation is needed
for that selection.** Sections 1–6 retain the original native inspection and
unexecuted proposal as history; section 7 records the current authorized path.

This report supplements [the authentication implementation report](PHASE-6C-AUTHORIZATION.md).
The approved database architecture remains MySQL 8, not MariaDB. No Docker
operations occurred during the original native-only inspection. After the
user's later authorization, Docker inspection attempts and database
verification used the existing instance. SQL changes targeted only disposable
verification schemas, never existing application databases. The later narrowly
authorized restart request has no verified outcome. No container deletion or
recreation, XAMPP changes, schema-definition adaptations, application environment
edits, existing-data imports, commits or Phase 6D work were performed.

## 1. Database versions, services and ports

| Target | Version / identity | Port | Inspection result |
| --- | --- | --- | --- |
| Existing XAMPP server | MariaDB **10.4.32**, authenticated `SELECT VERSION()` from the earlier local preflight | **3306** | Running `C:\xampp\mysql\bin\mysqld.exe`, PID 18592; left untouched |
| Preferred native port | `wslrelay.exe` PID 6628 and `com.docker.backend.exe` PID 6916 | **3307** | Occupied; neither owner was stopped, reconfigured or connected to |
| Proposed native MySQL 8.4 instance | **Not discovered / not installed by this task** | **3308 proposed** | No TCP listener; temporary `127.0.0.1:3308` bind succeeded and was closed |
| Default X Protocol port | No listener | **33060** | Unused at inspection; proposed instance does not need X Protocol |

No MySQL/MariaDB Windows service was found. XAMPP is nevertheless running as
the process above; absence of a registered service does not mean it is stopped.

Discovery checked database service names and executable paths, running server
processes, installed-product registries, PATH commands, MySQL registry keys
and MySQL/MariaDB-named locations under Program Files, Program Files (x86),
ProgramData, `C:\`, local Programs, Downloads and `C:\tools`. No separate
native server binary or registered MySQL installation was found. This is not
an exhaustive search of every disk: a portable/nonstandard installation can
still be inspected if its exact path is supplied.

The port-3307 owners were identified using read-only Windows process/network
inventory, **not Docker commands, APIs or database access**. Port availability
is point-in-time evidence, not a reservation; recheck 3308 before installation.

## 2. Configuration changes and safest separate-instance procedure

**Historical proposal only:** the user subsequently chose the existing Docker
instance instead. The native procedure below was never executed and is not
the current recommendation.

### Changes actually made

Only documentation was added/updated. No installer was downloaded or executed;
no service, firewall rule, PATH setting, native configuration or data directory
was created or changed. No native credentials have been provisioned.

`backend-nestjs/.env` is present at the latest inspection and is treated as
existing user work. It was not created, overwritten or printed by this pass.
Its hash is checked for preservation; its password values are not reported.
Do not copy `.env.example` or change any application environment file.

### Proposed isolation settings — not yet approved or applied

| Setting | Proposed value |
| --- | --- |
| Package | Official **MySQL Community Server 8.4 LTS**, Windows x64 MSI; download page currently offers **8.4.13**, `mysql-8.4.13-winx64.msi` |
| Server binaries | `C:\Program Files\MySQL\MySQL Server 8.4\bin\` |
| Native configuration | `C:\ProgramData\MySQL\MySQL Server 8.4\my.ini` |
| Native data | `C:\ProgramData\MySQL\MySQL Server 8.4\Data\` |
| Native logs | Only under the new native instance directory, e.g. its `Logs\` subdirectory |
| Unique service name | `McZENMySQL84` |
| Service account / startup | Configurator's Standard System Account (**Network Service**); **Manual** startup |
| Classic protocol | **127.0.0.1:3308**, subject to approval and final availability check |
| X Protocol | Disabled: `mysqlx=0` |
| Firewall / extra transports | Do not open a Windows Firewall port; named pipe/shared memory unnecessary |
| Authentication | Keep modern default authentication; new strong native passwords, entered privately |

These paths must be verified unused before applying anything. If an existing
native installation or data directory is discovered, stop and inspect it;
do not overwrite it. No path may point into `C:\xampp\` or an existing
application data directory.

### Installation steps — execute only after approval

1. Recheck port 3308 and the proposed paths/service name. Download only the
   Windows x64 **MySQL Community Server 8.4 LTS MSI** from
   [Oracle's official download page](https://dev.mysql.com/downloads/mysql/8.4.html).
   Verify its trusted Oracle digital signature before execution. Administrator
   rights are required for installation/service creation; disclose and obtain
   approval for any additional prerequisite installation if needed.
2. Install a **separate** server. If Configurator presents an installation-type
   choice, select **Add a Separate MySQL Server Installation**, never
   **In-Place Upgrade**. Cancel if the operation targets XAMPP or an existing
   data directory. Do not import application/production data, copy MariaDB
   files, or install the optional sample databases.
3. Choose **Development** resource usage, TCP/IP port **3308**, and uncheck
   **Open Windows Firewall port for network access**. Leave unnecessary named
   pipes/shared memory disabled. Do not free port 3307 by stopping its owners.
4. Enter a new strong root password in the Configurator GUI; do not reuse the
   XAMPP authentication settings. Optionally create a separate local-only
   `mczen_verify` account in the GUI with the permissions needed to create,
   migrate and drop test schemas. A Configurator DB Admin account is suitable
   only on this new, otherwise-empty verification instance, not as an
   application runtime/production account. Never put passwords in command
   arguments, chat, screenshots, shared installer logs or reports.
5. Set service name **McZENMySQL84**, disable automatic startup, and retain
   restrictive permissions for the service account and administrators on the
   **new** data/log directories. Keep the error log local to this instance;
   general/slow query logging is unnecessary for this verification. Review
   generated configuration/data/log paths before applying configuration.
6. Configurator may start the new service during setup. Its networking screen
   alone does not guarantee loopback binding. Inspect **only the new native
   `my.ini`**, merge these options into its existing `[mysqld]` section, and
   restart **only McZENMySQL84** before verification:

   ```ini
   [mysqld]
   port=3308
   bind-address=127.0.0.1
   mysqlx=0
   ```

   This is a partial configuration example, not a replacement for the generated
   file. Verify the service uses this instance's configuration and data path.
   Do not create a global `C:\my.ini`, change XAMPP's configuration, or change
   global PATH. Use full native binary paths to avoid confusing the two servers.
7. Verify the final listener belongs to the installed native Windows binary,
   is loopback-only, and that XAMPP still runs on 3306. Do not create any test
   database until these identity/isolation checks pass.

Official references: [Windows installation](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html),
[Configurator workflow and side-by-side option](https://dev.mysql.com/doc/refman/8.4/en/mysql-configurator-workflow-server.html),
[multiple Windows servers](https://dev.mysql.com/doc/refman/8.4/en/multiple-windows-servers.html),
[disabling X Plugin](https://dev.mysql.com/doc/refman/8.4/en/x-plugin-disabling.html).

## 3. Connectivity and migration results

| Required check | Native-local result |
| --- | --- |
| Confirm native binary/service/listener identity | **NOT RUN — no native server discovered** |
| `SELECT VERSION()`, distribution, port and data directory | **NOT RUN** |
| `utf8mb4_0900_ai_ci` availability | **NOT RUN** |
| Create dedicated disposable McZEN schema | **NOT RUN** |
| `npm run migration:run` | **NOT RUN** |
| `npm run migration:check` | **NOT RUN** |
| Rollback and reapplication in disposable schemas | **NOT RUN** |

The earlier authenticated XAMPP preflight found no required collation and
rejected a uniquely named schema creation with **ER_UNKNOWN_COLLATION (1273)**.
No schema was created. That proves MariaDB incompatibility, not native MySQL
readiness. No accepted collation or migration was changed to bypass it.

### Verification sequence after approved installation

1. Match the listener's PID/executable to the new native service before any
   connection. Use its full-path client with explicit TCP host/port and a
   secure password prompt, or the existing MySQL driver with securely supplied
   process credentials. Do not connect to port 3307 or a forwarded endpoint.
2. On the verified native instance only, execute:

   ```sql
   SELECT VERSION() AS version, @@version_comment AS distribution,
          @@port AS port, @@datadir AS datadir;
   SHOW COLLATION WHERE Collation = 'utf8mb4_0900_ai_ci';
   ```

   Require MySQL 8 (not MariaDB), the approved port, the separate native data
   directory and the required collation. Stop on any mismatch.
3. Record preservation baselines, then create a fresh uniquely named database,
   e.g. `mczen_6c_native_<timestamp>_<random>`, explicitly using `utf8mb4` and
   `utf8mb4_0900_ai_ci`. Assert it does not already exist; do not drop/replace an
   unknown schema. Use migrations and synthetic test fixtures only.
4. From `backend-nestjs/`, supply **all five** `DB_HOST`, `DB_PORT`, `DB_USER`,
   `DB_PASSWORD`, `DB_NAME` variables in the verification command process.
   Pin host/port to the verified native instance and name to the owned schema;
   no setting may fall back to the existing `.env`. Enter the native password
   through a secure local prompt/secret mechanism, never a literal logged
   command. Restore/remove temporary process settings afterward. Separate
   harness shell calls require the complete environment again.
5. Run these existing scripts without modifying source/schema definitions:

   ```text
   npm run migration:run
   npm run migration:check
   npm run migration:show
   ```

   Require all **five** registered migrations applied, **zero pending/unknown**,
   and **13 tables** including the migration ledger. Re-run migrations and
   require a no-op. These are expected acceptance criteria, not executed results.
6. On owned disposable schemas only, rehearse rollback/reapplication. The
   foundation suite reverts/reapplies migration 3; the 6C migration suite reverts
   migrations 5 and 4 to the unchanged three-migration baseline, then reapplies
   4 and 5 and checks legacy-fixture digest/version preservation. If rehearsing
   the CLI separately, run `migration:revert` twice only against the dedicated
   disposable schema, check the three-entry ledger, then run/check migrations
   again. Never revert an existing application database. MySQL DDL auto-commits;
   a transaction is not a substitute for disposable-schema isolation.

## 4. Test results

| Existing real-DB suite | Expected tests | Native-local result |
| --- | ---: | --- |
| `test/database/mysql-foundation.spec.ts` — Phase 6B foundation | 11 | **NOT RUN** |
| `test/database/mysql-auth-migrations.spec.ts` — Phase 6C upgrade/revert | 3 | **NOT RUN** |
| `test/database/mysql-auth.spec.ts` — Phase 6C authentication/authorization | 56 | **NOT RUN** |
| Total | **70** | **No native-local pass claimed** |

After preflight/migrations, provide the complete native `DB_*` process
environment **and `RUN_DB_TESTS=1`**, then run:

```text
npm test -- --runInBand --runTestsByPath test/database/mysql-foundation.spec.ts test/database/mysql-auth-migrations.spec.ts test/database/mysql-auth.spec.ts
```

Require all three suites / 70 tests to pass with **zero skipped**. The suites
create their own scratch schemas; they need CREATE/DROP permission on this
native verification instance. SMTP and Ollama are mocked, while MySQL,
transactions, authentication, authorization, ALS and quotas are real.

The earlier full-suite **27 suites / 439 tests passed** result used real MySQL
8.4.13 on `127.0.0.1:13306` before the local-only direction. It remains historical
implementation evidence, **not a successful native-local run**. No Docker
operation or earlier-container cleanup was resumed for this task.

## 5. Existing database and file preservation

- XAMPP remains running at its inspected executable/PID on port 3306. No stop,
  removal, upgrade, restart, configuration edit or migration targeted it.
- The earlier rejected collation probe left before/after XAMPP schema
  inventories identical, with no created schema. No existing application rows
  were imported, updated or deleted by that probe or this native inspection.
- All **eight protected SHA-256 comparisons match**, including accepted Phase
  6B migrations 1–3, AgentService, ToolExecutorService, runtime/Ollama
  configuration and the two protected frontend files.
- The existing backend `.env` is preserved by a before/after hash check; no
  application environment file was created or rewritten in this pass.
- Only this database report and its link/update in the authentication report
  were written. No backend runtime/test code or frontend code was changed.

These are non-interference, schema-inventory and file-integrity checks, **not
a byte-for-byte audit of live database contents**. Concurrent external
application writes cannot be certified absent from this evidence. The final
post-installation/post-test XAMPP preservation check remains pending.

After approval, capture/recheck XAMPP service/process/listener identity,
configuration hashes and schema metadata without modifying it. Track exact
names of native schemas created by this verification, close connections and
drop only those owned disposable schemas. Compare before/after inventories;
never use wildcard drops, broad directory deletion or cleanup of pre-existing
schemas. Report any residual owned schema or preservation discrepancy instead
of claiming cleanup or data equality that was not verified.

## 6. Original native blockers and approval boundary

1. Native MySQL 8 was not discovered; installation or an exact existing native
   binary/service path is needed before native connectivity can be verified.
2. Preferred port 3307 is occupied. **3308 is proposed, not approved**, and must
   be rechecked before applying configuration.
3. Installation/service creation requires approval and administrator access.
   A new native credential must be provisioned securely; valid XAMPP credentials
   are not credentials for a new MySQL instance.
4. Native version/collation checks, migrations, all 70 real-DB tests,
   rollback/reapplication and final post-test preservation checks are pending.
   Historical passes do not remove this acceptance blocker.

The proposed native installation on port 3308 was not approved or performed.
The later choice of the existing Docker instance supersedes this proposal;
see the current blocker below. It does not authorize application `.env`
changes, XAMPP changes, production/existing-data imports, migration rewrites,
commits or Phase 6D.

## 7. Current user-approved existing Docker MySQL endpoint

The user explicitly selected the already-running
`mysql:8` container shown with ID prefix `8ab6e252374d` and published mapping
`13306:3306`. This supersedes the earlier no-Docker direction only for using
that existing instance. The user later expressly approved restarting **only
this container**. Deletion/recreation, password resets, Docker Desktop-wide
restarts and changes to XAMPP or other containers remain unauthorized.

| Check | Current result |
| --- | --- |
| Published endpoint `127.0.0.1:13306` | Initially authenticated; latest health check accepts TCP but supplies **no MySQL greeting within 15 seconds** |
| Docker CLI inspection | Original inspection timed out after 15 seconds; post-approval target-only inspection timed out after 30 seconds |
| Local Docker API inspection/recovery | Connection reset or health-request timeout; no credential obtained through the API |
| User-authorized restart of `8ab6e252374d` only | One request timed out after **90 seconds**; **completion unknown**, no second restart request |
| Credential supplied later by the user | **Authentication passed**; not stored in application environment/helper/evidence files |
| Authenticated `SELECT VERSION()` | **8.4.13**, MySQL Community Server; hostname matched container `8ab6e252374d`, internal port 3306 |
| `utf8mb4_0900_ai_ci` availability | **Verified** without changing the approved collation |
| Dedicated disposable schema | Created `mczen_6c_verify_mvyknuy4_4fc02509`; no existing schema replaced |
| Initial `migration:run`, `migration:check`, `migration:show` | **Passed: 5 applied, 0 pending, 0 unknown; 13 tables** |
| Idempotent migration rerun | **Passed: no migrations pending** |
| CLI rollback of migrations 5 and 4 | **Passed: original 3-entry ledger, 12 tables, refinements absent** |
| CLI reapplication | Started; **completion not verified** |
| Jest command targeting all three real-DB suites / 70 tests | Launched; **completion/results not verified**, no completed Jest report |
| Final disposable-schema cleanup | **Not verified — runtime unresponsive** |
| Existing XAMPP `mczen` | Final read-only check matches earlier state: MariaDB 10.4.32 on 3306, **0 tables**, `utf8mb4_general_ci` |

The current backend `.env` points to `localhost:3306`, user `root`, database
`mczen`. That XAMPP credential initially failed against the Docker instance
(1045); the later user-supplied Docker credential resolved authentication.
Verification used complete temporary process `DB_*` overrides pinned to port
13306 and the owned disposable schema. Application `.env` settings were not
changed. No persistent application database named `mczen` was provisioned or
migrated in the container by this verification.

The first helper attempt stopped at a 15-second Windows inventory timeout
before creating a schema. A lighter native process/port check replaced that
inventory, and the next attempt reached successful migrations and rollback.
The launched Jest command targeted all three suites, configured to use their
own scratch schemas separately from the CLI reapplication schema. The combined
harness command exceeded **360 seconds** before delivery of results/cleanup.
That client deadline alone did not prove work stopped: a
subsequent ownership-filtered process inventory found **no remaining helper or
uniquely identified test processes**, and neither the completed verification
JSON nor Jest JSON had been saved.

An authenticated read-only recovery attempt then timed out; a separate
unauthenticated health check confirmed TCP connection without a MySQL greeting
within 15 seconds. The cause of this runtime outage is **not established**.
Do not reinterpret it as bad credentials, a completed test failure, or proof
of final migration state. Reapplication might have progressed; the latest
database state cannot currently be queried.

Partial evidence is retained in the approved temporary directory as
`mczen-6c-existing-mysql-mvyknuy4_4fc02509-partial.json`, alongside the helper
source and the earlier pre-schema timeout result. No real credential is
included in these files. The last known owned CLI schema name is recorded
above; additional suite-created scratch schemas may remain. No broad cleanup,
container deletion/recreation, password reset or unrelated service change was
attempted. The later authorized restart attempt is recorded below.

All eight protected file hashes and the existing backend `.env` still match.
The final XAMPP metadata check passed. Existing application rows were never
imported or targeted for writes. A final Docker-wide schema/metadata comparison,
full test results and owned-schema cleanup remain **pending**, not passed.

### User-authorized restart: Docker management remains unavailable

After explicit approval, a target-only Docker inspection timed out at 30
seconds. One `docker restart --time 30 8ab6e252374d` request was then issued,
with a 90-second client budget and additional host delivery headroom. The
request ran from **02:12:00 to 02:13:30 UTC on 2026-11-02** and timed out.
This does not establish whether Docker received or completed the restart;
**no successful restart is claimed and the request was not repeated**.

A post-request health check still accepted TCP on port 13306 without a MySQL
greeting within 15 seconds. No migration, test or schema-cleanup command was
started in this follow-up. Docker Desktop was not restarted, no container
was deleted/recreated, and XAMPP/other containers were not targeted.

The post-request XAMPP read-only check again matched MariaDB 10.4.32 on 3306,
`mczen` with zero tables and `utf8mb4_general_ci`; the eight protected hashes
and backend `.env` also still match. Non-secret action/health and preservation
evidence is retained in the approved temporary directory as
`mczen-6c-authorized-container-restart-mvymicgt_313b1ce2.json` and
`mczen-6c-authorized-restart-preservation-mvymicgt_313b1ce2.json`.

**Next requirement:** restore Docker management locally and confirm the status
and responsiveness of this existing MySQL container. Inspect its state before
issuing another restart, since the first request's outcome is unknown. The
approval does not cover restarting Docker Desktop, other containers or XAMPP,
nor deleting/recreating this instance. Once responsive, inspect partial
disposable state, establish preservation baselines, run the remaining checks
in separately bounded jobs with deadline headroom, and clean up only provably
owned schemas.
Do not silently edit `.env`, migrate an existing application schema, or
substitute historical passes for the interrupted run.

**STOP: awaiting restoration of the existing Docker MySQL endpoint.** No new
installation, MariaDB compatibility work or Phase 6D is underway.

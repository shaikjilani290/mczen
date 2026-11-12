<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Current backend: Phase 6C authentication

The server-side auth API and DB-backed authorization are documented in
[`docs/AUTH-API.md`](docs/AUTH-API.md). The implementation/verification report is
[`docs/PHASE-6C-AUTHORIZATION.md`](docs/PHASE-6C-AUTHORIZATION.md). These supersede
the historical Phase 5 "authentication absent" notes below. The React client is
unchanged; no dashboard, widget or voice work is included. Production tenant
requests now require a live JWT/session/membership. The database-free Phase 5
demo header needs explicit non-production, direct-loopback opt-in and is
limited to the two agent routes.

Phase 6C is awaiting approval. Requested local DB verification is blocked:
this workstation's XAMPP MariaDB 10.4.32 does not support the accepted MySQL 8
schema collation. See the report for successful historical MySQL 8 tests and
the separately recorded local preflight failure; no migration workaround or
local database changes were made.

### Database connectivity check

The application reads `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, and
`DB_DATABASE` from the process environment or optional `.env` file. The legacy
`DB_USER` and `DB_NAME` aliases remain supported. Runtime credentials should be
the least-privileged `mczen_app` account; do not use the migration account for
application startup. TypeORM synchronization and automatic migration execution
remain disabled. Migration commands are separate operator actions.

With the SSH tunnel listening on `127.0.0.1:13307`, set the database values in
the environment (do not put secrets in command history), then run from
`backend-nestjs`:

```powershell
npm run database:check
```

The command connects to the configured schema and prints only
`VERSION()`, `DATABASE()`, and `CURRENT_USER()`. It never runs migrations or
prints the configured password. Existing migrations use MySQL 8 features and
the `utf8mb4_0900_ai_ci` collation; verify compatibility against the target
server before any separately approved migration operation.

### Seed a local demo owner

For an isolated demo database only, set `DB_HOST` to `127.0.0.1`, `localhost`,
or `::1`, and choose a database name containing `test`, `testing`, `dev`,
`development`, `demo`, or `local`. Then run `npm run seed:demo` from
`backend-nestjs`. The script refuses production mode, non-local database hosts,
and database names not marked for local/test/demo use. It creates an account
through the existing authentication service, then assigns the seeded
`platform:admin` role and verifies the assignment. It prints the fixed demo
credentials from `scripts/demo-owner-seed.credentials.ts`. It refuses to
overwrite an existing demo account or workspace. Never use these credentials
outside an isolated local demo database.

To add a separate workspace owner to the existing active `mczen` workspace,
run `npm run seed:demo -- --owner`. This preserves the platform-admin account,
uses invitation registration, and verifies owner permissions and login.
Sign in as the owner without selecting **Platform administrator**.

For a normal demo user in the same workspace, run
`npm run seed:demo -- --member`. This creates `user@mczen.in` with the
`tenant:member` role, verifies conversation-write access and absence of
management permissions, and leaves existing accounts unchanged. Use the main
application login at `/`, not the platform-administrator mode.

## Website knowledge engine

Website chat and voice use the same deterministic website-answer service. It
retrieves public pages from the tenant/assistant-scoped MySQL FULLTEXT
knowledge index, expands common wording (for example, “money back” to refund
and return terms), scores the returned titles and excerpts, and answers from
those records with their source URLs. Product details, comparisons, prices,
stock, and availability are queried directly from the connected catalogue
tables at request time rather than read from the article/chunk index. Missing
facts are called out instead of inferred. Product variants are not represented
by the current catalogue schema and are therefore reported as unavailable.

Website pages and products are imported through the authenticated
`/api/website-ingestion/{pages,products,batch}` endpoints; the crawler ingests
pages and the connected-site SDK can submit products. Repeated URLs and product
IDs are upserted; content hashes avoid rebuilding unchanged page chunks. Tenant ownership is enforced in every
search and write query. Website administrators can inspect sync status, errors,
pages, products, and indexed pages through
`/api/website-integrations/:id/status`, `/pages`, `/products`, and `/knowledge`.
`POST /api/website-integrations/:id/sync` starts a crawl; the new
`POST /api/website-integrations/:id/rebuild-index` re-chunks already stored
active pages without touching product/catalogue data.

With `AGENT_RESPONSE_MODE=no-llm` (the default), routine website questions do not call Ollama. Complex merchant questions may
use the existing model path only when `OLLAMA_FALLBACK_ENABLED=true`; its
default is `false`. The current MySQL deployment provides FULLTEXT/ngram
retrieval but has no embedding model or vector-index service, so there is no
embedding/vector search configured. The engine uses explicit synonym
expansion and relevance ranking over FULLTEXT candidates instead.

Set `AGENT_RESPONSE_MODE=conversational` to restore model-generated dialogue for
greetings, grounded product explanations, ingredients, comparisons, website
answers and general wellness education. Both typed chat and voice use the same
agent service. The existing provider settings select native Ollama
(`LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`) or the already supported
Qwen GPU service (`LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL`, `LLM_MODEL`).
Conversational mode requires a reachable model; it does not silently substitute
raw retrieval text on failure. Cart actions still require verified merchant
confirmation. Raw tool results remain auditable; customer answers are validated
before display or synthesis. Selected-product follow-ups retain a bounded recent
history and retrieve the selected product again rather than relying on model memory
for its facts. Historical catalogue inventory must not be presented as live.

## McZEN agent runtime (Phase 5 — historical verification)

Run from `backend-nestjs` with Node.js 22+ and the existing local Ollama model.
An optional `.env` is read with Node's native loader. Shell environment values
take precedence. Do not overwrite an existing `.env`; `.env.example` documents
the local defaults:

| Setting | Default | Validation |
| --- | --- | --- |
| `AGENT_RESPONSE_MODE` | `no-llm` | `no-llm` or `conversational`; model choice still uses `LLM_PROVIDER` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | HTTP(S), no embedded credentials, query or fragment |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Nonempty bounded model identifier |
| `OLLAMA_TIMEOUT_MS` | `120000` | Integer, 1000–300000 ms, including response-body reading |
| `AGENT_MAX_ROUNDS` | `4` | Integer, 1–4; last round reserved for a tools-disabled final answer |
| `AGENT_MAX_TOOL_CALLS` | `5` | Integer, 1–5; includes invalid attempts and backend knowledge retrieval |

Invalid configuration fails at startup with the setting name, never its value.
The environment and connection URL are not placed in model messages; only the
configured model identifier is used in Ollama's required `model` field.

The existing request flow is retained:

1. The controller resolves the backend tenant context and returns `X-Request-Id`.
2. Application questions use the existing `knowledge_search` through the executor.
3. Ollama receives only enabled, tenant-available, permitted, non-confirmation tools.
4. All budgeted model calls go through `ToolExecutorService`, including unknown
   names and invalid arguments. The executor rechecks tenant, enabled status,
   permissions, runtime allowlist, schema, timeout and cancellation, and audits
   metadata only. No model call invokes a handler directly.
5. The last allowed round, or the next round after the call budget is used,
   asks for a final answer **without tools** and retains completed tool results.
   If that fails, a safe fallback preserves the collected tool metadata/sources.

Responses retain exactly `{ success, answer, model, toolCalls, sources }`.
Handled runtime failures return this body with `success: false`, not a raw
exception or an unnecessary 503. Nest's existing POST status (201) is preserved;
invalid requests and missing identity continue to return 400/401. Request IDs
are exposed in headers rather than adding fields to the response body.
Runtime logs contain request IDs, success flags and safe error codes only;
tool audit fields are unchanged. Timers/listeners are cleaned up after execution.
Abort signals notify underlying work; JavaScript cannot forcibly stop a handler
that ignores cancellation or blocks the event loop.

### Verification

```bash
npm run build
npm test                 # Ollama mocked; no running model required
npm run test:e2e         # Real HTTP routing/DI; Ollama mocked
node test/live-ollama-smoke.cjs  # Optional: actual installed Ollama, isolated ports
```

The live script starts/stops only its own backend processes and never modifies
`.env`, downloads models, connects a database, or creates real transactions.

Local verification recorded on **2026-11-01**:

| Check | Actual result |
| --- | --- |
| Backend `npm.cmd run build` | Passed |
| Backend `npm.cmd test` | 10 suites / 184 tests passed |
| Backend `npm.cmd test -- --maxWorkers=2` | 10 suites / 184 tests passed; clean worker exit |
| Backend `npm.cmd test -- --runInBand --detectOpenHandles` | 10 suites / 184 tests passed; no open handles reported |
| Backend `npm.cmd run test:e2e` | 1 suite / 16 tests passed; Ollama mocked |
| Backend TypeScript `--noEmit --incremental false` | Passed |
| Frontend `npm.cmd run build` | Passed; generated JavaScript contains neither the development header nor `VITE_DEV_TENANT_ID` |
| Native environment loader | Existing process value preserved; no environment file written |
| Actual local Ollama, `qwen2.5:3b` | 15 live checks passed / 0 failed |
| Actual React UI, isolated Chromium | 2 scenarios / 18 declared actions completed |

The live checks covered normal conversation, knowledge/source tracking, all
three catalogue/inventory tools for both demo tenants, foreign product/stock
non-disclosure, tool listings, CORS, missing identity, and production-header
rejection. The browser scenarios verified clicking Send and pressing Enter,
rendered assistant replies, `x-mczen-tenant-id: tenant-a`, English/Telugu/Hindi
selection, the default voice selector, replay/stop controls, and a rendered
microphone-permission-denied message. Browser Evidence IDs:

- `ev_6928c81201e4074aaac32527b5a8a2ae41450db057bd1b6699eccededbbc72d6`
- `ev_c28dae6e005ec1e9c55b3a450e5e51ff1c756b59ea0791e862c0233dea8db204`

These are interaction observations, not a complete network or audio recording:
some selected auxiliary network content hit the capture provider's fixed
five-second read deadline. The development tenant header value was captured
in the second scenario. No page JavaScript errors were recorded; the existing
missing `favicon.ico` produced a 404 console message. Both owned browser
profiles and the verification servers were cleaned up; existing port-3000
servers were not stopped. Default parallel Jest runs emitted a worker-exit
warning on this host; the two-worker and open-handle diagnostic runs were clean.

The React frontend is unchanged in Phase 5. Its temporary tenant header is gated
by `import.meta.env.DEV`; production builds must not contain that header.
Production backend requests still fail closed without verified authentication.
Demo catalogues/inventory remain in-memory and tenant-scoped. The existing
knowledge documents are shared, public demonstration documents, **not** a
production tenant-aware knowledge repository. Confirmation-required tools are
refused until a real confirmation workflow exists.

### Limitations and proposed Phase 6 work (not implemented)

- Authentication, durable audit/conversation storage, and tenant-private
  knowledge repositories remain absent. Replace the development resolver with
  verified identity and server-side grants before any production use.
- Ollama timeout is per round, not an overall request deadline. Add bounded
  request cancellation, concurrency/rate limits, and resource budgets next.
  Response length checks currently apply after body reading, not streaming.
- Cancellation stops waiting and signals work; non-cooperating or event-loop
  blocking handlers need process/worker isolation for forcible termination.
- Small-model tool selection is nondeterministic; the live checks are smoke
  coverage, not an accuracy or prompt-injection-resistance guarantee. Add
  repeatable tenant-isolation, malformed-output, grounding and quality evals.
- The language/audio controls were exercised, but audible output and successful
  microphone transcription were not verified. This browser exposed English
  voices but no Telugu/Hindi voices. Test supported devices and permissions.
- Define an explicit confirmation workflow before adding consequential tools.
  No real orders, transactions, payments, or new AI providers were added.

Phase 6 requires separate approval; the items above are recommendations only.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It installs `@nestjs/observe`, wires it into `AppModule` and `main.ts`, and writes the app key and secret into `.env`, which every `nest start` script (`start`, `start:dev`, `start:debug`) then loads. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/sdk) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

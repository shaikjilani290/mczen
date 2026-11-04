# Phase 6F — Persistent tools

Migration `ToolConfiguration1740000000008` adds the global `tools` catalog and
the tenant-scoped `tenant_tools`, `assistant_tools`, `tool_configurations`,
`tool_secrets`, and `tool_execution_logs` tables, plus global
`tool_permissions`. It is registered after migration 7 and has not been
applied to the VPS by this implementation.

The catalog is reconciled from code-bound tool definitions at application
startup. A missing `tenant_tools` row denies execution. Tenant and assistant
enablement, permissions, and non-secret configuration are read at request
time. Configuration is validated against each code-owned schema; secret-like
keys are rejected. Tool secrets use AES-256-GCM with `SECRET_MASTER_KEY` and
`SECRET_MASTER_KEY_VERSION` (default version `1`). Secret values and ciphertext
are never returned by APIs; decrypted values are provided only to the handler
after tenant, permission, confirmation, and input-validation checks.

Admin routes (all tenant-authenticated):

- `GET /api/tools`, `GET /api/tools/:toolId` — requires `tools:read`.
- `PATCH /api/tools/:toolId/tenant-config` — requires `tools:write`; accepts
  `enabled`, additive `extraPermissions`, and schema-validated `config`.
- `PUT /api/tools/:toolId/assistants/:assistantId` — persists assistant
  enablement; the runtime applies this to the verified assistant context or
  the tenant's default assistant.
- `GET/PUT/DELETE /api/tools/:toolId/tenant-secret` — reads status, rotates, or
  revokes the single credential slot for that tool. PUT body is
  `{ "value": "...", "expiresAt": null }`; responses contain status only.

The `max_calls_per_conversation` column is reserved in the schema but is not
exposed until conversation-level usage enforcement lands in Phase 6G.
`tool_execution_logs` is created here; the durable audit writer remains in
Phase 6G, consistent with the roadmap.

Apply migrations only as a reviewed operator action after the production
backup is confirmed. From `backend-nestjs`, run `npm run migration:run`, then
`npm run migration:check`; do not run this against the VPS without explicit
deployment approval.

# Phase 6G: conversations and transcripts

Migration `ConversationPersistence1740000000009` follows migration 8. It creates
the four conversation-domain tables and adds correlation/summary columns to
`tool_execution_logs`. It has not been run against any database.

## Migration verification

Before any deployment, take the approved database backup and review every
pending migration. Migration 8 is also pending on the VPS, and migration 9
depends on its `tool_execution_logs` table. The existing `migration:run` script
applies all pending registered migrations, not only migration 9.

From `backend-nestjs/`, using the approved migrator environment:

```powershell
npm run migration:show
npm run migration:check
```

Only after explicit deployment approval and review of all pending migrations:

```powershell
npm run migration:run
npm run migration:check
```

Verify `ConversationPersistence1740000000009` is recorded and these tables
exist: `conversations`, `conversation_messages`, `message_tool_calls`, and
`conversation_feedback`. Confirm `tool_execution_logs` has `assistant_id`,
`arguments_summary`, and `result_summary`, plus
`ix_tool_execution_logs_conversation`. `migration:check` must report no pending
or unknown migrations.

The application does not enable TypeORM synchronization or run migrations at
startup.

import { MigrationInterface } from 'typeorm';
import { DomainATenants1740000000001 } from './1740000000001-DomainATenants';
import { DomainBAuth1740000000002 } from './1740000000002-DomainBAuth';
import { SeedGlobalCatalogs1740000000003 } from './1740000000003-SeedGlobalCatalogs';
import { AuthPendingTokens1740000000004 } from './1740000000004-AuthPendingTokens';
import { AuthSecurityState1740000000005 } from './1740000000005-AuthSecurityState';
import { AssistantConfiguration1740000000006 } from './1740000000006-AssistantConfiguration';
import { KnowledgeManagement1740000000007 } from './1740000000007-KnowledgeManagement';
import { ToolConfiguration1740000000008 } from './1740000000008-ToolConfiguration';
import { ConversationPersistence1740000000009 } from './1740000000009-ConversationPersistence';
import { VoiceRuntime1740000000010 } from './1740000000010-VoiceRuntime';
import { WidgetSettings1740000000011 } from './1740000000011-WidgetSettings';
import { AuditEvents1740000000012 } from './1740000000012-AuditEvents';

/** Constructor type of one registered migration. */
export type MigrationCtor = new () => MigrationInterface;

/**
 * Migration registry, in the §12.4 order:
 *  Domain A (tenants) → Domain B (auth) → catalogs seed → 6C refinements
 *  (auth pending tokens + lockout/session revocation state). The registry is shared by the TypeORM CLI
 *  entrypoint (data-source.ts), the migration status script and the migration
 *  tests, so file order can drift without divergence. Explicit — no globs.
 */
export const ALL_MIGRATIONS: readonly MigrationCtor[] = [
  DomainATenants1740000000001,
  DomainBAuth1740000000002,
  SeedGlobalCatalogs1740000000003,
  AuthPendingTokens1740000000004,
  AuthSecurityState1740000000005,
  AssistantConfiguration1740000000006,
  KnowledgeManagement1740000000007,
  ToolConfiguration1740000000008,
  ConversationPersistence1740000000009,
  VoiceRuntime1740000000010,
  WidgetSettings1740000000011,
  AuditEvents1740000000012,
];

export {
  AuditEvents1740000000012,
  WidgetSettings1740000000011,
  KnowledgeManagement1740000000007,
  ToolConfiguration1740000000008,
  ConversationPersistence1740000000009,
  VoiceRuntime1740000000010,
  AssistantConfiguration1740000000006,
  DomainATenants1740000000001,
  DomainBAuth1740000000002,
  SeedGlobalCatalogs1740000000003,
  AuthPendingTokens1740000000004,
  AuthSecurityState1740000000005,
};

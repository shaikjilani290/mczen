import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { binaryToUuid, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import type { DateRange, WidgetSettingsUpdate } from './widget.dto';

type Row = Record<string, unknown>;

export interface WidgetSettingsView {
  publicKey: string;
  enabled: boolean;
  assistantId: string | null;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  theme: 'light' | 'dark' | 'auto';
  position: 'bottom-right' | 'bottom-left';
  buttonStyle: 'round' | 'pill' | 'square';
  welcomeMessage: string | null;
  initialGreeting: string | null;
  allowedOrigins: string[];
  keyRotatedAt: string | null;
  updatedAt: string;
}

export interface PublicWidgetTarget {
  tenantId: string;
  settings: WidgetSettingsView;
}

export interface WidgetAssistant {
  id: string;
  name: string;
  greeting: string | null;
  languages: string[];
  defaultLanguage: string;
}

const COLUMNS = ['public_key', 'enabled', 'assistant_id', 'name', 'logo_url', 'primary_color', 'theme', 'position', 'button_style',
  'welcome_message', 'initial_greeting', 'allowed_origins', 'key_rotated_at', 'updated_at'].map((column) => `w.\`${column}\``).join(',');

export function newPublicKey(): string {
  return `wk_${randomBytes(24).toString('base64url')}`;
}

@Injectable()
export class WidgetRepository {
  constructor(@InjectDataSource() private readonly source: DataSource) {}

  private async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.source.query(sql, params) as Promise<Row[]>;
  }

  async getOrCreate(tenantId: string): Promise<WidgetSettingsView> {
    const tenant = uuidToBinary(tenantId);
    const existing = await this.query(`SELECT ${COLUMNS} FROM \`widget_settings\` w WHERE w.\`tenant_id\`=?`, [tenant]);
    if (existing[0]) return mapSettings(existing[0]);
    const names = await this.query('SELECT `name` FROM `tenants` WHERE `id`=? AND `deleted_at` IS NULL', [tenant]);
    // INSERT IGNORE keeps concurrent first loads idempotent.
    await this.query(
      `INSERT IGNORE INTO \`widget_settings\` (\`tenant_id\`,\`public_key\`,\`name\`,\`allowed_origins\`) VALUES (?,?,?,JSON_ARRAY())`,
      [tenant, newPublicKey(), String(names[0]?.name ?? 'McZEN Assistant').slice(0, 100)],
    );
    const created = await this.query(`SELECT ${COLUMNS} FROM \`widget_settings\` w WHERE w.\`tenant_id\`=?`, [tenant]);
    return mapSettings(created[0]);
  }

  async update(tenantId: string, input: WidgetSettingsUpdate, userId: string): Promise<WidgetSettingsView> {
    await this.getOrCreate(tenantId);
    const map: Record<string, [string, (value: never) => unknown]> = {
      enabled: ['enabled', (v: boolean) => (v ? 1 : 0)],
      assistantId: ['assistant_id', (v: string | null) => (v ? uuidToBinary(v) : null)],
      name: ['name', (v: string) => v],
      logoUrl: ['logo_url', (v: string | null) => v],
      primaryColor: ['primary_color', (v: string) => v],
      theme: ['theme', (v: string) => v],
      position: ['position', (v: string) => v],
      buttonStyle: ['button_style', (v: string) => v],
      welcomeMessage: ['welcome_message', (v: string | null) => v],
      initialGreeting: ['initial_greeting', (v: string | null) => v],
      allowedOrigins: ['allowed_origins', (v: string[]) => JSON.stringify(v)],
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(input)) {
      const entry = map[key];
      if (!entry) continue;
      sets.push(`\`${entry[0]}\`=?`);
      params.push(entry[1](value as never));
    }
    sets.push('`updated_by`=?');
    params.push(uuidToBinary(userId), uuidToBinary(tenantId));
    await this.query(`UPDATE \`widget_settings\` SET ${sets.join(',')} WHERE \`tenant_id\`=?`, params);
    return this.getOrCreate(tenantId);
  }

  async rotateKey(tenantId: string, userId: string): Promise<WidgetSettingsView> {
    await this.getOrCreate(tenantId);
    await this.query(
      'UPDATE `widget_settings` SET `public_key`=?,`key_rotated_at`=UTC_TIMESTAMP(3),`updated_by`=? WHERE `tenant_id`=?',
      [newPublicKey(), uuidToBinary(userId), uuidToBinary(tenantId)],
    );
    return this.getOrCreate(tenantId);
  }

  /** Only live, active tenants resolve; suspended or deleted tenants never serve a widget. */
  async findByPublicKey(publicKey: string): Promise<PublicWidgetTarget | undefined> {
    const rows = await this.query(
      `SELECT w.\`tenant_id\`,${COLUMNS} FROM \`widget_settings\` w
       JOIN \`tenants\` t ON t.\`id\`=w.\`tenant_id\`
       WHERE w.\`public_key\`=? AND t.\`status\`='active' AND t.\`deleted_at\` IS NULL`,
      [publicKey],
    );
    const row = rows[0];
    return row ? { tenantId: binaryToUuid(row.tenant_id as Uint8Array), settings: mapSettings(row) } : undefined;
  }

  async findForTenant(tenantId: string): Promise<PublicWidgetTarget | undefined> {
    const rows = await this.query(
      `SELECT w.\`tenant_id\`,${COLUMNS} FROM \`widget_settings\` w
       JOIN \`tenants\` t ON t.\`id\`=w.\`tenant_id\`
       WHERE w.\`tenant_id\`=? AND t.\`status\`='active' AND t.\`deleted_at\` IS NULL`,
      [uuidToBinary(tenantId)],
    );
    const row = rows[0];
    return row ? { tenantId, settings: mapSettings(row) } : undefined;
  }

  /** Preferred assistant if active, otherwise the tenant default, otherwise the oldest active one. */
  async resolveAssistant(tenantId: string, preferred: string | null): Promise<WidgetAssistant | undefined> {
    const tenant = uuidToBinary(tenantId);
    const rows = await this.query(
      `SELECT a.\`id\`,a.\`name\`,a.\`greeting_message\`,a.\`branding_display_name\` FROM \`assistants\` a
       WHERE a.\`tenant_id\`=? AND a.\`status\`='active' AND a.\`deleted_at\` IS NULL
       ORDER BY (a.\`id\`=?) DESC, a.\`is_default\` DESC, a.\`created_at\` ASC LIMIT 1`,
      [tenant, preferred ? uuidToBinary(preferred) : Buffer.alloc(16)],
    );
    const assistant = rows[0];
    if (!assistant) return undefined;
    const languages = await this.query(
      'SELECT `language_code`,`is_default` FROM `assistant_language_settings` WHERE `assistant_id`=? AND `tenant_id`=? AND `is_enabled`=1',
      [assistant.id, tenant],
    );
    const codes = languages.map((row) => String(row.language_code)).filter((code) => ['en', 'hi', 'te'].includes(code));
    return {
      id: binaryToUuid(assistant.id as Uint8Array),
      name: String(assistant.name),
      greeting: (assistant.greeting_message as string | null) ?? null,
      languages: codes.length ? codes : ['en'],
      defaultLanguage: String(languages.find((row) => Number(row.is_default) === 1)?.language_code ?? codes[0] ?? 'en'),
    };
  }

  async createWidgetConversation(tenantId: string, assistantId: string, language: string): Promise<string> {
    const id = newUuidv7();
    await this.query(
      `INSERT INTO \`conversations\` (\`id\`,\`tenant_id\`,\`assistant_id\`,\`user_id\`,\`title\`,\`channel\`,\`language_code\`)
       VALUES (?,?,?,NULL,NULL,'widget',?)`,
      [uuidToBinary(id), uuidToBinary(tenantId), uuidToBinary(assistantId), language],
    );
    return id;
  }

  /** Aggregates read only persisted conversation, message, tool-audit and voice-session rows. */
  async analytics(tenantId: string, range: DateRange) {
    const tenant = uuidToBinary(tenantId);
    const span = [tenant, range.from, range.to];
    const [totals, daily, modality, languages, tools, assistants, knowledge, voice, widgetCount] = await Promise.all([
      this.query(
        `SELECT COUNT(*) AS conversations, SUM(c.\`channel\`='voice') AS voice, SUM(c.\`channel\`='chat') AS chat,
           SUM(c.\`channel\`='widget') AS widget FROM \`conversations\` c
         WHERE c.\`tenant_id\`=? AND c.\`deleted_at\` IS NULL AND c.\`created_at\`>=? AND c.\`created_at\`<?`, span),
      this.query(
        `SELECT DATE(c.\`created_at\`) AS day, COUNT(*) AS total FROM \`conversations\` c
         WHERE c.\`tenant_id\`=? AND c.\`deleted_at\` IS NULL AND c.\`created_at\`>=? AND c.\`created_at\`<?
         GROUP BY day ORDER BY day`, span),
      this.query(
        `SELECT m.\`modality\` AS modality, COUNT(*) AS total FROM \`conversation_messages\` m
         WHERE m.\`tenant_id\`=? AND m.\`created_at\`>=? AND m.\`created_at\`<? GROUP BY m.\`modality\``, span),
      this.query(
        `SELECT COALESCE(m.\`language_code\`,'unknown') AS language, COUNT(*) AS total FROM \`conversation_messages\` m
         WHERE m.\`tenant_id\`=? AND m.\`role\`='user' AND m.\`created_at\`>=? AND m.\`created_at\`<?
         GROUP BY language ORDER BY total DESC LIMIT 20`, span),
      this.query(
        `SELECT l.\`tool_name\` AS tool, l.\`outcome\` AS outcome, COUNT(*) AS total FROM \`tool_execution_logs\` l
         WHERE l.\`tenant_id\`=? AND l.\`started_at\`>=? AND l.\`started_at\`<?
         GROUP BY l.\`tool_name\`, l.\`outcome\` ORDER BY total DESC LIMIT 100`, span),
      this.query(
        `SELECT a.\`id\` AS id, a.\`name\` AS name, COUNT(*) AS total FROM \`conversations\` c
         JOIN \`assistants\` a ON a.\`id\`=c.\`assistant_id\` AND a.\`tenant_id\`=c.\`tenant_id\`
         WHERE c.\`tenant_id\`=? AND c.\`deleted_at\` IS NULL AND c.\`created_at\`>=? AND c.\`created_at\`<?
         GROUP BY a.\`id\`, a.\`name\` ORDER BY total DESC LIMIT 50`, span),
      this.query(
        `SELECT SUM(\`status\`='published') AS published, COUNT(*) AS total FROM \`knowledge_articles\` WHERE \`tenant_id\`=?`, [tenant]),
      this.query(
        `SELECT COUNT(*) AS active FROM \`voice_sessions\` WHERE \`tenant_id\`=? AND \`ended_at\` IS NULL
         AND \`last_active_at\`>=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)`, [tenant]),
      this.query('SELECT COUNT(*) AS total FROM `conversation_messages` WHERE `tenant_id`=? AND `created_at`>=? AND `created_at`<?', span),
    ]);
    const n = (value: unknown) => Number(value ?? 0);
    return {
      range: { from: range.from.toISOString().slice(0, 10), to: new Date(range.to.getTime() - 86_400_000).toISOString().slice(0, 10) },
      totals: {
        conversations: n(totals[0]?.conversations),
        messages: n(widgetCount[0]?.total),
        voiceConversations: n(totals[0]?.voice),
        textConversations: n(totals[0]?.chat),
        widgetConversations: n(totals[0]?.widget),
        knowledgeArticles: n(knowledge[0]?.total),
        publishedKnowledgeArticles: n(knowledge[0]?.published),
        activeVoiceSessions: n(voice[0]?.active),
      },
      dailyConversations: daily.map((row) => ({ day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day), total: n(row.total) })),
      messagesByModality: modality.map((row) => ({ modality: String(row.modality), total: n(row.total) })),
      languageDistribution: languages.map((row) => ({ language: String(row.language), total: n(row.total) })),
      toolUsage: tools.map((row) => ({ tool: String(row.tool), outcome: String(row.outcome), total: n(row.total) })),
      assistantUsage: assistants.map((row) => ({ assistantId: binaryToUuid(row.id as Uint8Array), name: String(row.name), conversations: n(row.total) })),
    };
  }

  // Platform-level reads intentionally span tenants and are reachable only via @RequirePlatform.
  async platformTenants(page: number, pageSize: number) {
    const rows = await this.query(
      `SELECT t.\`id\`,t.\`name\`,t.\`slug\`,t.\`status\`,t.\`created_at\`,
         (SELECT COUNT(*) FROM \`assistants\` a WHERE a.\`tenant_id\`=t.\`id\` AND a.\`deleted_at\` IS NULL) AS assistants,
         (SELECT COUNT(*) FROM \`conversations\` c WHERE c.\`tenant_id\`=t.\`id\` AND c.\`deleted_at\` IS NULL) AS conversations,
         (SELECT w.\`enabled\` FROM \`widget_settings\` w WHERE w.\`tenant_id\`=t.\`id\`) AS widget_enabled
       FROM \`tenants\` t WHERE t.\`deleted_at\` IS NULL ORDER BY t.\`created_at\` DESC LIMIT ? OFFSET ?`,
      [pageSize, (page - 1) * pageSize],
    );
    const total = await this.query('SELECT COUNT(*) AS total FROM `tenants` WHERE `deleted_at` IS NULL');
    return {
      items: rows.map((row) => ({
        id: binaryToUuid(row.id as Uint8Array), name: String(row.name), slug: String(row.slug), status: String(row.status),
        createdAt: row.created_at, assistants: Number(row.assistants), conversations: Number(row.conversations),
        widgetEnabled: row.widget_enabled === null ? null : Number(row.widget_enabled) === 1,
      })),
      page, pageSize, total: Number(total[0]?.total ?? 0),
    };
  }

  async platformOverview() {
    const rows = await this.query(
      `SELECT (SELECT COUNT(*) FROM \`tenants\` WHERE \`deleted_at\` IS NULL) AS tenants,
         (SELECT COUNT(*) FROM \`tenants\` WHERE \`deleted_at\` IS NULL AND \`status\`='active') AS active_tenants,
         (SELECT COUNT(*) FROM \`assistants\` WHERE \`deleted_at\` IS NULL) AS assistants,
         (SELECT COUNT(*) FROM \`conversations\` WHERE \`deleted_at\` IS NULL) AS conversations,
         (SELECT COUNT(*) FROM \`widget_settings\` WHERE \`enabled\`=1) AS widgets`,
    );
    const row = rows[0] ?? {};
    return {
      tenants: Number(row.tenants ?? 0), activeTenants: Number(row.active_tenants ?? 0), assistants: Number(row.assistants ?? 0),
      conversations: Number(row.conversations ?? 0), enabledWidgets: Number(row.widgets ?? 0),
    };
  }

  async setTenantStatus(tenantId: string, status: 'active' | 'suspended', reason: string | null): Promise<boolean> {
    const result = await this.source.query(
      `UPDATE \`tenants\` SET \`status\`=?,\`suspended_at\`=${status === 'suspended' ? 'UTC_TIMESTAMP(3)' : 'NULL'},\`suspended_reason\`=?
       WHERE \`id\`=? AND \`deleted_at\` IS NULL AND \`status\`<>'closed'`,
      [status, status === 'suspended' ? reason : null, uuidToBinary(tenantId)],
    ) as { affectedRows?: number };
    return (result.affectedRows ?? 0) > 0;
  }
}

function mapSettings(row: Row): WidgetSettingsView {
  const origins = typeof row.allowed_origins === 'string' ? JSON.parse(row.allowed_origins) as unknown : row.allowed_origins;
  return {
    publicKey: String(row.public_key),
    enabled: Number(row.enabled) === 1,
    assistantId: row.assistant_id ? binaryToUuid(row.assistant_id as Uint8Array) : null,
    name: String(row.name),
    logoUrl: (row.logo_url as string | null) ?? null,
    primaryColor: String(row.primary_color),
    theme: row.theme as WidgetSettingsView['theme'],
    position: row.position as WidgetSettingsView['position'],
    buttonStyle: row.button_style as WidgetSettingsView['buttonStyle'],
    welcomeMessage: (row.welcome_message as string | null) ?? null,
    initialGreeting: (row.initial_greeting as string | null) ?? null,
    allowedOrigins: Array.isArray(origins) ? origins.map(String) : [],
    keyRotatedAt: row.key_rotated_at ? new Date(row.key_rotated_at as Date).toISOString() : null,
    updatedAt: new Date(row.updated_at as Date).toISOString(),
  };
}

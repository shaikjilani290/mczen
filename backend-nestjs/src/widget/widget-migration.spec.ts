import { WidgetSettings1740000000011 } from '../database/migrations/1740000000011-WidgetSettings';
import { ALL_MIGRATIONS } from '../database/migrations';
import { widgetCorsOptions, WIDGET_PUBLIC_PATH } from '../auth/cors.config';

describe('migration 11 widget_settings', () => {
  const run = async (method: 'up' | 'down') => {
    const sql: string[] = [];
    await new WidgetSettings1740000000011()[method]({ query: async (text: string) => { sql.push(text); } } as never);
    return sql.join('\n');
  };
  it('is registered directly after migration 10, and is tenant-keyed with a unique public key', async () => {
    expect(ALL_MIGRATIONS).toContain(WidgetSettings1740000000011);
    expect(ALL_MIGRATIONS[ALL_MIGRATIONS.indexOf(WidgetSettings1740000000011) - 1]?.name).toBe('VoiceRuntime1740000000010');
    const up = await run('up');
    expect(up).toContain('CREATE TABLE `widget_settings`');
    expect(up).toContain('PRIMARY KEY (`tenant_id`)');
    expect(up).toContain('UNIQUE KEY `uk_widget_settings_public_key`');
    expect(up).toContain('ON DELETE CASCADE');
  });
  it('rolls back by dropping only its own table', async () => {
    expect(await run('down')).toBe('DROP TABLE IF EXISTS `widget_settings`');
  });
});

describe('public widget CORS', () => {
  it('is limited to the public widget path, POST, no credentials, no cookies', () => {
    expect(WIDGET_PUBLIC_PATH).toBe('/api/widget/public/');
    expect(widgetCorsOptions.credentials).toBe(false);
    expect(widgetCorsOptions.methods).toEqual(['POST', 'OPTIONS']);
    expect(widgetCorsOptions.allowedHeaders).toEqual(['Content-Type', 'Authorization']);
  });
});

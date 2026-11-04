import { Logger } from '@nestjs/common';
import { ToolAuditService } from './tool-audit.service';

describe('ToolAuditService durable writes', () => {
  it('keeps audit failures observable without throwing into the agent response path', async () => {
    const sink = { persistToolAudit: jest.fn().mockRejectedValue(new Error('database details')) };
    const logger = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const audit = new ToolAuditService(sink);
    const record = {
      tenantId: '018f47b2-7c00-7000-8000-000000000001',
      toolName: 'search',
      requestId: 'req-1',
      executedAt: new Date().toISOString(),
      durationMs: 2,
      outcome: 'succeeded' as const,
      errorCode: null,
      argumentsDigest: 'a'.repeat(64),
      argumentsSize: 10,
      argumentsSummary: { keys: ['query'] },
    };

    await expect(audit.record(record)).resolves.toBeUndefined();
    await audit.flush();

    expect(audit.list()).toContainEqual(record);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(String(logger.mock.calls[0][0])).toContain('tool_audit_persistence_failed');
    expect(String(logger.mock.calls[0][0])).not.toContain('database details');
    logger.mockRestore();
  });
});

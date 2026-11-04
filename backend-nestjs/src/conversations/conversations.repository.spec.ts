import { DataSource, EntityManager } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { tenantContextStore } from '../common/tenant/tenant-context.store';
import { uuidToBinary } from '../common/ids/uuid';
import { ConversationsRepository } from './conversations.repository';

const tenantId = '018f47b2-7c00-7000-8000-000000000001';
const userId = '018f47b2-7c00-7000-8000-000000000002';
const conversationId = '018f47b2-7c00-7000-8000-000000000003';

function context() {
  return {
    tenantId, userId, actorType: 'user' as const, permissions: ['conversations:read', 'conversations:write'],
  };
}

describe('ConversationsRepository tenant boundaries and persistence', () => {
  it('scopes detail access by tenant and user, returning not-found for foreign conversations', async () => {
    const source = {
      getRepository: jest.fn(() => ({})),
      query: jest.fn().mockResolvedValue([]),
    } as unknown as DataSource;
    const repository = new ConversationsRepository(source);

    await tenantContextStore.run(context(), async () => {
      await expect(repository.find(conversationId, userId)).rejects.toThrow(NotFoundException);
      const [sql, params] = (source.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('`tenant_id`=?');
      expect(sql).toContain('`user_id`=?');
      expect(params).toEqual([uuidToBinary(conversationId), uuidToBinary(tenantId), uuidToBinary(userId)]);
    });
  });

  it('persists transcript content with secret redaction and tool-call key summaries only', async () => {
    const managerQuery = jest.fn()
      .mockResolvedValueOnce({ insertId: 10 })
      .mockResolvedValueOnce({ insertId: 11 })
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({ insertId: 2 })
      .mockResolvedValueOnce({ affectedRows: 1 });
    const source = {
      getRepository: jest.fn(() => ({})),
      query: jest.fn().mockResolvedValue([{
        id: uuidToBinary(conversationId),
        assistant_id: uuidToBinary('018f47b2-7c00-7000-8000-000000000004'),
        user_id: uuidToBinary(userId),
        status: 'open',
        language_code: 'en',
      }]),
      transaction: jest.fn((callback: (manager: EntityManager) => Promise<void>) =>
        callback({ query: managerQuery } as unknown as EntityManager)),
    } as unknown as DataSource;
    const repository = new ConversationsRepository(source);
    const execution = {
      tenantId, userId, conversationId,
      assistantId: '018f47b2-7c00-7000-8000-000000000004',
      permissions: ['conversations:write'], requestId: 'req-test',
    };

    await tenantContextStore.run(context(), () => repository.persistTurn(
      execution,
      'my password=private-value',
      { success: true, answer: 'Done.', model: 'test', toolCalls: [], sources: [] },
      [{
        name: 'search', round: 0, sequence: 0,
        arguments: { query: 'private-value', apiKey: 'private-value' },
        outcome: 'succeeded', errorCode: null, durationMs: 1, resultSummary: { resultCount: 1 },
      }],
    ));

    const inserted = managerQuery.mock.calls.map(([sql, params]) => ({ sql: String(sql), params: params as unknown[] }));
    const messages = inserted.filter((entry) => entry.sql.includes('INSERT INTO `conversation_messages`'));
    expect(messages.map((entry) => entry.params[3])).toEqual(['user', 'assistant']);
    expect(messages[0].params[4]).toBe('my password=[REDACTED]');
    const toolCall = inserted.find((entry) => entry.sql.includes('INSERT INTO `message_tool_calls`'));
    expect(toolCall?.params[5]).toBe(JSON.stringify({ keys: ['query'] }));
    expect(JSON.stringify(inserted)).not.toContain('private-value');
  });

  it('stores detected voice language and modality on both transcript messages', async () => {
    const managerQuery = jest.fn()
      .mockResolvedValueOnce({ insertId: 20 })
      .mockResolvedValueOnce({ insertId: 21 });
    const source = {
      getRepository: jest.fn(() => ({})),
      query: jest.fn().mockResolvedValue([{
        id: uuidToBinary(conversationId),
        assistant_id: uuidToBinary('018f47b2-7c00-7000-8000-000000000004'),
        user_id: uuidToBinary(userId),
        status: 'open',
        language_code: null,
      }]),
      transaction: jest.fn((callback: (manager: EntityManager) => Promise<void>) =>
        callback({ query: managerQuery } as unknown as EntityManager)),
    } as unknown as DataSource;
    const repository = new ConversationsRepository(source);

    await tenantContextStore.run(context(), () => repository.persistTurn({
      tenantId,
      userId,
      conversationId,
      assistantId: '018f47b2-7c00-7000-8000-000000000004',
      modality: 'voice',
      language: 'hi',
      permissions: ['conversations:write'],
      requestId: 'req-voice',
    }, 'नमस्ते', {
      success: true, answer: 'नमस्कार।', model: 'test', toolCalls: [], sources: [],
    }, []));

    const messages = managerQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO `conversation_messages`'));
    expect(messages.map(([, params]) => [params[6], params[7]])).toEqual([
      ['hi', 'voice'],
      ['hi', 'voice'],
    ]);
  });

  it('stores durable tool audits with tenant and assistant correlation but no argument values', async () => {
    const source = {
      getRepository: jest.fn(() => ({})),
      query: jest.fn().mockResolvedValue({ insertId: 1 }),
    } as unknown as DataSource;
    const repository = new ConversationsRepository(source);
    const record = {
      tenantId,
      assistantId: '018f47b2-7c00-7000-8000-000000000004',
      conversationId,
      userId,
      toolName: 'search',
      requestId: 'req-1',
      executedAt: new Date().toISOString(),
      durationMs: 8,
      outcome: 'succeeded' as const,
      errorCode: null,
      argumentsDigest: 'a'.repeat(64),
      argumentsSize: 15,
      argumentsSummary: { keys: ['query'] },
      resultSummary: { resultCount: 1 },
    };

    await tenantContextStore.run(context(), () => repository.persistToolAudit(record));
    const [sql, params] = (source.query as jest.Mock).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('`assistant_id`');
    expect(sql).toContain('`conversation_id`');
    expect(params).toContainEqual(uuidToBinary(tenantId));
    expect(params).toContainEqual(uuidToBinary(record.assistantId));
    expect(params).toContainEqual(uuidToBinary(conversationId));
    expect(params).toContain(JSON.stringify({ keys: ['query'] }));
    expect(JSON.stringify(params)).not.toContain('private');
  });
});

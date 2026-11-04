import { BadRequestException } from '@nestjs/common';
import {
  parseConversationQuery,
  parseCreateConversation,
  parseUpdateConversation,
} from './conversations.dto';

describe('conversation request validation', () => {
  const assistantId = '018f47b2-7c00-7000-8000-000000000001';

  it('rejects client-supplied tenant and owner identities', () => {
    expect(() => parseCreateConversation({ assistantId, tenantId: assistantId })).toThrow(BadRequestException);
    expect(() => parseUpdateConversation({ userId: assistantId })).toThrow(BadRequestException);
  });

  it('validates filters and allows only known sorting columns', () => {
    expect(parseConversationQuery({ sortBy: 'createdAt', sortOrder: 'asc' })).toMatchObject({
      page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'asc',
    });
    expect(() => parseConversationQuery({ sortBy: 'tenant_id' })).toThrow(BadRequestException);
  });

  it('redacts credential-shaped metadata and rejects secret-bearing keys', () => {
    expect(parseCreateConversation({
      assistantId,
      metadata: { note: 'password=topsecret', tags: ['api_key=secret'] },
    }).metadata).toEqual({ note: 'password=[REDACTED]', tags: ['api_key=[REDACTED]'] });
    expect(() => parseUpdateConversation({ metadata: { apiKey: 'secret' } })).toThrow(BadRequestException);
  });
});

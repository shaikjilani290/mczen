import { ProductIdentityService, normalizeProductName, productMentions } from './product-identity.service';
import { WebsiteIntegrationRepository } from './website-integration.repository';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { newUuidv7 } from '../common/ids/uuid';

const vocabulary = [
  { name: 'ZENAGE', externalProductId: 'zenage-id' },
  { name: 'EDGE', externalProductId: 'edge-id' },
  { name: 'WEIZAP', externalProductId: 'weizap-id' },
  { name: 'LASS HEALTH', externalProductId: 'lass-id' },
  { name: 'HALE.O', externalProductId: 'hale-id' },
  { name: 'AURA STRESS FREE COFFEE', externalProductId: 'aura-id' },
];

describe('exact merchant product identity', () => {
  it.each(['ZENAGE', 'WEIZAP', 'LASS HEALTH', 'HALE.O', 'AURA STRESS FREE COFFEE'])('preserves %s', name => {
    expect(productMentions(`Explain ${name}.`, vocabulary).map(product => product.name)).toEqual([name]);
  });
  it('supports punctuation/case normalization without phonetic or substring substitution', () => {
    expect(normalizeProductName(' HALE.O ')).toBe(normalizeProductName('hale o'));
    expect(productMentions('Tell me about ZENAGE.', vocabulary)).not.toContainEqual(vocabulary[1]);
    expect(productMentions('Explain Genedge or Janet.', vocabulary)).toEqual([]);
    expect(productMentions('Explain WEIZAPPER.', vocabulary)).toEqual([]);
    expect(productMentions('Compare ZENAGE and WEIZAP.', vocabulary)).toHaveLength(2);
  });
  it('loads only the backend-established merchant catalogue with read permission', async () => {
    const repository = new WebsiteIntegrationRepository();
    const read = jest.spyOn(repository, 'productVocabulary').mockResolvedValue(vocabulary);
    const service = new ProductIdentityService(repository);
    const context: AgentExecutionContext = { tenantId: newUuidv7(), assistantId: newUuidv7(),
      requestId: 'voice-turn', permissions: ['products:read'],
      merchant: { integrationId: newUuidv7(), sessionId: 'visitor', origin: 'https://merchant.example' } };
    expect(await service.vocabulary(context)).toEqual(vocabulary);
    expect(read).toHaveBeenCalledWith(context.tenantId, context.assistantId, context.merchant!.integrationId);
    expect(await service.vocabulary({ ...context, permissions: [] })).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

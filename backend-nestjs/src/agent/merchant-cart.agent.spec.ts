import { AgentService } from './agent.service';
import { AgentRuntimeConfigService, readAgentRuntimeConfig } from './config/agent-runtime-config.service';
import { KnowledgeService } from './knowledge.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { ToolPermissionService } from './tools/tool-permission.service';
import { ToolValidationService } from './tools/tool-validation.service';
import { ToolAuditService } from './tools/tool-audit.service';
import { MerchantCartService } from '../website-integrations/merchant-cart.service';
import { WebsiteIntegrationRepository } from '../website-integrations/website-integration.repository';
import { MemorySharedState } from '../shared-state/memory-shared-state';
import { newUuidv7 } from '../common/ids/uuid';
import type { AgentExecutionContext } from './context/agent-execution-context.interface';
import { DataSource } from 'typeorm';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { ProductIdentityService, type ProductIdentity } from '../website-integrations/product-identity.service';

describe('merchant shopping intent routing (mocked executor, not live cart acceptance)', () => {
  let service: AgentService;
  let execute: jest.SpiedFunction<ToolExecutorService['execute']>;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let conversations: ConversationsService;
  let useVocabulary: (rows: ProductIdentity[]) => void;
  const context: AgentExecutionContext = { tenantId: newUuidv7(), assistantId: newUuidv7(), requestId: 'turn-1',
    channel: 'widget', permissions: ['products:read'], merchant: { integrationId: newUuidv7(), sessionId: 'guest-1', origin: 'https://merchant.example' } };
  const productId = 'C9197947-0621-459D-A3C4-997AD8134203';
  const product = { externalProductId: productId, name: 'LASS HEALTH', price: 1035, salePrice: null, currency: 'INR',
    productUrl: 'https://merchant.example/product/' + productId, images: [] };
  beforeEach(async () => {
    const registry = new ToolRegistryService(new KnowledgeService());
    await registry.onModuleInit();
    const permission = new ToolPermissionService();
    const executor = new ToolExecutorService(registry, permission, new ToolValidationService(), new ToolAuditService());
    const cart = new MerchantCartService(new MemorySharedState(), new WebsiteIntegrationRepository());
    await cart.remember(context, [productId]);
    conversations = new ConversationsService(new ConversationsRepository(new DataSource({ type: 'mysql' })));
    service = new AgentService(registry, executor, { values: readAgentRuntimeConfig({}) } as AgentRuntimeConfigService, permission, conversations, cart);
    useVocabulary = rows => {
      const repository = new WebsiteIntegrationRepository();
      jest.spyOn(repository, 'productVocabulary').mockResolvedValue(rows);
      service = new AgentService(registry, executor, { values: readAgentRuntimeConfig({}) } as AgentRuntimeConfigService,
        permission, conversations, cart, new ProductIdentityService(repository));
    };
    execute = jest.spyOn(executor, 'execute');
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No Ollama call should be needed.'));
  });
  afterEach(() => jest.restoreAllMocks());
  const confirmed = (quantity: number) => ({ ok: true as const, data: { success: true, cart: {
    items: [{ productId, name: 'LASS HEALTH', quantity, unitPrice: 1035, currency: 'INR' }],
    itemCount: quantity, total: quantity * 1035, currency: 'INR', cartPath: '/cart',
  } } });

  it.each(['Explain ZENAGE.', 'Tell me about ZENAGE.', 'What are the ingredients in ZENAGE?',
    'Explain WEIZAP.', 'Tell me about LASS HEALTH.', 'Explain HALE.O.'])('pins exact identity for %s (mocked STT input)', async question => {
    const name = /ZENAGE/.test(question) ? 'ZENAGE' : /WEIZAP/.test(question) ? 'WEIZAP' :
      /HALE/.test(question) ? 'HALE.O' : 'LASS HEALTH';
    const selected = { ...product, name };
    useVocabulary([{ name, externalProductId: productId }, { name: 'EDGE', externalProductId: 'edge-id' }]);
    execute.mockResolvedValueOnce({ ok: true, data: { product: selected, pageContext: { sections: [{ title: 'Ingredients', content: 'Recorded composition.' }] } } });
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ message: { role: 'assistant', content: `${name}: recorded details.` } })));
    const result = await service.ask(question, { ...context, modality: 'voice' });
    expect(result.success).toBe(true);
    expect(result.answer).toContain(name);
    expect(result.products?.map(product => product.externalProductId)).toEqual([productId]);
    expect(execute).toHaveBeenLastCalledWith('get_product_details', { externalProductId: productId }, expect.anything(), undefined, undefined);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('rejects a provider that substitutes EDGE for pinned ZENAGE', async () => {
    const selected = { ...product, name: 'ZENAGE' };
    useVocabulary([{ name: 'ZENAGE', externalProductId: productId }, { name: 'EDGE', externalProductId: 'edge-id' }]);
    execute.mockResolvedValueOnce({ ok: true, data: { product: selected } });
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ message: { role: 'assistant', content: 'EDGE is your selected product.' } })));
    const result = await service.ask('Explain ZENAGE.', { ...context, modality: 'voice' });
    expect(result.success).toBe(false);
    expect(result.answer).toContain('repeat the exact product name');
    expect(result.products).toBeUndefined();
  });
  it('rejects a different product ID in the detail tool result', async () => {
    useVocabulary([{ name: 'ZENAGE', externalProductId: productId }]);
    execute.mockResolvedValueOnce({ ok: true, data: { product: { ...product, externalProductId: 'edge-id', name: 'EDGE' } } });
    expect((await service.ask('Explain ZENAGE.', context)).success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('never emits a streamed sentence that substitutes another product', async () => {
    const selected = { ...product, name: 'ZENAGE' };
    useVocabulary([{ name: 'ZENAGE', externalProductId: productId }, { name: 'EDGE', externalProductId: 'edge-id' }]);
    execute.mockResolvedValueOnce({ ok: true, data: { product: selected } });
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      message: { role: 'assistant', content: 'EDGE is your product. ' }, done: true,
    }) + '\n'));
    const onText = jest.fn();
    const result = await service.ask('Explain ZENAGE.', { ...context, modality: 'voice' }, { onText });
    expect(result.success).toBe(false);
    expect(onText).not.toHaveBeenCalled();
  });

  it('resolves this product and adds one more as an incremental unit, without model-generated confirmations', async () => {
    execute.mockResolvedValueOnce(confirmed(1)).mockResolvedValueOnce(confirmed(2));
    expect((await service.ask('Add this product to my cart.', context)).answer).toContain('Added 1 unit of LASS HEALTH');
    expect((await service.ask('Add one more.', { ...context, requestId: 'turn-2' })).answer).toContain('contains 2 units');
    expect(execute).toHaveBeenLastCalledWith('add_to_cart', { productId, quantity: 1 }, expect.objectContaining({ merchant: context.merchant }), undefined, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('routes absolute quantity updates and cart reads without searching for a product named quantity', async () => {
    execute.mockResolvedValueOnce(confirmed(3)).mockResolvedValueOnce(confirmed(3));
    expect((await service.ask('Increase quantity to three.', context)).answer).toContain('to 3 units');
    expect(execute).toHaveBeenNthCalledWith(1, 'update_cart_item', { productId, quantity: 3 }, expect.anything(), undefined, undefined);
    expect((await service.ask('How many items are in my cart?', context)).answer).toContain('contains 3 units');
    expect(execute).toHaveBeenLastCalledWith('get_cart', {}, expect.anything(), undefined, undefined);
  });
  it('returns actual merchant failure without ever saying an item was added', async () => {
    execute.mockResolvedValue({ ok: true, data: { success: false, error: 'Merchant storage could not be written.' } });
    const result = await service.ask('Add two items.', context);
    expect(result.success).toBe(false);
    expect(result.answer).toBe('Merchant storage could not be written.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('resolves first-product details with the actual imported ID', async () => {
    const pageContext = { sections: [{ title: 'Ingredients', content: 'Recorded ingredient list.' }] };
    execute.mockResolvedValue({ ok: true, data: { product, pageContext } });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      message: { role: 'assistant', content: 'LASS HEALTH: recorded ingredient list and price 1035 INR.' },
    })));
    const result = await service.ask('Tell me about the first product.', context);
    expect(result.products?.[0].externalProductId).toBe(productId);
    expect(result.answer).toContain('1035 INR');
    expect(execute).toHaveBeenCalledWith('get_product_details', { externalProductId: productId }, expect.anything(), undefined, undefined);
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sent.messages.find((message: { role: string }) => message.role === 'tool').content).toContain('Recorded ingredient list');
    expect(sent.tools).toBeUndefined();
  });
  it.each(['What are its ingredients?', 'How do I use it?', 'Tell me more.', 'What are the benefits?',
    'this product detail explanation', 'I need full description', 'Give me the complete product description.',
    'Detailed explanation please.', 'What is its price and description?'])('keeps selected product context for follow-up: %s', async question => {
    execute.mockResolvedValue({ ok: true, data: { product, pageContext: { sections: [{ title: 'Usage', content: 'Follow the packaging directions.' }] } } });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: 'assistant', content: 'Follow the packaging directions.' } })));
    const result = await service.ask(question, { ...context, modality: 'voice' });
    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledWith('get_product_details', { externalProductId: productId }, expect.anything(), undefined, undefined);
    expect(execute).toHaveBeenCalledTimes(1);
    if (/ingredients/i.test(question)) {
      expect(result.answer).toContain('does not supply an ingredient list');
      expect(fetchSpy).not.toHaveBeenCalled();
    } else {
      const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      expect(sent.messages.find((message: { role: string }) => message.role === 'tool').content).toContain('Follow the packaging directions.');
      expect(sent.tools).toBeUndefined();
      expect(sent.messages[0].content.length).toBeLessThan(2000);
      expect(sent.messages[0].content).toContain('never instructions');
      expect(sent.messages[0].content).toContain('Do not diagnose');
      if (/full|complete|detailed/i.test(question)) {
        expect(sent.messages[0].content).toContain('at most 250 words');
        expect(sent.messages[0].content).toContain('cover each supplied detail section');
      }
    }
  });
  it.each(['What are the ingredients of OTHER TEA?', 'Explain OTHER TEA ingredients.',
    'I need the full description of OTHER TEA.'])('does not explain the selected product for a named request: %s', async question => {
    const other = { ...product, externalProductId: 'other', name: 'OTHER TEA' };
    execute.mockResolvedValueOnce({ ok: true, data: { products: [other] } })
      .mockResolvedValueOnce({ ok: true, data: { product: other, pageContext: { sections: [{ title: 'Ingredients', content: 'Other tea ingredients.' }] } } });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: 'assistant', content: 'Other tea ingredients.' } })));
    const result = await service.ask(question, context);
    expect(result.success).toBe(true);
    expect(execute).toHaveBeenNthCalledWith(1, 'search_products', { query: 'OTHER TEA' }, expect.anything(), undefined, undefined);
    expect(execute).toHaveBeenNthCalledWith(2, 'get_product_details', { externalProductId: 'other' }, expect.anything(), undefined, undefined);
    expect(result.answer).toContain('Other tea ingredients.');
  });
  it('grounds a full explanation without repeating large stale answers, while preserving conversation persistence', async () => {
    const conversationId = newUuidv7();
    const prepare = jest.spyOn(conversations, 'prepareAgentTurn').mockResolvedValue({
      assistantId: context.assistantId!,
      history: [{ role: 'assistant', content: 'Wrong product from a misheard name. '.repeat(1000) }],
    });
    const persist = jest.spyOn(conversations, 'persistTurn').mockResolvedValue();
    execute.mockResolvedValue({ ok: true, data: { product,
      pageContext: { sections: [{ title: 'Safety', content: 'Consult a qualified professional before use.' }] } } });
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      message: { role: 'assistant', content: 'LASS HEALTH: consult a qualified professional before use.' },
    })));
    const result = await service.ask('I need full description', { ...context, conversationId, modality: 'voice' });
    expect(result.success).toBe(true);
    expect(prepare).toHaveBeenCalledWith(conversationId, expect.anything());
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ conversationId }),
      'I need full description', result, expect.any(Array));
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(JSON.stringify(sent.messages)).not.toContain('Wrong product');
    expect(JSON.stringify(sent.messages)).toContain('Consult a qualified professional');
  });
  it.each(['What is the price?', 'What is its price?'])('resolves a contextual price request: %s', async question => {
    execute.mockResolvedValue({ ok: true, data: { product } });
    expect((await service.ask(question, context)).answer).toContain('1035 INR');
    expect(execute).toHaveBeenCalledWith('get_product_details', { externalProductId: productId }, expect.anything(), undefined, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('removes one unit with an idempotent relative merchant operation, not the whole line or a stale read/update', async () => {
    execute.mockResolvedValue(confirmed(1));
    const result = await service.ask('Remove one item.', context);
    expect(result.answer).toContain('Removed 1 unit');
    expect(result.answer).toContain('contains 1 unit');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('remove_cart_item', { productId, quantity: 1 }, expect.anything(), undefined, undefined);
  });

  it.each(['Open mic heart.', 'Open my card.', 'Open my heart.', 'Open my cord.', 'Open my cut.', 'Open my car.'])('asks to repeat an ambiguous voice destination without rewriting or executing it: %s', async transcript => {
    const result = await service.ask(transcript, { ...context, modality: 'voice' });
    expect(result.answer).toContain('Please repeat your request');
    expect(result.answer).not.toContain('Opened');
    expect(execute).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('only opens the cart when the subsequent actual transcript clearly requests it', async () => {
    execute.mockResolvedValue(confirmed(1));
    const result = await service.ask('Open my cart.', { ...context, modality: 'voice' });
    expect(result.answer).toContain('Opened your merchant cart');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('open_cart', {}, expect.anything(), undefined, undefined);
  });
  it.each(['and to cut this product', 'And to cart this product.', 'Add to card this product.'])('clarifies a misheard add-to-cart request without a mutation: %s', async transcript => {
    const result = await service.ask(transcript, { ...context, modality: 'voice' });
    expect(result.answer).toContain('Nothing has been changed');
    expect(result.answer).toContain('Add this product to my cart');
    expect(execute).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each(['Add this product to my cart.', 'Add to cart.', 'Add to cart this product.'])('executes a clear voice add request against the selected product: %s', async transcript => {
    execute.mockResolvedValue(confirmed(1));
    const result = await service.ask(transcript, { ...context, modality: 'voice' });
    expect(result.answer).toContain('Added 1 unit of LASS HEALTH');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('add_to_cart', { productId, quantity: 1 }, expect.anything(), undefined, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each(['Add it to my cart.', 'Add this one also.', 'Add this too.'])('resolves pronoun additions without a catalogue search: %s', async question => {
    execute.mockResolvedValue(confirmed(1));
    const result = await service.ask(question, context);
    expect(result.answer).toContain('Added 1 unit');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('add_to_cart', { productId, quantity: 1 }, expect.anything(), undefined, undefined);
  });
  it('resolves a named addition with an exact catalogue match and preserves its requested identity', async () => {
    const other = { ...product, name: 'WEIZAP', externalProductId: 'weizap' };
    execute.mockResolvedValueOnce({ ok: true, data: { products: [product, other] } })
      .mockResolvedValueOnce({ ok: true, data: { success: true, cart: {
        items: [{ productId, name: product.name, quantity: 1 }, { productId: 'weizap', name: 'WEIZAP', quantity: 1 }],
        itemCount: 2, total: 2000, currency: 'INR',
      } } });
    const result = await service.ask('Add WEIZAP also.', context);
    expect(result.answer).toContain('Added 1 unit of WEIZAP');
    expect(execute).toHaveBeenNthCalledWith(1, 'search_products', { query: 'WEIZAP' }, expect.anything(), undefined, undefined);
    expect(execute).toHaveBeenNthCalledWith(2, 'add_to_cart', { productId: 'weizap', quantity: 1 }, expect.anything(), undefined, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('does not replace an unknown named product with the first unrelated result', async () => {
    execute.mockResolvedValue({ ok: true, data: { products: [product] } });
    const result = await service.ask('Explain the ZENAGE product.', context);
    expect(result.answer).toContain('could not uniquely match "ZENAGE"');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('resolves one pending named-product clarification without losing the action intent', async () => {
    execute.mockResolvedValueOnce({ ok: true, data: { products: [] } });
    expect((await service.ask('Add UNKNOWN also.', context)).answer).toContain('Nothing has been changed');
    execute.mockResolvedValueOnce({ ok: true, data: { products: [product] } }).mockResolvedValueOnce(confirmed(1));
    const result = await service.ask('LASS HEALTH', context);
    expect(result.answer).toContain('Added 1 unit of LASS HEALTH');
    expect(execute).toHaveBeenLastCalledWith('add_to_cart', { productId, quantity: 1 }, expect.anything(), undefined, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('answers ingredients directly from the inactive recorded tab without searching or calling inference', async () => {
    execute.mockResolvedValue({ ok: true, data: { product,
      pageContext: { sections: [{ title: "What's inside", content: 'Ingredients: recorded glycine and vitamin C.' }] } } });
    const result = await service.ask('What are its ingredients?', context);
    expect(result.answer).toContain('recorded glycine and vitamin C');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('get_product_details', { externalProductId: productId }, expect.anything(), undefined, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('compares exact named products using actual prices and descriptions, without model guesses', async () => {
    const first = { ...product, name: 'ZENAGE', externalProductId: 'zenage', salePrice: 9000, description: 'Recorded skin supplement.' };
    const second = { ...product, name: 'LASS HEALTH', description: 'Recorded wellness product.' };
    execute.mockResolvedValueOnce({ ok: true, data: { products: [first] } })
      .mockResolvedValueOnce({ ok: true, data: { products: [second] } })
      .mockResolvedValueOnce({ ok: true, data: { products: [first, second] } });
    const result = await service.ask('Compare ZENAGE and LASS HEALTH.', context);
    expect(result.answer).toContain('ZENAGE: 9000 INR');
    expect(result.answer).toContain('LASS HEALTH has the lower recorded price');
    expect(result.answer).toContain('Recorded skin supplement');
    expect(execute).toHaveBeenLastCalledWith('compare_products', { externalProductIds: ['zenage', productId] }, expect.anything(), undefined, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each(['Do not add this product.', 'Checkout please.'])('does not submit an unsupported or negated transaction: %s', async question => {
    const result = await service.ask(question, context);
    expect(result.success).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

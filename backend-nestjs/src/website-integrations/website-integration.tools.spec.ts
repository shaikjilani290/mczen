import { BadRequestException } from '@nestjs/common';
import { newUuidv7 } from '../common/ids/uuid';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { WebsiteIntegrationRepository } from './website-integration.repository';
import { createWebsiteIntegrationTools } from './website-integration.tools';
import { MerchantCartService } from './merchant-cart.service';

describe('website assistant tools', () => {
  const searchPages = jest.fn(async () => [{ url: 'https://shop.example/faq', title: 'Returns' }]);
  const searchProducts = jest.fn(async () => [{
      externalProductId: 'item-1', name: 'Tea', price: 4.5, stock: 3, availability: 'in_stock',
    }]);
  const repository = { searchPages, searchProducts } as unknown as WebsiteIntegrationRepository;
  const context: AgentExecutionContext = {
    tenantId: newUuidv7(), assistantId: newUuidv7(), permissions: ['knowledge:read', 'products:read', 'inventory:read'],
    requestId: 'request-1',
  };
  const tools = Object.fromEntries(createWebsiteIntegrationTools(repository).map((tool) => [tool.name, tool]));
  const signal = new AbortController().signal;

  beforeEach(() => jest.clearAllMocks());

  it('browses only the verified tenant and assistant catalogue when no filters are given', async () => {
    await tools.search_products.handler({}, context, signal);
    expect(searchProducts).toHaveBeenCalledWith(context.tenantId, context.assistantId, {
      query: undefined, category: undefined, maxPrice: undefined, currency: undefined, integrationId: undefined, limit: 5,
    });
  });

  it('uses the verified tenant and assistant, never model-provided scope', async () => {
    await tools.search_website_content.handler({ query: 'returns' }, context, signal);
    expect(searchPages).toHaveBeenCalledWith(context.tenantId, context.assistantId, 'returns', null, 5);
  });

  it('disambiguates product searches by a validated integration ID', async () => {
    const integrationId = newUuidv7();
    await tools.search_products.handler({ query: 'tea', integrationId }, context, signal);
    expect(searchProducts).toHaveBeenCalledWith(context.tenantId, context.assistantId, {
      query: 'tea', category: undefined, maxPrice: undefined, currency: undefined, integrationId, limit: 5,
    });
    await expect(tools.search_products.handler({ query: 'tea', integrationId: 'not-a-uuid' }, context, signal))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters budget searches by currency and rejects an unqualified price ceiling', async () => {
    await tools.search_products.handler({ maxPrice: 2000, currency: 'inr' }, context, signal);
    expect(searchProducts).toHaveBeenCalledWith(context.tenantId, context.assistantId, {
      query: undefined, category: undefined, maxPrice: 2000, currency: 'INR',
      integrationId: undefined, limit: 5,
    });
    await expect(tools.search_products.handler({ maxPrice: 2000 }, context, signal))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(tools.search_products.handler({ maxPrice: -1, currency: 'INR' }, context, signal))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns exact product facts and refuses incomplete comparisons', async () => {
    await expect(tools.check_product_availability.handler({ externalProductId: 'item-1' }, context, signal))
      .resolves.toMatchObject({ stock: 3, availability: 'in_stock' });
    await expect(tools.compare_products.handler({ externalProductIds: ['item-1'] }, context, signal))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps FAQ search restricted to FAQ page records', async () => {
    await tools.search_website_faqs.handler({ query: 'returns' }, context, signal);
    expect(searchPages).toHaveBeenCalledWith(context.tenantId, context.assistantId, 'returns', 'faq', 5);
  });
  it('adds selected rendered sections to the permission-scoped detail record without replacing stored facts', async () => {
    const sections = [{ title: 'Composition', content: 'Recorded ingredients and amounts.' }];
    const productContext = jest.fn(async () => ({ sections, source: 'merchant-rendered-page' }));
    const merchant = { productContext } as unknown as MerchantCartService;
    const detail = createWebsiteIntegrationTools(repository, merchant).find(tool => tool.name === 'get_product_details')!;
    const result = await detail.handler({ externalProductId: 'item-1' }, context, signal);
    expect(result).toMatchObject({
      product: { name: 'Tea', price: 4.5 },
      pageContext: { sections },
    });
    expect(productContext).toHaveBeenCalledWith(context, 'item-1');
  });
});

import { newUuidv7 } from '../common/ids/uuid';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { WebsiteKnowledgeEngine } from './website-knowledge.engine';
import { WebsiteIntegrationRepository } from './website-integration.repository';

function context(permissions = ['products:read', 'inventory:read', 'knowledge:read']): AgentExecutionContext {
  return {
    tenantId: newUuidv7(),
    assistantId: newUuidv7(),
    channel: 'widget',
    modality: 'text',
    permissions,
    requestId: 'website-knowledge-test',
  };
}

describe('WebsiteKnowledgeEngine', () => {
  it('answers price, stock, specifications, and citations from a direct catalogue read', async () => {
    const repository = {
      searchProducts: jest.fn().mockResolvedValue([{
        externalProductId: 'tea-1',
        name: 'Green Tea',
        description: 'Loose-leaf green tea.',
        price: 250,
        salePrice: 200,
        currency: 'INR',
        stock: 7,
        availability: 'in_stock',
        productUrl: 'https://shop.example/products/green-tea',
        images: [],
        attributes: { origin: 'Darjeeling', weight: '100 g' },
      }]),
      searchPages: jest.fn().mockResolvedValue([]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer('What are the specifications, price, and stock for Green Tea?', context());

    expect(answer?.answer).toContain('Green Tea');
    expect(answer?.answer).toContain('200 INR');
    expect(answer?.answer).toContain('Recorded stock: 7');
    expect(answer?.answer).toContain('origin: Darjeeling');
    expect(answer?.sources).toEqual([{
      id: 'https://shop.example/products/green-tea',
      title: 'Green Tea',
      source: 'https://shop.example/products/green-tea',
    }]);
    expect(answer?.toolCalls).toContainEqual({ name: 'search_products', resultCount: 1 });
  });

  it('retrieves policy facts with a natural-language synonym and returns source references', async () => {
    const repository = {
      searchProducts: jest.fn().mockResolvedValue([]),
      searchPages: jest.fn().mockResolvedValue([{
        url: 'https://shop.example/returns',
        title: 'Refund and returns',
        excerpt: 'Returns are accepted within 30 days of delivery.',
      }]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer('Can I get my money back?', context());

    expect(answer?.answer).toContain('Returns are accepted within 30 days');
    expect(answer?.sources[0].source).toBe('https://shop.example/returns');
    expect(answer?.toolCalls).toContainEqual({ name: 'search_website_content', resultCount: 1 });
  });

  it('retrieves an ordering FAQ instead of treating a question as a cart mutation', async () => {
    const searchPages = jest.fn().mockResolvedValue([{
      url: 'http://127.0.0.1:5173/faq',
      title: 'Preview frequently asked questions',
      excerpt: 'Not yet. Placing an order is not supported in this preview.',
    }]);
    const engine = new WebsiteKnowledgeEngine({
      searchProducts: jest.fn().mockResolvedValue([]),
      searchPages,
    } as unknown as WebsiteIntegrationRepository);

    const answer = await engine.answer('Can I place an order in this preview?', context());

    expect(searchPages).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'Can I place an order in this preview?',
      'faq',
      5,
      undefined,
    );
    expect(answer?.answer).toContain('Placing an order is not supported');
    expect(answer?.sources[0]?.source).toBe('http://127.0.0.1:5173/faq');
  });

  it('browses the catalogue for broad product-search wording', async () => {
    const repository = {
      searchProducts: jest.fn().mockResolvedValue([{
        externalProductId: 'tea-1',
        name: 'Green Tea',
        description: 'Loose-leaf green tea.',
        productUrl: 'https://shop.example/products/green-tea',
        images: [],
        attributes: {},
      }]),
      searchPages: jest.fn().mockResolvedValue([]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer('Show me your best products', context());

    expect(answer?.products.map((product) => product.name)).toEqual(['Green Tea']);
    expect(answer?.answer).toContain('not a bestseller ranking');
    expect(answer?.toolCalls).toContainEqual({ name: 'search_products', resultCount: 1 });
  });

  it('uses the exact named product when FULLTEXT also returns similarly named products', async () => {
    const repository = {
      searchProducts: jest.fn().mockResolvedValue([
        {
          externalProductId: 'coffee',
          name: 'Aura Stress Free Coffee',
          price: 1899,
          salePrice: 1620,
          currency: 'INR',
          stock: 5,
          availability: 'in_stock',
          productUrl: 'https://shop.example/products/aura-stress-free-coffee',
          images: [],
          attributes: {},
        },
        {
          externalProductId: 'coffee-pack',
          name: 'Aura Coffee Pack of 6',
          price: 11394,
          salePrice: 9000,
          currency: 'INR',
          stock: 4,
          availability: 'in_stock',
          productUrl: 'https://shop.example/products/aura-coffee-pack',
          images: [],
          attributes: {},
        },
      ]),
      searchPages: jest.fn().mockResolvedValue([]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer('What is the current price of Aura Stress Free Coffee?', context());

    expect(answer?.products.map((product) => product.externalProductId)).toEqual(['coffee']);
    expect(answer?.answer).toContain('1620 INR');
    expect(answer?.answer).not.toContain('Aura Coffee Pack of 6');
  });

  it('handles a price question phrased as whether the customer can buy the product', async () => {
    const repository = {
      searchProducts: jest.fn().mockResolvedValue([{
        externalProductId: 'tea-1',
        name: 'Green Tea',
        price: 250,
        salePrice: 200,
        currency: 'INR',
        stock: 7,
        availability: 'in_stock',
        productUrl: 'https://shop.example/products/green-tea',
        images: [],
        attributes: {},
      }]),
      searchPages: jest.fn().mockResolvedValue([]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer(
      'How much would I pay for Green Tea, and can I buy it now?',
      {
        ...context(),
        merchant: { integrationId: newUuidv7(), sessionId: 'widget-session', origin: 'https://shop.example' },
      },
    );

    expect(answer?.answer).toContain('200 INR');
    expect(answer?.answer).toContain('Availability: in stock');
    expect(answer?.products.map((product) => product.externalProductId)).toEqual(['tea-1']);
  });

  it('filters budget searches in the live catalogue query and includes matching prices', async () => {
    const searchProducts = jest.fn().mockResolvedValue([{
      externalProductId: 'tea-1',
      name: 'Green Tea',
      price: 250,
      salePrice: 200,
      currency: 'INR',
      productUrl: 'https://shop.example/products/green-tea',
      images: [],
      attributes: {},
    }]);
    const repository = {
      searchProducts,
      searchPages: jest.fn().mockResolvedValue([]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer('Find products under ₹2,000.', context());

    expect(searchProducts).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ maxPrice: 2000, currency: 'INR', limit: 5 }),
    );
    expect(answer?.products.map((product) => product.name)).toEqual(['Green Tea']);
    expect(answer?.answer).toContain('200 INR');
  });

  it('asks which product before answering an underspecified price question', async () => {
    const engine = new WebsiteKnowledgeEngine({
      searchProducts: jest.fn().mockResolvedValue([]),
      searchPages: jest.fn().mockResolvedValue([]),
    } as unknown as WebsiteIntegrationRepository);

    const answer = await engine.answer('What are your current prices?', context());

    expect(answer?.answer).toContain('Which product should I check?');
    expect(answer?.toolCalls).toEqual([]);
  });

  it('compares only two uniquely matched products and states when price evidence is missing', async () => {
    const records = [
      { externalProductId: 'green', name: 'Green Tea', price: 200, salePrice: null, currency: 'INR', productUrl: 'https://shop.example/green' },
      { externalProductId: 'black', name: 'Black Tea', price: null, salePrice: null, currency: null, productUrl: 'https://shop.example/black' },
    ];
    const repository = {
      searchProducts: jest.fn(async (_tenant: string, _assistant: string, input: { query?: string }) =>
        records.filter((product) => product.name === input.query)),
      searchPages: jest.fn().mockResolvedValue([]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer('Compare Green Tea and Black Tea', context());

    expect(answer?.products.map((product) => product.externalProductId)).toEqual(['green', 'black']);
    expect(answer?.answer).toContain('Prices cannot be compared because both amounts in the same currency are not available.');
    expect(answer?.answer).toContain('price not supplied');
  });

  it('does not use the LLM for routine website requests, even when the optional fallback is enabled', async () => {
    const repository = {
      searchProducts: jest.fn().mockResolvedValue([]),
      searchPages: jest.fn().mockResolvedValue([]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer('What is the delivery policy?', context(), true);

    expect(answer?.answer).toContain('could not verify');
  });

  it('does not cite a loosely matching policy page for an unsupported detail', async () => {
    const repository = {
      searchProducts: jest.fn().mockResolvedValue([]),
      searchPages: jest.fn().mockResolvedValue([{
        url: 'https://shop.example/shipping',
        title: 'Shipping policy',
        excerpt: 'Shipping information is not available in this preview.',
      }]),
    } as unknown as WebsiteIntegrationRepository;
    const engine = new WebsiteKnowledgeEngine(repository);

    const answer = await engine.answer(
      'What exact delivery date can you guarantee to a remote research station on Mars?',
      context(),
    );

    expect(answer?.answer).toContain('could not verify');
    expect(answer?.sources).toEqual([]);
  });
});

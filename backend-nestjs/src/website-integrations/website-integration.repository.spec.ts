import type { DataSource } from 'typeorm';
import { newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { WebsiteIntegrationRepository } from './website-integration.repository';

describe('WebsiteIntegrationRepository', () => {
  it('resolves a rendered product URL with tenant, assistant and integration scoping', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new WebsiteIntegrationRepository({ query } as unknown as DataSource);
    const tenant = newUuidv7(), assistant = newUuidv7(), integration = newUuidv7();
    const productUrl = 'https://shop.example/products/tea';
    await repository.searchProducts(tenant, assistant, { productUrl, integrationId: integration, limit: 1 });
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain('p.`product_url`=?');
    expect(sql).toContain('i.`id`=?');
    expect(sql).not.toContain(productUrl);
    expect(parameters).toEqual([uuidToBinary(tenant), uuidToBinary(assistant), productUrl, uuidToBinary(integration), 1]);
  });
  it('preserves page body lines when choosing the most relevant knowledge chunk', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new WebsiteIntegrationRepository({ query } as unknown as DataSource);
    await repository.searchPages(newUuidv7(), newUuidv7(), 'return policy', null, 5);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("GROUP_CONCAT(REPLACE(SUBSTRING(k.`content`,1,1600),CHAR(10),' ')");
  });
  it('scopes website page retrieval to a verified integration when one is present', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new WebsiteIntegrationRepository({ query } as unknown as DataSource);
    const tenantId = newUuidv7();
    const assistantId = newUuidv7();
    const integrationId = newUuidv7();
    await repository.searchPages(tenantId, assistantId, 'return policy', 'policy', 5, integrationId);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain('i.`id`=?');
    expect(parameters).toEqual([
      'return policy', uuidToBinary(tenantId), uuidToBinary(assistantId), uuidToBinary(integrationId),
      'return policy', 'policy', 'return policy', 5,
    ]);
  });
  it('ranks explicitly named products and full-text relevance before recency without interpolating user text', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new WebsiteIntegrationRepository({ query } as unknown as DataSource);
    const tenantId = newUuidv7();
    const assistantId = newUuidv7();
    const question = 'Give me details of AURA COFFEE PACK OF 6.';
    await repository.searchProducts(tenantId, assistantId, { query: question, limit: 5 });
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain('ORDER BY  (LOCATE(LOWER(p.`name`),LOWER(?))>0) DESC, MATCH');
    expect(sql).not.toContain(question);
    expect(parameters).toEqual([uuidToBinary(tenantId), uuidToBinary(assistantId),
      question, question, question, question, 5]);
  });
  it('applies tenant, assistant, currency, and effective-price filters with bound parameters', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new WebsiteIntegrationRepository({ query } as unknown as DataSource);
    const tenantId = newUuidv7();
    const assistantId = newUuidv7();

    await repository.searchProducts(tenantId, assistantId, {
      maxPrice: 2000,
      currency: 'INR',
      limit: 5,
    });

    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain('p.`tenant_id`=?');
    expect(sql).toContain('i.`assistant_id`=?');
    expect(sql).toContain('p.`currency`=?');
    expect(sql).toContain('COALESCE(p.`sale_price`,p.`price`)<=?');
    expect(parameters).toEqual([uuidToBinary(tenantId), uuidToBinary(assistantId), 'INR', 2000, 5]);
  });
});

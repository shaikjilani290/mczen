import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { tenantContextStore } from '../common/tenant/tenant-context.store';
import { KnowledgeRepository } from '../knowledge/knowledge.repository';
import { MemorySharedState } from '../shared-state/memory-shared-state';
import { WebsiteCrawler } from './website-crawler';
import { WebsiteIntegrationRepository, type WebsiteIntegrationRecord } from './website-integration.repository';
import { WebsiteIntegrationService } from './website-integration.service';

describe('authenticated local website ingestion', () => {
  const nodeEnv = process.env.NODE_ENV;
  const localFlag = process.env.MCZEN_ALLOW_LOCAL_INGESTION;
  const keyA = `mzi_${'A'.repeat(43)}`;
  const keyB = `mzi_${'B'.repeat(43)}`;
  const origin = 'http://localhost:5173';
  const recordA: WebsiteIntegrationRecord = {
    id: newUuidv7(), tenantId: newUuidv7(), assistantId: newUuidv7(), origin,
    name: 'Local merchant A', publicKey: `mzp_${'A'.repeat(43)}`,
    ingestionKeyHash: 'not-used-by-service-test', createdBy: null, status: 'active',
  };
  const recordB = { ...recordA, id: newUuidv7(), tenantId: newUuidv7(), assistantId: newUuidv7() };
  const page = { url: `${origin}/products?category=Tea`, title: 'Tea', mainContent: 'Our recorded tea category.' };
  const product = { externalProductId: 'tea-1', name: 'Tea', price: 1800, currency: 'INR', productUrl: `${origin}/product/tea-1` };
  let repository: WebsiteIntegrationRepository;
  let knowledge: KnowledgeRepository;
  let service: WebsiteIntegrationService;
  let lookup: jest.SpiedFunction<WebsiteIntegrationRepository['byIngestionKey']>;
  let upsertProduct: jest.SpiedFunction<WebsiteIntegrationRepository['upsertProduct']>;
  let refreshCounts: jest.SpiedFunction<WebsiteIntegrationRepository['refreshCounts']>;
  let insertArticle: jest.SpiedFunction<KnowledgeRepository['insertArticle']>;
  let replaceChunks: jest.SpiedFunction<KnowledgeRepository['replaceChunks']>;
  let crawl: jest.SpiedFunction<WebsiteCrawler['crawl']>;
  const pages = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.MCZEN_ALLOW_LOCAL_INGESTION = '1';
    pages.clear();
    repository = new WebsiteIntegrationRepository();
    knowledge = new KnowledgeRepository();
    const database = new DataSource({ type: 'mysql' });
    service = new WebsiteIntegrationService(repository, knowledge, database, new MemorySharedState());
    lookup = jest.spyOn(repository, 'byIngestionKey').mockImplementation(async (key) =>
      key === keyA ? recordA : key === keyB ? recordB : undefined);
    refreshCounts = jest.spyOn(repository, 'refreshCounts').mockResolvedValue();
    upsertProduct = jest.spyOn(repository, 'upsertProduct').mockImplementation(async (tenantId) => {
      expect(tenantContextStore.getOrThrow().tenantId).toBe(tenantId);
    });
    jest.spyOn(repository, 'findPage').mockImplementation(async (tenant, integration, hash) =>
      pages.get(`${tenant}:${integration}:${hash}`));
    jest.spyOn(repository, 'upsertPage').mockImplementation(async (input) => {
      expect(knowledge.tenantIdString()).toBe(input.tenantId);
      pages.set(`${input.tenantId}:${input.integrationId}:${input.urlHash}`, {
        id: input.pageId, article_id: input.articleId, content_hash: input.contentHash, status: input.page.status,
      });
    });
    jest.spyOn(knowledge, 'ensureDefaultCategories').mockResolvedValue();
    jest.spyOn(knowledge, 'listCategories').mockResolvedValue([
      { id: uuidToBinary(newUuidv7()), slug: 'health-education' },
    ]);
    jest.spyOn(knowledge, 'transaction').mockImplementation((work) => work(database.manager));
    insertArticle = jest.spyOn(knowledge, 'insertArticle').mockResolvedValue();
    jest.spyOn(knowledge, 'updateArticle').mockResolvedValue();
    replaceChunks = jest.spyOn(knowledge, 'replaceChunks').mockResolvedValue();
    crawl = jest.spyOn(WebsiteCrawler.prototype, 'crawl').mockRejectedValue(new Error('Crawler must not run for JSON ingestion.'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    if (localFlag === undefined) delete process.env.MCZEN_ALLOW_LOCAL_INGESTION;
    else process.env.MCZEN_ALLOW_LOCAL_INGESTION = localFlag;
  });

  it('imports local JSON through existing methods, indexes once, and updates changed content', async () => {
    await expect(service.ingestBatch(keyA, { pages: [page], products: [product] }))
      .resolves.toEqual({ accepted: { pages: 1, products: 1 }, indexed: 1 });
    await expect(service.ingestPages(keyA, [page])).resolves.toEqual({ accepted: 1, indexed: 0 });
    expect(insertArticle).toHaveBeenCalledTimes(1);
    expect(replaceChunks).toHaveBeenCalledTimes(1);
    await expect(service.ingestPages(keyA, [{ ...page, mainContent: 'Changed recorded content.' }]))
      .resolves.toEqual({ accepted: 1, indexed: 1 });
    expect(pages.size).toBe(1);
    expect(replaceChunks).toHaveBeenCalledTimes(2);
    expect(upsertProduct).toHaveBeenCalledWith(
      recordA.tenantId, recordA.id, expect.objectContaining({ externalProductId: 'tea-1' }), expect.any(String),
    );
    expect(refreshCounts).toHaveBeenCalledWith(recordA.tenantId, recordA.id);
    expect(crawl).not.toHaveBeenCalled();
  });

  it('rejects missing, invalid, public, revoked and unknown credentials before writing', async () => {
    for (const key of [undefined, 'invalid', recordA.publicKey, `mzi_${'Z'.repeat(43)}`]) {
      await expect(service.ingestProducts(key, [product])).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.ingestPages(key, [page])).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.ingestBatch(key, { pages: [page] })).rejects.toBeInstanceOf(UnauthorizedException);
    }
    // Revocation/disabled tenant/assistant are rejected by the key repository lookup.
    lookup.mockResolvedValue(undefined);
    await expect(service.ingestBatch(keyA, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(upsertProduct).not.toHaveBeenCalled();
    expect(insertArticle).not.toHaveBeenCalled();
  });

  it('scopes identical local origins to the authenticated integration, never ambient/body tenant ids', async () => {
    await tenantContextStore.run({
      tenantId: recordB.tenantId, actorType: 'user', permissions: [],
    }, () => service.ingestBatch(keyA, { pages: [page], products: [product] }));
    await service.ingestBatch(keyB, { pages: [page], products: [product] });
    expect(pages.size).toBe(2);
    expect(refreshCounts).toHaveBeenNthCalledWith(1, recordA.tenantId, recordA.id);
    expect(refreshCounts).toHaveBeenNthCalledWith(2, recordB.tenantId, recordB.id);
    await expect(service.ingestProducts(keyA, [{ ...product, tenantId: recordB.tenantId }]))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.ingestPages(keyA, [{ ...page, url: 'http://localhost:5174/private' }]))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(upsertProduct).toHaveBeenCalledTimes(2);
  });

  it.each(['production', 'test', ''])('rejects local ingestion outside explicit development (%s)', async (mode) => {
    process.env.NODE_ENV = mode;
    await expect(service.ingestProducts(keyA, [product])).rejects.toThrow('NODE_ENV=development');
    await expect(service.ingestPages(keyA, [page])).rejects.toThrow('NODE_ENV=development');
    await expect(service.ingestBatch(keyA, { products: [product] })).rejects.toThrow('NODE_ENV=development');
    expect(upsertProduct).not.toHaveBeenCalled();
  });

  it('preserves ordinary authenticated public-site ingestion in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MCZEN_ALLOW_LOCAL_INGESTION;
    lookup.mockResolvedValue({ ...recordA, origin: 'https://merchant.example' });
    await expect(service.ingestProducts(keyA, [{
      ...product, productUrl: 'https://merchant.example/product/tea-1',
    }])).resolves.toEqual({ accepted: 1 });
    expect(upsertProduct).toHaveBeenCalledTimes(1);
    expect(crawl).not.toHaveBeenCalled();
  });

  it('requires the opt-in flag and rejects crawler sync for local integrations before changing sync state', async () => {
    delete process.env.MCZEN_ALLOW_LOCAL_INGESTION;
    await expect(service.ingestProducts(keyA, [product])).rejects.toThrow('MCZEN_ALLOW_LOCAL_INGESTION');
    process.env.MCZEN_ALLOW_LOCAL_INGESTION = '1';
    jest.spyOn(repository, 'record').mockResolvedValue(recordA);
    const begin = jest.spyOn(repository, 'beginSync');
    await tenantContextStore.run({
      tenantId: recordA.tenantId, actorType: 'user', permissions: ['tenants:write'],
    }, async () => {
      await expect(service.beginSync(recordA.id)).rejects.toThrow('Local websites cannot be crawled');
    });
    expect(begin).not.toHaveBeenCalled();
    expect(crawl).not.toHaveBeenCalled();
  });
});

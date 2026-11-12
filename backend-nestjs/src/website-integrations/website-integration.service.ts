import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { binaryToUuid, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { tenantContextStore, type TenantContext } from '../common/tenant/tenant-context.store';
import { KnowledgeRepository } from '../knowledge/knowledge.repository';
import { chunkText, sanitizeText } from '../knowledge/text-utils';
import { SHARED_STATE, type SharedState } from '../shared-state/shared-state';
import { SharedRateLimiter } from '../shared-state/rate-limiter';
import { ToolConfigurationRepository } from '../tools/tool-configuration.repository';
import {
  assertWebsiteIngestionOrigin,
  isLocalWebsiteOrigin,
  parseWebsiteBatch,
  parseWebsitePage,
  parseWebsiteProduct,
  type WebsitePageInput,
  type WebsiteProductInput,
} from './website-integration.dto';
import { WebsiteCrawler } from './website-crawler';
import { WebsiteIntegrationRepository, type WebsiteIntegrationRecord } from './website-integration.repository';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const INTEGRATION_PERMISSIONS = Object.freeze(['knowledge:read', 'products:read', 'inventory:read', 'knowledge:write']);
const WEBSITE_TOOL_NAMES = [
  'search_website_content', 'search_products', 'get_product_details',
  'check_product_availability', 'compare_products', 'search_website_faqs',
] as const;

@Injectable()
export class WebsiteIntegrationService {
  private readonly logger = new Logger(WebsiteIntegrationService.name);
  private readonly limiter: SharedRateLimiter;
  private readonly crawler = new WebsiteCrawler();

  constructor(
    private readonly integrations: WebsiteIntegrationRepository,
    private readonly knowledge: KnowledgeRepository,
    @InjectDataSource() private readonly database: DataSource,
    @Optional() @Inject(SHARED_STATE) sharedState?: SharedState,
    @Optional() private readonly toolConfiguration?: ToolConfigurationRepository,
  ) {
    if (!sharedState) throw new ServiceUnavailableException('Website integrations are unavailable.');
    this.limiter = new SharedRateLimiter(sharedState);
  }

  private tenant(): TenantContext {
    return tenantContextStore.getOrThrow();
  }

  async create(input: { name: string; origin: string; assistantId: string }, userId: string) {
    assertWebsiteIngestionOrigin(input.origin);
    const tenantId = this.tenant().tenantId;
    if (!(await this.integrations.assistantExists(tenantId, input.assistantId))) {
      throw new BadRequestException('assistantId is invalid.');
    }
    const publicKey = `mzp_${randomBytes(32).toString('base64url')}`;
    const ingestionKey = `mzi_${randomBytes(32).toString('base64url')}`;
    try {
      await this.database.transaction(async (manager) => {
        await this.integrations.create(tenantId, input, publicKey, digest(ingestionKey), userId, manager);
        if (this.toolConfiguration?.configured) {
          await this.toolConfiguration.enableWebsiteTools(manager, input.assistantId, userId, WEBSITE_TOOL_NAMES);
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictException('A website integration already exists for this domain.');
      }
      throw error;
    }
    const items = await this.integrations.list(tenantId);
    const created = items.find((item) => item.domain === input.origin);
    if (!created) throw new ServiceUnavailableException('The website integration could not be loaded.');
    return { integration: created, ingestionKey };
  }

  list() {
    return this.integrations.list(this.tenant().tenantId);
  }

  async status(integrationId: string) {
    return this.integrations.get(this.tenant().tenantId, integrationId);
  }

  async rotateKeys(integrationId: string) {
    const tenantId = this.tenant().tenantId;
    await this.integrations.record(tenantId, integrationId);
    const publicKey = `mzp_${randomBytes(32).toString('base64url')}`;
    const ingestionKey = `mzi_${randomBytes(32).toString('base64url')}`;
    await this.integrations.rotateKeys(tenantId, integrationId, publicKey, digest(ingestionKey));
    return { publicKey, ingestionKey };
  }

  async revoke(integrationId: string) {
    const tenantId = this.tenant().tenantId;
    await this.integrations.record(tenantId, integrationId);
    await this.integrations.revoke(tenantId, integrationId);
    return { id: integrationId, status: 'revoked' as const };
  }

  async beginSync(integrationId: string) {
    const tenantId = this.tenant().tenantId;
    const record = await this.integrations.record(tenantId, integrationId, true);
    if (isLocalWebsiteOrigin(record.origin)) {
      throw new BadRequestException(
        'Local websites cannot be crawled. Run the merchant server-side local ingestion command instead.',
      );
    }
    if (!(await this.integrations.beginSync(tenantId, integrationId))) {
      throw new ConflictException('A synchronization is already running or the integration is revoked.');
    }
    void this.runSync(record).catch((error: unknown) => {
      this.logger.error('Website synchronization failed.', error instanceof Error ? error.stack : undefined);
      return this.integrations.finishSync(tenantId, integrationId, {
        status: 'failed', pages: 0, products: 0, indexed: 0, errors: ['Synchronization failed unexpectedly.'],
      });
    });
    return { id: integrationId, syncStatus: 'running' as const };
  }

  private async runSync(record: WebsiteIntegrationRecord): Promise<void> {
    let pages = 0;
    let indexed = 0;
    const errors: string[] = [];
    try {
      const result = await this.crawler.crawl(record.origin, (count) =>
        this.integrations.setSyncDiscovery(record.tenantId, record.id, count));
      for (const page of result.pages) {
        try {
          const saved = await this.withIntegrationContext(record, () =>
            this.savePage(record, { ...page, language: 'en', status: 'active' }),
          );
          pages += 1;
          if (saved.indexed) indexed += 1;
        } catch {
          errors.push(`${new URL(page.url).pathname}: page could not be indexed`);
          if (errors.length >= 50) break;
        }
      }
      errors.push(...result.errors.slice(0, Math.max(0, 50 - errors.length)));
      await this.deactivateMissingPages(record);
      await this.integrations.refreshCounts(record.tenantId, record.id);
      await this.integrations.finishSync(record.tenantId, record.id, {
        status: errors.length > 0 && pages === 0 ? 'failed' : 'completed',
        pages, products: 0, indexed, errors,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : 'Crawler failed.';
      await this.integrations.finishSync(record.tenantId, record.id, {
        status: 'failed', pages, products: 0, indexed, errors: [message],
      });
    }
  }

  private async deactivateMissingPages(record: WebsiteIntegrationRecord): Promise<void> {
    await this.database.transaction(async (manager) => {
      await manager.query(
        `UPDATE \`website_pages\` SET \`status\`='inactive'
         WHERE \`tenant_id\`=? AND \`integration_id\`=? AND \`status\`='active'
           AND \`last_seen_at\` < (SELECT \`sync_started_at\` FROM \`website_integrations\`
             WHERE \`tenant_id\`=? AND \`id\`=?)
         `,
        [uuidToBinary(record.tenantId), uuidToBinary(record.id), uuidToBinary(record.tenantId), uuidToBinary(record.id)],
      );
      await manager.query(
        `UPDATE \`knowledge_articles\` a
         JOIN \`website_pages\` p ON p.\`article_id\`=a.\`id\` AND p.\`tenant_id\`=a.\`tenant_id\`
         SET a.\`status\`='archived'
         WHERE p.\`tenant_id\`=? AND p.\`integration_id\`=? AND p.\`status\`='inactive' AND a.\`status\`='published'`,
        [uuidToBinary(record.tenantId), uuidToBinary(record.id)],
      );
    });
  }

  async pages(integrationId: string, page: number, pageSize: number) {
    const tenantId = this.tenant().tenantId;
    await this.integrations.record(tenantId, integrationId);
    return this.integrations.pages(tenantId, integrationId, page, pageSize);
  }

  async products(integrationId: string, page: number, pageSize: number) {
    const tenantId = this.tenant().tenantId;
    await this.integrations.record(tenantId, integrationId);
    return this.integrations.products(tenantId, integrationId, page, pageSize);
  }

  async knowledgeList(integrationId: string, page: number, pageSize: number) {
    const tenantId = this.tenant().tenantId;
    await this.integrations.record(tenantId, integrationId);
    return this.integrations.listKnowledge(tenantId, integrationId, page, pageSize);
  }

  async rebuildIndex(integrationId: string) {
    const tenantId = this.tenant().tenantId;
    await this.integrations.record(tenantId, integrationId);
    const pages = await this.integrations.pagesForReindex(tenantId, integrationId);
    let indexed = 0;
    for (const page of pages) {
      if (!Buffer.isBuffer(page.article_id) && !(page.article_id instanceof Uint8Array)) {
        throw new ServiceUnavailableException('A website knowledge record has an invalid article reference.');
      }
      const articleId = Buffer.from(page.article_id as Uint8Array);
      const content = [page.title, page.summary, page.content].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ).join('\n\n');
      const language = typeof page.language_code === 'string' ? page.language_code : 'en';
      await this.knowledge.transaction((manager) => this.knowledge.replaceChunks(
        manager,
        { articleId },
        chunkText(content),
        language,
      ));
      indexed += 1;
    }
    await this.integrations.refreshCounts(tenantId, integrationId);
    return { id: integrationId, status: 'completed' as const, indexed };
  }

  private async authenticateIngestion(key: string | undefined): Promise<WebsiteIntegrationRecord> {
    if (!key || !/^mzi_[A-Za-z0-9_-]{43}$/.test(key)) throw new UnauthorizedException('Integration credentials are invalid.');
    await this.limiter.hit(`website-ingest:key:${digest(key)}`, 300);
    const record = await this.integrations.byIngestionKey(key);
    if (!record) throw new UnauthorizedException('Integration credentials are invalid.');
    assertWebsiteIngestionOrigin(record.origin);
    return record;
  }

  async ingestPages(key: string | undefined, body: unknown) {
    const record = await this.authenticateIngestion(key);
    if (!Array.isArray(body) || body.length > 50) throw new BadRequestException('Page batch is invalid.');
    const pages = body.map((page) => parseWebsitePage(page, record.origin));
    return this.withIntegrationContext(record, async () => {
      let indexed = 0;
      for (const page of pages) {
        const result = await this.savePage(record, page);
        if (result.indexed) indexed += 1;
      }
      await this.integrations.refreshCounts(record.tenantId, record.id);
      return { accepted: pages.length, indexed };
    });
  }

  async ingestProducts(key: string | undefined, body: unknown) {
    const record = await this.authenticateIngestion(key);
    if (!Array.isArray(body) || body.length > 100) throw new BadRequestException('Product batch is invalid.');
    const products = body.map((product) => parseWebsiteProduct(product, record.origin));
    return this.withIntegrationContext(record, async () => {
      for (const product of products) await this.saveProduct(record, product);
      await this.integrations.refreshCounts(record.tenantId, record.id);
      return { accepted: products.length };
    });
  }

  async ingestBatch(key: string | undefined, body: unknown) {
    const record = await this.authenticateIngestion(key);
    const { pages, products } = parseWebsiteBatch(body, record.origin);
    return this.withIntegrationContext(record, async () => {
      let indexed = 0;
      for (const page of pages) {
        const result = await this.savePage(record, page);
        if (result.indexed) indexed += 1;
      }
      for (const product of products) await this.saveProduct(record, product);
      await this.integrations.refreshCounts(record.tenantId, record.id);
      return { accepted: { pages: pages.length, products: products.length }, indexed };
    });
  }

  private async withIntegrationContext<T>(record: WebsiteIntegrationRecord, work: () => Promise<T>): Promise<T> {
    const context: TenantContext = {
      tenantId: record.tenantId, actorType: 'api_key', assistantId: record.assistantId,
      permissions: INTEGRATION_PERMISSIONS, requestId: randomUUID(),
    };
    return tenantContextStore.run(context, work);
  }

  private async savePage(record: WebsiteIntegrationRecord, page: WebsitePageInput): Promise<{ indexed: boolean }> {
    const urlHash = digest(page.url);
    const cleaned: WebsitePageInput = {
      ...page,
      title: sanitizeText(page.title),
      metaDescription: page.metaDescription ? sanitizeText(page.metaDescription) : null,
      mainContent: sanitizeText(page.mainContent),
      headings: page.headings.map(sanitizeText),
      links: page.links.map((link) => ({ url: link.url, text: sanitizeText(link.text) })),
    };
    const content = [cleaned.headings.join('\n'), cleaned.mainContent].filter(Boolean).join('\n\n');
    const contentHash = digest(JSON.stringify([
      cleaned.title, cleaned.metaDescription, content, cleaned.pageType, cleaned.language,
    ]));
    await this.knowledge.ensureDefaultCategories();
    const categories = await this.knowledge.listCategories();
    const category = categories.find((item) => item.slug === 'health-education');
    if (!category?.id) throw new ServiceUnavailableException('The knowledge base is unavailable.');
    const categoryId = Buffer.isBuffer(category.id) ? category.id : uuidToBinary(binaryToUuid(category.id as Uint8Array));
    const existing = await this.integrations.findPage(record.tenantId, record.id, urlHash);
    const articleId = existing?.article_id
      ? Buffer.from(existing.article_id as Uint8Array)
      : uuidToBinary(newUuidv7());
    const indexed = !existing || String(existing.content_hash) !== contentHash ||
      (existing.status === 'inactive' && cleaned.status === 'active');
    await this.knowledge.transaction(async (manager) => {
      if (existing) {
        await this.knowledge.updateArticle(manager, articleId, {
          categoryId,
          title: cleaned.title,
          summary: cleaned.metaDescription,
          content,
          language: cleaned.language,
          status: cleaned.status === 'active' ? 'published' : 'archived',
          sourceName: record.name,
          sourceUrl: cleaned.url,
          referenceNote: `Website page from ${record.origin}`,
          updatedBy: record.createdBy ? uuidToBinary(record.createdBy) : null,
        }, cleaned.status === 'active');
      } else {
        await this.knowledge.insertArticle(manager, {
          id: articleId, categoryId, title: cleaned.title, summary: cleaned.metaDescription, content,
          language: cleaned.language, status: cleaned.status === 'active' ? 'published' : 'archived',
          sourceName: record.name, sourceUrl: cleaned.url, referenceNote: `Website page from ${record.origin}`,
          userId: record.createdBy ? uuidToBinary(record.createdBy) : null,
        });
      }
      if (indexed && cleaned.status === 'active') {
        await this.knowledge.replaceChunks(manager, { articleId }, chunkText(`${cleaned.title}\n${cleaned.metaDescription ?? ''}\n${content}`), cleaned.language);
      } else if (cleaned.status === 'inactive') {
        await this.knowledge.replaceChunks(manager, { articleId }, [], cleaned.language);
      }
      await this.integrations.upsertPage({
        tenantId: record.tenantId, integrationId: record.id, pageId: existing?.id
          ? Buffer.from(existing.id as Uint8Array) : uuidToBinary(newUuidv7()),
        articleId, url: cleaned.url, urlHash, contentHash, page: cleaned,
      }, manager);
    });
    return { indexed };
  }

  private async saveProduct(record: WebsiteIntegrationRecord, product: WebsiteProductInput): Promise<void> {
    const canonical = JSON.stringify(product);
    await this.integrations.upsertProduct(record.tenantId, record.id, product, digest(canonical));
  }

  async toolSearchPages(context: { tenantId: string; assistantId?: string }, query: string, type: string | null, limit: number) {
    if (!context.assistantId) return [];
    return this.integrations.searchPages(context.tenantId, context.assistantId, query, type, limit);
  }

  async toolSearchProducts(context: { tenantId: string; assistantId?: string }, input: {
    query?: string; category?: string; limit: number; ids?: string[];
  }) {
    if (!context.assistantId) return [];
    return this.integrations.searchProducts(context.tenantId, context.assistantId, input);
  }
}

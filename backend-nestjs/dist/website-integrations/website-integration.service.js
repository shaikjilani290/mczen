"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var WebsiteIntegrationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteIntegrationService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const node_crypto_1 = require("node:crypto");
const uuid_1 = require("../common/ids/uuid");
const tenant_context_store_1 = require("../common/tenant/tenant-context.store");
const knowledge_repository_1 = require("../knowledge/knowledge.repository");
const text_utils_1 = require("../knowledge/text-utils");
const shared_state_1 = require("../shared-state/shared-state");
const rate_limiter_1 = require("../shared-state/rate-limiter");
const tool_configuration_repository_1 = require("../tools/tool-configuration.repository");
const website_integration_dto_1 = require("./website-integration.dto");
const website_crawler_1 = require("./website-crawler");
const website_integration_repository_1 = require("./website-integration.repository");
const digest = (value) => (0, node_crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex');
const INTEGRATION_PERMISSIONS = Object.freeze(['knowledge:read', 'products:read', 'inventory:read', 'knowledge:write']);
const WEBSITE_TOOL_NAMES = [
    'search_website_content', 'search_products', 'get_product_details',
    'check_product_availability', 'compare_products', 'search_website_faqs',
];
let WebsiteIntegrationService = WebsiteIntegrationService_1 = class WebsiteIntegrationService {
    integrations;
    knowledge;
    database;
    toolConfiguration;
    logger = new common_1.Logger(WebsiteIntegrationService_1.name);
    limiter;
    crawler = new website_crawler_1.WebsiteCrawler();
    constructor(integrations, knowledge, database, sharedState, toolConfiguration) {
        this.integrations = integrations;
        this.knowledge = knowledge;
        this.database = database;
        this.toolConfiguration = toolConfiguration;
        if (!sharedState)
            throw new common_1.ServiceUnavailableException('Website integrations are unavailable.');
        this.limiter = new rate_limiter_1.SharedRateLimiter(sharedState);
    }
    tenant() {
        return tenant_context_store_1.tenantContextStore.getOrThrow();
    }
    async create(input, userId) {
        (0, website_integration_dto_1.assertWebsiteIngestionOrigin)(input.origin);
        const tenantId = this.tenant().tenantId;
        if (!(await this.integrations.assistantExists(tenantId, input.assistantId))) {
            throw new common_1.BadRequestException('assistantId is invalid.');
        }
        const publicKey = `mzp_${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
        const ingestionKey = `mzi_${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
        try {
            await this.database.transaction(async (manager) => {
                await this.integrations.create(tenantId, input, publicKey, digest(ingestionKey), userId, manager);
                if (this.toolConfiguration?.configured) {
                    await this.toolConfiguration.enableWebsiteTools(manager, input.assistantId, userId, WEBSITE_TOOL_NAMES);
                }
            });
        }
        catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new common_1.ConflictException('A website integration already exists for this domain.');
            }
            throw error;
        }
        const items = await this.integrations.list(tenantId);
        const created = items.find((item) => item.domain === input.origin);
        if (!created)
            throw new common_1.ServiceUnavailableException('The website integration could not be loaded.');
        return { integration: created, ingestionKey };
    }
    list() {
        return this.integrations.list(this.tenant().tenantId);
    }
    async status(integrationId) {
        return this.integrations.get(this.tenant().tenantId, integrationId);
    }
    async rotateKeys(integrationId) {
        const tenantId = this.tenant().tenantId;
        await this.integrations.record(tenantId, integrationId);
        const publicKey = `mzp_${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
        const ingestionKey = `mzi_${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
        await this.integrations.rotateKeys(tenantId, integrationId, publicKey, digest(ingestionKey));
        return { publicKey, ingestionKey };
    }
    async revoke(integrationId) {
        const tenantId = this.tenant().tenantId;
        await this.integrations.record(tenantId, integrationId);
        await this.integrations.revoke(tenantId, integrationId);
        return { id: integrationId, status: 'revoked' };
    }
    async beginSync(integrationId) {
        const tenantId = this.tenant().tenantId;
        const record = await this.integrations.record(tenantId, integrationId, true);
        if ((0, website_integration_dto_1.isLocalWebsiteOrigin)(record.origin)) {
            throw new common_1.BadRequestException('Local websites cannot be crawled. Run the merchant server-side local ingestion command instead.');
        }
        if (!(await this.integrations.beginSync(tenantId, integrationId))) {
            throw new common_1.ConflictException('A synchronization is already running or the integration is revoked.');
        }
        void this.runSync(record).catch((error) => {
            this.logger.error('Website synchronization failed.', error instanceof Error ? error.stack : undefined);
            return this.integrations.finishSync(tenantId, integrationId, {
                status: 'failed', pages: 0, products: 0, indexed: 0, errors: ['Synchronization failed unexpectedly.'],
            });
        });
        return { id: integrationId, syncStatus: 'running' };
    }
    async runSync(record) {
        let pages = 0;
        let products = 0;
        let indexed = 0;
        const errors = [];
        try {
            const result = await this.crawler.crawl(record.origin, (count) => this.integrations.setSyncDiscovery(record.tenantId, record.id, count));
            for (const page of result.pages) {
                try {
                    const saved = await this.withIntegrationContext(record, () => this.savePage(record, {
                        ...page,
                        language: 'en',
                        status: 'active',
                    }));
                    pages += 1;
                    if (saved.indexed)
                        indexed += 1;
                }
                catch {
                    errors.push(`${new URL(page.url).pathname}: page could not be indexed`);
                }
            }
            errors.push(...result.errors.slice(0, Math.max(0, 50 - errors.length)));
            try {
                const imported = await this.importStorefrontProducts(record);
                products = imported.accepted;
                errors.push(...imported.errors.slice(0, Math.max(0, 50 - errors.length)));
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message.slice(0, 200)
                    : 'Storefront product import failed.';
                errors.push(`Product import: ${message}`);
            }
            await this.deactivateMissingPages(record);
            await this.integrations.refreshCounts(record.tenantId, record.id);
            await this.integrations.finishSync(record.tenantId, record.id, {
                status: errors.length > 0 && pages === 0 && products === 0
                    ? 'failed'
                    : 'completed',
                pages,
                products,
                indexed,
                errors: errors.slice(0, 50),
            });
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message.slice(0, 200)
                : 'Crawler failed.';
            await this.integrations.finishSync(record.tenantId, record.id, {
                status: 'failed',
                pages,
                products,
                indexed,
                errors: [message],
            });
        }
    }
    async importStorefrontProducts(record) {
        const catalog = await this.crawler.fetchStorefrontCatalog(record.origin);
        if (!catalog) {
            return { accepted: 0, errors: [] };
        }
        const data = catalog;
        const sourceProducts = data.products;
        const details = data.details;
        const assets = data.assets;
        const getText = (value) => {
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
            if (typeof value === 'number' || typeof value === 'boolean') {
                return String(value);
            }
            return null;
        };
        const getNumber = (value) => {
            const number = typeof value === 'number'
                ? value
                : typeof value === 'string'
                    ? Number(value)
                    : NaN;
            return Number.isFinite(number) ? number : null;
        };
        const findDetail = (key) => {
            const direct = details[key];
            if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
                return direct;
            }
            const matchedKey = Object.keys(details).find((item) => item.toLowerCase() === key.toLowerCase());
            const matched = matchedKey ? details[matchedKey] : undefined;
            return matched && typeof matched === 'object' && !Array.isArray(matched)
                ? matched
                : {};
        };
        const getImages = (product, detail) => {
            const imageEntries = Array.isArray(detail.Images)
                ? detail.Images
                : [];
            const imageKeys = imageEntries
                .filter((image) => image.IsPrimary === true || image.SortOrder === 1)
                .concat(imageEntries)
                .map((image) => getText(image.ImageKey))
                .filter((key) => Boolean(key));
            const fallbackKey = getText(detail.ImageKey) ?? getText(product.ImageKey);
            if (fallbackKey)
                imageKeys.push(fallbackKey);
            const uniqueKeys = [...new Set(imageKeys)];
            const imageUrls = [];
            for (const imageKey of uniqueKeys) {
                for (const variant of ['original', 'xl', 'l', 'm', 'thumb']) {
                    const cdnUrl = `https://imagedelivery.net/Ud25niyQxx-TAH-Uqr9bjQ/${imageKey}/${variant}`;
                    const capturedPath = getText(assets[cdnUrl]);
                    if (!capturedPath)
                        continue;
                    const imageUrl = new URL(capturedPath, record.origin).toString();
                    if (!imageUrls.includes(imageUrl)) {
                        imageUrls.push(imageUrl);
                    }
                    break;
                }
                if (imageUrls.length >= 20)
                    break;
            }
            return imageUrls;
        };
        let accepted = 0;
        const errors = [];
        await this.withIntegrationContext(record, async () => {
            for (const source of sourceProducts) {
                try {
                    const productKey = getText(source.ProductKey);
                    const productId = getText(source.ProductId);
                    const externalProductId = productKey ?? productId;
                    if (!externalProductId) {
                        throw new Error('Missing product identifier');
                    }
                    const detail = findDetail(externalProductId);
                    const slug = getText(source.ProductSlug) ?? getText(detail.Slug);
                    if (!slug) {
                        throw new Error(`Missing product slug: ${externalProductId}`);
                    }
                    const descriptionFields = [
                        ['Description', detail.ProductDescription],
                        ['Composition', detail.Composition],
                        ['Features', detail.Features],
                        ['Ingredients', detail.Ingredients],
                        ['Dosage', detail.Dosage],
                        ['How to use', detail.HowToUse],
                        ['Storage instructions', detail.StorageInstructions],
                        ['Warnings', detail.Warnings],
                        ['Side effects', detail.SideEffects],
                        ['Contraindications', detail.Contraindications],
                        ['Terms and conditions', detail.TandC],
                    ];
                    const description = descriptionFields
                        .map(([label, value]) => {
                        const text = getText(value);
                        return text ? `${label}:\n${text}` : null;
                    })
                        .filter((value) => Boolean(value))
                        .join('\n\n')
                        .slice(0, 100000);
                    const stock = getNumber(detail.Stock) ?? getNumber(source.Stock);
                    const stockStatus = (getText(detail.StockStatus) ?? getText(source.StockStatus) ?? '').toLowerCase().replace(/[\s_-]/g, '');
                    let availability = 'unknown';
                    if (stockStatus === 'instock' && (stock === null || stock > 0)) {
                        availability = 'in_stock';
                    }
                    else if (stockStatus === 'outofstock' || stock === 0) {
                        availability = 'out_of_stock';
                    }
                    else if (stockStatus.includes('preorder')) {
                        availability = 'preorder';
                    }
                    else if (stockStatus.includes('discontinued')) {
                        availability = 'discontinued';
                    }
                    const active = detail.IsActive !== false && source.IsActive !== false;
                    const attributes = {
                        productId,
                        productCode: getText(detail.ProductCode),
                        hsnCode: getText(detail.HSNCode),
                        schedule: getText(detail.Schedule),
                        unitType: getText(detail.UnitType) ?? getText(source.UnitType),
                        weight: getNumber(detail.Weight) ?? getNumber(source.Weight),
                        gstRate: getNumber(detail.GSTRate),
                        discountPercent: getNumber(detail.DiscountPct) ?? getNumber(source.DiscountPct),
                        averageRating: getNumber(detail.AverageRating) ?? getNumber(source.AverageRating),
                        totalRatings: getNumber(detail.TotalRatings) ?? getNumber(source.TotalRatings),
                    };
                    const productInput = {
                        externalProductId,
                        name: getText(detail.ProductName) ?? getText(source.ProductName) ?? 'Unnamed product',
                        description: description || null,
                        sku: getText(detail.ProductCode),
                        brand: getText(detail.ManufacturerName) ?? getText(source.ManufacturerName),
                        category: getText(source.CatName) ?? getText(detail.CatName),
                        price: getNumber(detail.MRP) ?? getNumber(source.MRP),
                        salePrice: getNumber(detail.SalePrice) ?? getNumber(source.SalePrice),
                        currency: getText(detail.CurrencyCode) ?? getText(source.CurrencyCode) ?? 'INR',
                        stock,
                        availability,
                        images: getImages(source, detail),
                        productUrl: new URL(`/product/${encodeURIComponent(slug)}`, record.origin).toString(),
                        attributes,
                        updatedAt: null,
                        status: active ? 'active' : 'inactive',
                    };
                    const validated = (0, website_integration_dto_1.parseWebsiteProduct)(productInput, record.origin);
                    await this.saveProduct(record, validated);
                    accepted += 1;
                }
                catch (error) {
                    const message = error instanceof Error
                        ? error.message.slice(0, 150)
                        : 'Unknown product import error';
                    errors.push(`Product import skipped: ${message}`);
                    if (errors.length >= 50)
                        break;
                }
            }
        });
        return { accepted, errors };
    }
    async deactivateMissingPages(record) {
        await this.database.transaction(async (manager) => {
            await manager.query(`UPDATE \`website_pages\` SET \`status\`='inactive'
         WHERE \`tenant_id\`=? AND \`integration_id\`=? AND \`status\`='active'
           AND \`last_seen_at\` < (SELECT \`sync_started_at\` FROM \`website_integrations\`
             WHERE \`tenant_id\`=? AND \`id\`=?)
         `, [(0, uuid_1.uuidToBinary)(record.tenantId), (0, uuid_1.uuidToBinary)(record.id), (0, uuid_1.uuidToBinary)(record.tenantId), (0, uuid_1.uuidToBinary)(record.id)]);
            await manager.query(`UPDATE \`knowledge_articles\` a
         JOIN \`website_pages\` p ON p.\`article_id\`=a.\`id\` AND p.\`tenant_id\`=a.\`tenant_id\`
         SET a.\`status\`='archived'
         WHERE p.\`tenant_id\`=? AND p.\`integration_id\`=? AND p.\`status\`='inactive' AND a.\`status\`='published'`, [(0, uuid_1.uuidToBinary)(record.tenantId), (0, uuid_1.uuidToBinary)(record.id)]);
        });
    }
    async pages(integrationId, page, pageSize) {
        const tenantId = this.tenant().tenantId;
        await this.integrations.record(tenantId, integrationId);
        return this.integrations.pages(tenantId, integrationId, page, pageSize);
    }
    async products(integrationId, page, pageSize) {
        const tenantId = this.tenant().tenantId;
        await this.integrations.record(tenantId, integrationId);
        return this.integrations.products(tenantId, integrationId, page, pageSize);
    }
    async knowledgeList(integrationId, page, pageSize) {
        const tenantId = this.tenant().tenantId;
        await this.integrations.record(tenantId, integrationId);
        return this.integrations.listKnowledge(tenantId, integrationId, page, pageSize);
    }
    async rebuildIndex(integrationId) {
        const tenantId = this.tenant().tenantId;
        await this.integrations.record(tenantId, integrationId);
        const pages = await this.integrations.pagesForReindex(tenantId, integrationId);
        let indexed = 0;
        for (const page of pages) {
            if (!Buffer.isBuffer(page.article_id) && !(page.article_id instanceof Uint8Array)) {
                throw new common_1.ServiceUnavailableException('A website knowledge record has an invalid article reference.');
            }
            const articleId = Buffer.from(page.article_id);
            const content = [page.title, page.summary, page.content].filter((value) => typeof value === 'string' && value.length > 0).join('\n\n');
            const language = typeof page.language_code === 'string' ? page.language_code : 'en';
            await this.knowledge.transaction((manager) => this.knowledge.replaceChunks(manager, { articleId }, (0, text_utils_1.chunkText)(content), language));
            indexed += 1;
        }
        await this.integrations.refreshCounts(tenantId, integrationId);
        return { id: integrationId, status: 'completed', indexed };
    }
    async authenticateIngestion(key) {
        if (!key || !/^mzi_[A-Za-z0-9_-]{43}$/.test(key))
            throw new common_1.UnauthorizedException('Integration credentials are invalid.');
        await this.limiter.hit(`website-ingest:key:${digest(key)}`, 300);
        const record = await this.integrations.byIngestionKey(key);
        if (!record)
            throw new common_1.UnauthorizedException('Integration credentials are invalid.');
        (0, website_integration_dto_1.assertWebsiteIngestionOrigin)(record.origin);
        return record;
    }
    async ingestPages(key, body) {
        const record = await this.authenticateIngestion(key);
        if (!Array.isArray(body) || body.length > 50)
            throw new common_1.BadRequestException('Page batch is invalid.');
        const pages = body.map((page) => (0, website_integration_dto_1.parseWebsitePage)(page, record.origin));
        return this.withIntegrationContext(record, async () => {
            let indexed = 0;
            for (const page of pages) {
                const result = await this.savePage(record, page);
                if (result.indexed)
                    indexed += 1;
            }
            await this.integrations.refreshCounts(record.tenantId, record.id);
            return { accepted: pages.length, indexed };
        });
    }
    async ingestProducts(key, body) {
        const record = await this.authenticateIngestion(key);
        if (!Array.isArray(body) || body.length > 100)
            throw new common_1.BadRequestException('Product batch is invalid.');
        const products = body.map((product) => (0, website_integration_dto_1.parseWebsiteProduct)(product, record.origin));
        return this.withIntegrationContext(record, async () => {
            for (const product of products)
                await this.saveProduct(record, product);
            await this.integrations.refreshCounts(record.tenantId, record.id);
            return { accepted: products.length };
        });
    }
    async ingestBatch(key, body) {
        const record = await this.authenticateIngestion(key);
        const { pages, products } = (0, website_integration_dto_1.parseWebsiteBatch)(body, record.origin);
        return this.withIntegrationContext(record, async () => {
            let indexed = 0;
            for (const page of pages) {
                const result = await this.savePage(record, page);
                if (result.indexed)
                    indexed += 1;
            }
            for (const product of products)
                await this.saveProduct(record, product);
            await this.integrations.refreshCounts(record.tenantId, record.id);
            return { accepted: { pages: pages.length, products: products.length }, indexed };
        });
    }
    async withIntegrationContext(record, work) {
        const context = {
            tenantId: record.tenantId, actorType: 'api_key', assistantId: record.assistantId,
            permissions: INTEGRATION_PERMISSIONS, requestId: (0, node_crypto_1.randomUUID)(),
        };
        return tenant_context_store_1.tenantContextStore.run(context, work);
    }
    async savePage(record, page) {
        const urlHash = digest(page.url);
        const cleaned = {
            ...page,
            title: (0, text_utils_1.sanitizeText)(page.title),
            metaDescription: page.metaDescription ? (0, text_utils_1.sanitizeText)(page.metaDescription) : null,
            mainContent: (0, text_utils_1.sanitizeText)(page.mainContent),
            headings: page.headings.map(text_utils_1.sanitizeText),
            links: page.links.map((link) => ({ url: link.url, text: (0, text_utils_1.sanitizeText)(link.text) })),
        };
        const content = [cleaned.headings.join('\n'), cleaned.mainContent].filter(Boolean).join('\n\n');
        const contentHash = digest(JSON.stringify([
            cleaned.title, cleaned.metaDescription, content, cleaned.pageType, cleaned.language,
        ]));
        await this.knowledge.ensureDefaultCategories();
        const categories = await this.knowledge.listCategories();
        const category = categories.find((item) => item.slug === 'health-education');
        if (!category?.id)
            throw new common_1.ServiceUnavailableException('The knowledge base is unavailable.');
        const categoryId = Buffer.isBuffer(category.id) ? category.id : (0, uuid_1.uuidToBinary)((0, uuid_1.binaryToUuid)(category.id));
        const existing = await this.integrations.findPage(record.tenantId, record.id, urlHash);
        const articleId = existing?.article_id
            ? Buffer.from(existing.article_id)
            : (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)());
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
                    updatedBy: record.createdBy ? (0, uuid_1.uuidToBinary)(record.createdBy) : null,
                }, cleaned.status === 'active');
            }
            else {
                await this.knowledge.insertArticle(manager, {
                    id: articleId, categoryId, title: cleaned.title, summary: cleaned.metaDescription, content,
                    language: cleaned.language, status: cleaned.status === 'active' ? 'published' : 'archived',
                    sourceName: record.name, sourceUrl: cleaned.url, referenceNote: `Website page from ${record.origin}`,
                    userId: record.createdBy ? (0, uuid_1.uuidToBinary)(record.createdBy) : null,
                });
            }
            if (indexed && cleaned.status === 'active') {
                await this.knowledge.replaceChunks(manager, { articleId }, (0, text_utils_1.chunkText)(`${cleaned.title}\n${cleaned.metaDescription ?? ''}\n${content}`), cleaned.language);
            }
            else if (cleaned.status === 'inactive') {
                await this.knowledge.replaceChunks(manager, { articleId }, [], cleaned.language);
            }
            await this.integrations.upsertPage({
                tenantId: record.tenantId, integrationId: record.id, pageId: existing?.id
                    ? Buffer.from(existing.id) : (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()),
                articleId, url: cleaned.url, urlHash, contentHash, page: cleaned,
            }, manager);
        });
        return { indexed };
    }
    async saveProduct(record, product) {
        const canonical = JSON.stringify(product);
        await this.integrations.upsertProduct(record.tenantId, record.id, product, digest(canonical));
    }
    async toolSearchPages(context, query, type, limit) {
        if (!context.assistantId)
            return [];
        return this.integrations.searchPages(context.tenantId, context.assistantId, query, type, limit);
    }
    async toolSearchProducts(context, input) {
        if (!context.assistantId)
            return [];
        return this.integrations.searchProducts(context.tenantId, context.assistantId, input);
    }
};
exports.WebsiteIntegrationService = WebsiteIntegrationService;
exports.WebsiteIntegrationService = WebsiteIntegrationService = WebsiteIntegrationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, typeorm_1.InjectDataSource)()),
    __param(3, (0, common_1.Optional)()),
    __param(3, (0, common_1.Inject)(shared_state_1.SHARED_STATE)),
    __param(4, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [website_integration_repository_1.WebsiteIntegrationRepository,
        knowledge_repository_1.KnowledgeRepository, Function, Object, tool_configuration_repository_1.ToolConfigurationRepository])
], WebsiteIntegrationService);
//# sourceMappingURL=website-integration.service.js.map
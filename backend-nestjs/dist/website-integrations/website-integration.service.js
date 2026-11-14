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
                    const saved = await this.withIntegrationContext(record, () => this.savePage(record, { ...page, language: 'en', status: 'active' }));
                    pages += 1;
                    if (saved.indexed)
                        indexed += 1;
                }
                catch {
                    errors.push(`${new URL(page.url).pathname}: page could not be indexed`);
                }
            }
            errors.push(...result.errors.slice(0, Math.max(0, 50 - errors.length)));
            const imported = await this.importStorefrontProducts(record);
            products = imported.accepted;
            errors.push(...imported.errors.slice(0, Math.max(0, 50 - errors.length)));
            const pageImport = await this.importStorefrontPages(record);
            pages += pageImport.accepted;
            indexed += pageImport.indexed;
            errors.push(...pageImport.errors.slice(0, Math.max(0, 50 - errors.length)));
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
                : 'Crawler or product import failed.';
            await this.integrations.finishSync(record.tenantId, record.id, {
                status: 'failed',
                pages,
                products,
                indexed,
                errors: [message],
            });
        }
    }
    async importStorefrontPages(record) {
        const catalog = await this.crawler.fetchStorefrontCatalog(record.origin);
        if (!catalog || typeof catalog !== 'object') {
            return { accepted: 0, indexed: 0, errors: ['Catalogue unavailable for page indexing.'] };
        }
        const data = catalog;
        const products = Array.isArray(data.products)
            ? data.products
            : [];
        const categories = Array.isArray(data.categories)
            ? data.categories
            : [];
        const detailsValue = data.details;
        const details = Array.isArray(detailsValue)
            ? detailsValue
            : detailsValue && typeof detailsValue === 'object'
                ? Object.values(detailsValue)
                    .filter((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
                : [];
        const scalarText = (value) => {
            if (typeof value === 'string' && value.trim())
                return value.trim();
            if (typeof value === 'number' || typeof value === 'boolean')
                return String(value);
            return null;
        };
        const describe = (value) => Object.entries(value)
            .filter(([, item]) => item !== null && item !== undefined && item !== '')
            .map(([key, item]) => {
            const rendered = scalarText(item) ??
                (Array.isArray(item) ? item.map(scalarText).filter(Boolean).join(', ') : null);
            return rendered ? `${key}: ${rendered}` : null;
        })
            .filter((line) => Boolean(line))
            .join('\n');
        const slugify = (value) => value.toLowerCase().trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const pageJobs = [];
        const productLinks = products
            .map((product) => {
            const name = scalarText(product.ProductName);
            const slug = scalarText(product.ProductSlug);
            if (!name || !slug)
                return null;
            return {
                url: new URL(`/product/${encodeURIComponent(slug)}`, record.origin).toString(),
                text: name,
            };
        })
            .filter((item) => Boolean(item));
        const settings = data.settings && typeof data.settings === 'object'
            ? data.settings
            : {};
        const meta = data.meta && typeof data.meta === 'object'
            ? data.meta
            : {};
        pageJobs.push({
            path: '/',
            title: scalarText(meta.title) || `${record.name} - Home`,
            content: [
                `${record.name} website homepage.`,
                `Website: ${record.origin}`,
                `Available catalogue products: ${products.length}`,
                `Available catalogue categories: ${categories.length}`,
                describe(settings),
                describe(meta),
            ].filter(Boolean).join('\n\n'),
            pageType: 'page',
            links: [
                { url: new URL('/products', record.origin).toString(), text: 'All products' },
                { url: new URL('/categories', record.origin).toString(), text: 'All categories' },
                ...productLinks.slice(0, 50),
            ].slice(0, 100),
        });
        pageJobs.push({
            path: '/products',
            title: `${record.name} - Products`,
            content: [
                `Product catalogue for ${record.name}.`,
                `Total catalogue products: ${products.length}.`,
                ...products.map((product) => {
                    const name = scalarText(product.ProductName) || 'Unnamed product';
                    return `${name}\n${describe(product)}`;
                }),
            ].join('\n\n'),
            pageType: 'page',
            links: productLinks.slice(0, 100),
        });
        pageJobs.push({
            path: '/categories',
            title: `${record.name} - Categories`,
            content: [
                `Product categories available on ${record.name}.`,
                `Total catalogue categories: ${categories.length}.`,
                ...categories.map((category) => describe(category)),
            ].filter(Boolean).join('\n\n'),
            pageType: 'category',
            links: [],
        });
        for (const product of products) {
            const name = scalarText(product.ProductName);
            const slug = scalarText(product.ProductSlug);
            if (!name || !slug)
                continue;
            const productId = scalarText(product.ProductId);
            const productKey = scalarText(product.ProductKey);
            const detail = details.find((item) => {
                const ids = [
                    item.ProductId, item.ProductKey, item.ProductCode,
                    item.ProductSlug, item.Slug,
                ].map(scalarText).filter(Boolean);
                return Boolean((productId && ids.includes(productId)) ||
                    (productKey && ids.includes(productKey)) ||
                    ids.includes(slug));
            });
            pageJobs.push({
                path: `/product/${encodeURIComponent(slug)}`,
                title: name,
                content: [
                    `Product: ${name}`,
                    `Website: ${record.origin}`,
                    describe(product),
                    detail ? describe(detail) : '',
                ].filter(Boolean).join('\n\n'),
                pageType: 'product',
                links: [
                    { url: new URL('/products', record.origin).toString(), text: 'All products' },
                    { url: new URL('/categories', record.origin).toString(), text: 'Product categories' },
                ],
            });
        }
        let accepted = 0;
        let indexed = 0;
        const errors = [];
        for (const job of pageJobs.slice(0, 50)) {
            try {
                const url = new URL(job.path, record.origin).toString();
                const page = (0, website_integration_dto_1.parseWebsitePage)({
                    url,
                    title: job.title,
                    metaDescription: null,
                    mainContent: job.content || job.title,
                    headings: [job.title],
                    links: job.links,
                    pageType: job.pageType,
                    language: 'en',
                    lastUpdatedAt: null,
                    status: 'active',
                }, record.origin);
                const result = await this.withIntegrationContext(record, () => this.savePage(record, page));
                accepted += 1;
                if (result.indexed)
                    indexed += 1;
            }
            catch (error) {
                const message = error instanceof Error ? error.message.slice(0, 120) : 'Unknown error';
                errors.push(`${job.path}: ${message}`);
            }
        }
        return { accepted, indexed, errors };
    }
    async importStorefrontProducts(record) {
        const catalog = await this.crawler.fetchStorefrontCatalog(record.origin);
        if (!catalog) {
            return { accepted: 0, errors: ['No /data/storefront.json catalogue found.'] };
        }
        const data = catalog;
        const rows = data.products;
        const details = data.details;
        const assets = data.assets;
        const text = (value) => {
            if (typeof value === 'string' && value.trim())
                return value.trim();
            if (typeof value === 'number' || typeof value === 'boolean')
                return String(value);
            return null;
        };
        const number = (value) => {
            if (typeof value === 'number' && Number.isFinite(value))
                return value;
            if (typeof value === 'string' && value.trim() !== '') {
                const parsed = Number(value);
                if (Number.isFinite(parsed))
                    return parsed;
            }
            return null;
        };
        const acceptedImages = (product, detail) => {
            const entries = Array.isArray(detail.Images)
                ? detail.Images
                : [];
            const keys = entries
                .slice()
                .sort((a, b) => {
                const ap = a.IsPrimary === true ? 0 : Number(a.SortOrder ?? 999);
                const bp = b.IsPrimary === true ? 0 : Number(b.SortOrder ?? 999);
                return ap - bp;
            })
                .map(item => text(item.ImageKey))
                .filter((key) => Boolean(key));
            const fallback = text(detail.ImageKey) ?? text(product.ImageKey);
            if (fallback)
                keys.push(fallback);
            const result = [];
            for (const key of [...new Set(keys)]) {
                const asset = Object.entries(assets).find(([cdnUrl]) => cdnUrl.includes(`/${key}/`));
                if (!asset)
                    continue;
                const path = text(asset[1]);
                if (!path)
                    continue;
                const imageUrl = new URL(path, record.origin).toString();
                if (!result.includes(imageUrl))
                    result.push(imageUrl);
                if (result.length >= 20)
                    break;
            }
            return result;
        };
        let accepted = 0;
        const errors = [];
        await this.withIntegrationContext(record, async () => {
            for (const row of rows) {
                try {
                    const externalProductId = text(row.ProductKey) ?? text(row.ProductId);
                    if (!externalProductId) {
                        throw new Error('Missing product identifier');
                    }
                    const detailValue = Object.entries(details).find(([key]) => key.toLowerCase() === externalProductId.toLowerCase())?.[1];
                    const detail = detailValue && typeof detailValue === 'object'
                        ? detailValue
                        : {};
                    const slug = text(row.ProductSlug) ?? text(detail.Slug);
                    if (!slug)
                        throw new Error(`Missing slug for ${externalProductId}`);
                    const fields = [
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
                    const description = fields
                        .map(([label, value]) => {
                        const valueText = text(value);
                        return valueText ? `${label}:\n${valueText}` : null;
                    })
                        .filter((value) => Boolean(value))
                        .join('\n\n')
                        .slice(0, 100000);
                    const rawStock = number(detail.Stock) ?? number(row.Stock);
                    const stock = rawStock === null ? null : Math.trunc(rawStock);
                    const stockStatus = (text(detail.StockStatus) ?? text(row.StockStatus) ?? '').toLowerCase().replace(/[\s_-]/g, '');
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
                    const attributes = {};
                    const attributeValues = {
                        productId: text(row.ProductId),
                        productCode: text(detail.ProductCode),
                        hsnCode: text(detail.HSNCode),
                        schedule: text(detail.Schedule),
                        unitType: text(detail.UnitType) ?? text(row.UnitType),
                        weight: number(detail.Weight) ?? number(row.Weight),
                        gstRate: number(detail.GSTRate),
                        discountPercent: number(detail.DiscountPct) ?? number(row.DiscountPct),
                        averageRating: number(detail.AverageRating) ?? number(row.AverageRating),
                        totalRatings: number(detail.TotalRatings) ?? number(row.TotalRatings),
                    };
                    for (const [key, value] of Object.entries(attributeValues)) {
                        if (value !== undefined)
                            attributes[key] = value;
                    }
                    const input = {
                        externalProductId,
                        name: text(detail.ProductName) ?? text(row.ProductName) ?? 'Unnamed product',
                        description: description || null,
                        sku: text(detail.ProductCode),
                        brand: text(detail.ManufacturerName) ?? text(row.ManufacturerName),
                        category: text(row.CatName) ?? text(detail.CatName),
                        price: number(detail.MRP) ?? number(row.MRP),
                        salePrice: number(detail.SalePrice) ?? number(row.SalePrice),
                        currency: text(detail.CurrencyCode) ?? text(row.CurrencyCode) ?? 'INR',
                        stock,
                        availability,
                        images: acceptedImages(row, detail),
                        productUrl: new URL(`/product/${encodeURIComponent(slug)}`, record.origin).toString(),
                        attributes,
                        updatedAt: null,
                        status: detail.IsActive === false || row.IsActive === false
                            ? 'inactive'
                            : 'active',
                    };
                    const validated = (0, website_integration_dto_1.parseWebsiteProduct)(input, record.origin);
                    await this.saveProduct(record, validated);
                    accepted += 1;
                }
                catch (error) {
                    const message = error instanceof Error
                        ? error.message.slice(0, 150)
                        : 'Unknown product import error';
                    errors.push(`Product skipped: ${message}`);
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
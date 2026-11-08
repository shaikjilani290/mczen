"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLocalWebsiteOrigin = isLocalWebsiteOrigin;
exports.assertWebsiteIngestionOrigin = assertWebsiteIngestionOrigin;
exports.parseCreateWebsiteIntegration = parseCreateWebsiteIntegration;
exports.parseWebsitePage = parseWebsitePage;
exports.parseWebsiteProduct = parseWebsiteProduct;
exports.parseWebsiteBatch = parseWebsiteBatch;
exports.parseSiteConnect = parseSiteConnect;
exports.parsePageView = parsePageView;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
const widget_dto_1 = require("../widget/widget.dto");
const invalid = () => { throw new common_1.BadRequestException('Invalid website integration request.'); };
function isLocalWebsiteOrigin(origin) {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname.replace(/\.$/, ''));
}
function assertWebsiteIngestionOrigin(origin) {
    if (isLocalWebsiteOrigin(origin) &&
        (process.env.NODE_ENV !== 'development' || process.env.MCZEN_ALLOW_LOCAL_INGESTION !== '1')) {
        throw new common_1.BadRequestException('Local website ingestion requires NODE_ENV=development and MCZEN_ALLOW_LOCAL_INGESTION=1.');
    }
}
const record = (value, fields) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return invalid();
    const result = value;
    if (Object.keys(result).some((key) => !fields.includes(key)))
        return invalid();
    return result;
};
function text(value, max, min = 0) {
    if (typeof value !== 'string')
        return invalid();
    const result = value.trim();
    if (result.length < min || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result))
        return invalid();
    return result;
}
function sameOriginUrl(value, origin, maxLength, canonical = false) {
    const raw = text(value, maxLength, 1);
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return invalid();
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== origin)
        return invalid();
    const localPage = canonical && isLocalWebsiteOrigin(origin);
    if (!localPage)
        url.hash = '';
    if (canonical && !localPage)
        url.search = '';
    return url.toString();
}
function stringList(value, maxItems, maxLength) {
    if (!Array.isArray(value) || value.length > maxItems)
        return invalid();
    return [...new Set(value.map((item) => text(item, maxLength, 1)))];
}
function date(value) {
    if (value === undefined || value === null || value === '')
        return null;
    if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value)))
        return invalid();
    return new Date(value);
}
function parseCreateWebsiteIntegration(body) {
    const input = record(body, ['name', 'domain', 'assistantId']);
    const name = text(input.name, 120, 1);
    if (typeof input.assistantId !== 'string' || !(0, uuid_1.isUuidv7)(input.assistantId))
        return invalid();
    let origin;
    try {
        const raw = text(input.domain, 253, 1);
        origin = (0, widget_dto_1.normalizeOrigin)(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    }
    catch {
        return invalid();
    }
    assertWebsiteIngestionOrigin(origin);
    return { name, origin, assistantId: input.assistantId };
}
function parseWebsitePage(value, origin) {
    assertWebsiteIngestionOrigin(origin);
    const input = record(value, [
        'url', 'title', 'metaDescription', 'mainContent', 'headings', 'links',
        'pageType', 'language', 'lastUpdatedAt', 'status',
    ]);
    const type = input.pageType === undefined ? 'page' : text(input.pageType, 30, 1).toLowerCase();
    if (!['page', 'faq', 'product', 'service', 'policy', 'category'].includes(type))
        return invalid();
    const language = input.language === undefined ? 'en' : input.language;
    if (typeof language !== 'string' || !widget_dto_1.WIDGET_LANGUAGES.includes(language))
        return invalid();
    const links = input.links === undefined ? [] : input.links;
    if (!Array.isArray(links) || links.length > 100)
        return invalid();
    const parsedLinks = links.map((value) => {
        const link = record(value, ['url', 'text']);
        return { url: sameOriginUrl(link.url, origin, 1000, true), text: text(link.text, 300) };
    });
    const status = input.status === undefined ? 'active' : input.status;
    if (status !== 'active' && status !== 'inactive')
        return invalid();
    const description = input.metaDescription == null ? null : text(input.metaDescription, 1000);
    return {
        url: sameOriginUrl(input.url, origin, 1000, true),
        title: text(input.title, 200, 1),
        metaDescription: description,
        mainContent: text(input.mainContent, 200_000, 1),
        headings: input.headings === undefined ? [] : stringList(input.headings, 100, 300),
        links: parsedLinks,
        pageType: type,
        language: language,
        lastUpdatedAt: date(input.lastUpdatedAt),
        status,
    };
}
function nullableText(value, max) {
    return value == null || value === '' ? null : text(value, max, 1);
}
function price(value) {
    if (value == null || value === '')
        return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9_999_999_999.99)
        return invalid();
    return Math.round(value * 100) / 100;
}
function parseWebsiteProduct(value, origin) {
    assertWebsiteIngestionOrigin(origin);
    const input = record(value, [
        'externalProductId', 'name', 'description', 'sku', 'brand', 'category',
        'price', 'salePrice', 'currency', 'stock', 'availability', 'images',
        'productUrl', 'attributes', 'updatedAt', 'status',
    ]);
    const availability = input.availability === undefined ? 'unknown' : input.availability;
    if (typeof availability !== 'string' ||
        !['in_stock', 'out_of_stock', 'preorder', 'discontinued', 'unknown'].includes(availability))
        return invalid();
    const status = input.status === undefined ? 'active' : input.status;
    if (status !== 'active' && status !== 'inactive')
        return invalid();
    let stock = null;
    if (input.stock !== undefined && input.stock !== null) {
        if (!Number.isInteger(input.stock) || Number(input.stock) < 0 || Number(input.stock) > 2_147_483_647)
            return invalid();
        stock = Number(input.stock);
    }
    let images = [];
    if (input.images !== undefined) {
        if (!Array.isArray(input.images) || input.images.length > 20)
            return invalid();
        images = input.images.map((image) => {
            const url = text(image, 1000, 1);
            let parsed;
            try {
                parsed = new URL(url);
            }
            catch {
                return invalid();
            }
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
                return invalid();
            return parsed.toString();
        });
    }
    const attributesValue = input.attributes === undefined ? {} : input.attributes;
    if (!attributesValue || typeof attributesValue !== 'object' || Array.isArray(attributesValue) ||
        Object.keys(attributesValue).length > 100 || JSON.stringify(attributesValue).length > 10_000)
        return invalid();
    const attributes = Object.fromEntries(Object.entries(attributesValue));
    for (const [key, val] of Object.entries(attributes)) {
        if (key.length > 100 || !(typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null) ||
            (typeof val === 'string' && val.length > 1000) || (typeof val === 'number' && !Number.isFinite(val)))
            return invalid();
    }
    const currency = nullableText(input.currency, 3)?.toUpperCase() ?? null;
    if (currency && !/^[A-Z]{3}$/.test(currency))
        return invalid();
    return {
        externalProductId: text(input.externalProductId, 200, 1),
        name: text(input.name, 200, 1),
        description: nullableText(input.description, 100_000),
        sku: nullableText(input.sku, 100),
        brand: nullableText(input.brand, 150),
        category: nullableText(input.category, 150),
        price: price(input.price),
        salePrice: price(input.salePrice),
        currency,
        stock,
        availability: availability,
        images,
        productUrl: sameOriginUrl(input.productUrl, origin, 1000),
        attributes,
        updatedAt: date(input.updatedAt),
        status,
    };
}
function parseWebsiteBatch(body, origin) {
    const input = record(body, ['pages', 'products']);
    if (input.pages === undefined && input.products === undefined)
        return invalid();
    const pages = input.pages === undefined ? [] : input.pages;
    const products = input.products === undefined ? [] : input.products;
    if (!Array.isArray(pages) || pages.length > 50 || !Array.isArray(products) || products.length > 100)
        return invalid();
    return {
        pages: pages.map((page) => parseWebsitePage(page, origin)),
        products: products.map((product) => parseWebsiteProduct(product, origin)),
    };
}
function parseSiteConnect(body) {
    const input = record(body, ['publicKey', 'assistantId', 'language']);
    if (typeof input.publicKey !== 'string' || !/^mzp_[A-Za-z0-9_-]{43}$/.test(input.publicKey))
        return invalid();
    if (input.assistantId !== undefined && (typeof input.assistantId !== 'string' || !(0, uuid_1.isUuidv7)(input.assistantId)))
        return invalid();
    if (input.language !== undefined &&
        (typeof input.language !== 'string' || !widget_dto_1.WIDGET_LANGUAGES.includes(input.language)))
        return invalid();
    return {
        publicKey: input.publicKey,
        ...(input.assistantId ? { assistantId: input.assistantId } : {}),
        ...(input.language ? { language: input.language } : {}),
    };
}
function parsePageView(body) {
    const input = record(body, ['pageUrl', 'title', 'referrer']);
    const safeOrigin = (value) => {
        if (value == null || value === '')
            return null;
        if (typeof value !== 'string' || value.length > 2048)
            return invalid();
        let url;
        try {
            url = new URL(value);
        }
        catch {
            return invalid();
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            return invalid();
        return url.origin;
    };
    const rawUrl = text(input.pageUrl, 2048, 1);
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        return invalid();
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        return invalid();
    url.search = '';
    url.hash = '';
    return {
        pageUrl: url.toString(),
        title: input.title == null ? null : text(input.title, 300),
        referrer: safeOrigin(input.referrer),
    };
}
//# sourceMappingURL=website-integration.dto.js.map
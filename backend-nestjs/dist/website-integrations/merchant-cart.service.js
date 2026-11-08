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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantCartService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:timers/promises");
const shared_state_1 = require("../shared-state/shared-state");
const website_integration_repository_1 = require("./website-integration.repository");
const hash = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
let MerchantCartService = class MerchantCartService {
    store;
    products;
    constructor(store, products) {
        this.store = store;
        this.products = products;
    }
    scope(tenant, binding) {
        return `merchant-cart:${tenant}:${binding.integrationId}:${binding.sessionId}`;
    }
    async poll(tenant, binding, body) {
        if (!record(body) || Object.keys(body).some(k => !['selectedProductId'].includes(k)) ||
            (body.selectedProductId !== undefined && (typeof body.selectedProductId !== 'string' || body.selectedProductId.length > 200))) {
            throw new common_1.BadRequestException('Invalid merchant cart polling request.');
        }
        const scope = this.scope(tenant, binding);
        await this.store.put(`${scope}:available`, 'true', 15_000);
        if (body.selectedProductId && body.selectedProductId !== await this.store.get(`${scope}:page`)) {
            await this.store.put(`${scope}:page`, body.selectedProductId, 3_600_000);
            await this.updateShoppingContext({ tenantId: tenant, merchant: binding, permissions: [], requestId: 'merchant-page-selection' }, { currentProductId: body.selectedProductId, currentProductName: '' });
        }
        const pending = await this.store.get(`${scope}:pending`);
        return { action: pending ? JSON.parse(pending) : null };
    }
    async remember(context, ids, select = true) {
        if (!context.merchant || !ids.length)
            return;
        await this.store.put(`${this.scope(context.tenantId, context.merchant)}:choices`, JSON.stringify(ids.slice(0, 5)), 3_600_000);
        if (select)
            await this.store.put(`${this.scope(context.tenantId, context.merchant)}:selected`, ids[0], 3_600_000);
    }
    async shoppingContext(context) {
        if (!context.merchant)
            return {};
        const value = await this.store.get(`${this.scope(context.tenantId, context.merchant)}:context`);
        return value ? JSON.parse(value) : {};
    }
    async updateShoppingContext(context, update) {
        if (!context.merchant)
            return;
        const scope = this.scope(context.tenantId, context.merchant);
        const previous = await this.shoppingContext(context);
        const next = { ...previous, ...update };
        if (update.currentProductId && update.currentProductId !== previous.currentProductId) {
            next.previousProductId = previous.currentProductId;
        }
        await this.store.put(`${scope}:context`, JSON.stringify(next), 3_600_000);
        if (update.currentProductId)
            await this.store.put(`${scope}:selected`, update.currentProductId, 3_600_000);
    }
    async selected(context, ordinal, pageReference = false) {
        if (!context.merchant)
            return undefined;
        const scope = this.scope(context.tenantId, context.merchant);
        if (ordinal !== undefined) {
            const choices = await this.store.get(`${scope}:choices`);
            return choices ? JSON.parse(choices)[ordinal] : undefined;
        }
        return (pageReference ? await this.store.get(`${scope}:page`) : undefined) ??
            await this.store.get(`${scope}:selected`) ?? undefined;
    }
    async rememberProductContext(tenant, binding, assistantId, body) {
        if (!record(body) || Object.keys(body).some(key => !['externalProductId', 'productUrl', 'name', 'sections'].includes(key)) ||
            typeof body.externalProductId !== 'string' || !body.externalProductId || body.externalProductId.length > 200 ||
            typeof body.productUrl !== 'string' || body.productUrl.length > 1000 ||
            typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 ||
            !Array.isArray(body.sections) || !body.sections.length || body.sections.length > 24 ||
            JSON.stringify(body).length > 48000) {
            throw new common_1.BadRequestException('Invalid product page context.');
        }
        const sections = body.sections.map((section) => {
            if (!record(section) || Object.keys(section).some(key => !['title', 'content'].includes(key)) ||
                typeof section.title !== 'string' || !section.title.trim() || section.title.length > 200 ||
                typeof section.content !== 'string' || !section.content.trim() || section.content.length > 12000 ||
                /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(section.content)) {
                throw new common_1.BadRequestException('Invalid product page section.');
            }
            return { title: section.title.trim(), content: section.content.trim() };
        });
        let url;
        try {
            url = new URL(body.productUrl);
        }
        catch {
            throw new common_1.BadRequestException('Invalid product page URL.');
        }
        if (url.origin !== binding.origin || url.username || url.password || url.search || url.hash) {
            throw new common_1.BadRequestException('The product page is outside this merchant session.');
        }
        const rows = await this.products.searchProducts(tenant, assistantId, {
            productUrl: url.href, integrationId: binding.integrationId, limit: 1,
        });
        if (rows.length !== 1 || rows[0].productUrl !== url.href || typeof rows[0].externalProductId !== 'string') {
            throw new common_1.BadRequestException('The product page does not match the connected catalogue.');
        }
        const scope = this.scope(tenant, binding);
        const context = {
            externalProductId: rows[0].externalProductId,
            productUrl: url.href,
            source: 'merchant-rendered-page',
            sections,
        };
        await this.store.put(`${scope}:product:${rows[0].externalProductId}`, JSON.stringify(context), 3_600_000);
        await this.store.put(`${scope}:page`, rows[0].externalProductId, 3_600_000);
        await this.updateShoppingContext({ tenantId: tenant, merchant: binding, permissions: [], requestId: 'merchant-product-context' }, { currentProductId: rows[0].externalProductId, currentProductName: String(rows[0].name ?? '') });
        return { accepted: true, sections: sections.length };
    }
    async productContext(context, productId) {
        if (!context.merchant)
            return undefined;
        const value = await this.store.get(`${this.scope(context.tenantId, context.merchant)}:product:${productId}`);
        return value ? JSON.parse(value) : undefined;
    }
    async complete(tenant, binding, body) {
        if (!record(body) || Object.keys(body).some(k => !['id', 'success', 'cart', 'error'].includes(k)) ||
            typeof body.id !== 'string' || !/^[a-f0-9]{64}$/.test(body.id) || typeof body.success !== 'boolean') {
            throw new common_1.BadRequestException('Invalid merchant cart acknowledgement.');
        }
        const scope = this.scope(tenant, binding);
        const pending = await this.store.get(`${scope}:pending`);
        if (!pending || JSON.parse(pending).id !== body.id) {
            throw new common_1.BadRequestException('Merchant cart operation expired or does not belong to this session.');
        }
        const action = JSON.parse(pending);
        if (body.success) {
            const cart = await this.validateSnapshot(tenant, binding, body.cart);
            const item = cart.items.find(i => i.productId === action.productId && i.variantId === action.variantId);
            if ((action.operation === 'add_to_cart' && (!item || item.quantity < (action.quantity ?? 1))) ||
                (action.operation === 'update_cart_item' && item?.quantity !== action.quantity) ||
                (action.operation === 'remove_cart_item' && action.quantity === undefined && item)) {
                throw new common_1.BadRequestException('The merchant cart read-back does not confirm the requested change.');
            }
            await this.store.put(`${scope}:result:${action.id}`, JSON.stringify({ success: true, cart }), 60_000);
        }
        else {
            if (typeof body.error !== 'string' || !body.error.trim() || body.error.length > 300) {
                throw new common_1.BadRequestException('A bounded merchant error message is required.');
            }
            await this.store.put(`${scope}:result:${action.id}`, JSON.stringify({ success: false, error: body.error }), 60_000);
        }
        return { acknowledged: true };
    }
    async execute(operation, input, context, signal) {
        const binding = context.merchant;
        if (context.channel !== 'widget' || !binding)
            return { success: false, error: 'A verified merchant customer session is required.' };
        const integration = await this.products.activeRecord(context.tenantId, binding.integrationId);
        if (!integration || integration.assistantId !== context.assistantId || integration.origin !== binding.origin) {
            return { success: false, error: 'This merchant session is no longer authorised.' };
        }
        const scope = this.scope(context.tenantId, binding);
        if (!await this.store.get(`${scope}:available`))
            return { success: false, error: 'The merchant cart adapter is offline. Open the merchant website and try again.' };
        const productId = typeof input.productId === 'string' ? input.productId : undefined;
        const variantId = typeof input.variantId === 'string' ? input.variantId : undefined;
        const quantity = input.quantity;
        if (['add_to_cart', 'update_cart_item', 'remove_cart_item'].includes(operation)) {
            if (!productId)
                return { success: false, error: 'Choose a product first.' };
            const rows = await this.products.searchProducts(context.tenantId, context.assistantId, {
                ids: [productId], integrationId: binding.integrationId, limit: 1,
            });
            if (rows.length !== 1)
                return { success: false, error: 'The product is unavailable for this merchant.' };
            if (variantId)
                return { success: false, error: 'This catalogue has no verified variants. Choose the base product; pack estimates are not orderable variants.' };
            if (operation === 'remove_cart_item' && quantity !== undefined &&
                (!Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 99)) {
                return { success: false, error: 'Quantity must be a whole number from 1 to 99.' };
            }
            if (operation !== 'remove_cart_item') {
                if (!Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 99)
                    return { success: false, error: 'Quantity must be a whole number from 1 to 99.' };
                const row = rows[0];
                if (row.availability !== 'in_stock' || typeof row.stock !== 'number' || row.stock < Number(quantity)) {
                    return { success: false, error: 'The product is out of stock or its availability cannot be verified.' };
                }
            }
        }
        const action = {
            id: hash(`${context.requestId}:${operation}:${JSON.stringify({ productId, variantId, quantity })}`),
            operation, ...(productId ? { productId } : {}), ...(variantId ? { variantId } : {}),
            ...(quantity !== undefined ? { quantity: Number(quantity) } : {}),
        };
        const saved = await this.store.get(`${scope}:result:${action.id}`);
        if (saved)
            return JSON.parse(saved);
        const acquired = await this.store.acquireSlot(scope, action.id, 1, 20_000);
        if (!acquired)
            return { success: false, error: 'A merchant cart operation is already pending. Check the cart before retrying.' };
        try {
            await this.store.put(`${scope}:pending`, JSON.stringify(action), 18_000);
            const deadline = Date.now() + 15_000;
            while (Date.now() < deadline) {
                if (signal.aborted)
                    break;
                const result = await this.store.get(`${scope}:result:${action.id}`);
                if (result)
                    return JSON.parse(result);
                await (0, promises_1.setTimeout)(100, undefined, { signal });
            }
            return { success: false, error: 'The merchant cart acknowledgement timed out. The result is uncertain; inspect your cart before requesting another addition.' };
        }
        finally {
            await this.store.del(`${scope}:pending`);
            await this.store.releaseSlot(scope, action.id);
        }
    }
    async validateSnapshot(tenant, binding, value) {
        if (!record(value) || !Array.isArray(value.items) || value.items.length > 100 || value.cartPath !== '/cart' ||
            typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency))
            throw new common_1.BadRequestException('Invalid merchant cart read-back.');
        const items = [];
        for (const entry of value.items) {
            if (!record(entry) || typeof entry.productId !== 'string' || entry.variantId !== undefined ||
                !Number.isInteger(entry.quantity) || Number(entry.quantity) < 1 || Number(entry.quantity) > 99 ||
                items.some(i => i.productId === entry.productId))
                throw new common_1.BadRequestException('Invalid merchant cart item.');
            const integration = await this.products.activeRecord(tenant, binding.integrationId);
            if (!integration)
                throw new common_1.BadRequestException('Merchant integration is unavailable.');
            const rows = await this.products.searchProducts(tenant, integration.assistantId, { ids: [entry.productId], integrationId: binding.integrationId, limit: 1 });
            const row = rows[0];
            if (!row || entry.name !== row.name || entry.currency !== row.currency ||
                entry.currency !== value.currency || entry.unitPrice !== (row.salePrice ?? row.price)) {
                throw new common_1.BadRequestException('Merchant cart product or price differs from the connected catalogue. Refresh the catalogue before retrying.');
            }
            items.push({ productId: entry.productId, name: String(entry.name), quantity: Number(entry.quantity), unitPrice: Number(entry.unitPrice), currency: String(entry.currency) });
        }
        const count = items.reduce((sum, i) => sum + i.quantity, 0);
        const total = Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) * 100) / 100;
        if (value.itemCount !== count || value.total !== total)
            throw new common_1.BadRequestException('Merchant cart totals failed verification.');
        return { items, itemCount: count, total, currency: value.currency, cartPath: '/cart' };
    }
};
exports.MerchantCartService = MerchantCartService;
exports.MerchantCartService = MerchantCartService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(shared_state_1.SHARED_STATE)),
    __metadata("design:paramtypes", [Object, website_integration_repository_1.WebsiteIntegrationRepository])
], MerchantCartService);
//# sourceMappingURL=merchant-cart.service.js.map
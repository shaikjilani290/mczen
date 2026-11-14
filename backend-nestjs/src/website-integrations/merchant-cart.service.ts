import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { SHARED_STATE, type SharedState } from '../shared-state/shared-state';
import { WebsiteIntegrationRepository } from './website-integration.repository';
import { isUuidv7 } from '../common/ids/uuid';

export interface MerchantBinding { integrationId: string; sessionId: string; origin: string }
export interface MerchantCartItem {
  productId: string; name: string; quantity: number; unitPrice: number; currency: string; variantId?: string;
}
export interface MerchantCartSnapshot {
  items: MerchantCartItem[]; itemCount: number; total: number; currency: string; cartPath: '/cart';
}
type Operation = 'add_to_cart' | 'get_cart' | 'update_cart_item' | 'remove_cart_item' | 'open_cart';
export interface CartAction { id: string; operation: Operation; productId?: string; variantId?: string; quantity?: number; expectedQuantity?: number }
export interface MerchantNavigationAction {
  id: string; type: 'OPEN_CHECKOUT' | 'OPEN_CART'; url: string; merchantOrigin: string;
}
export interface VerifiedCartOperation {
  operation: Operation; productId?: string; productName?: string; quantity?: number;
  cartVerified: true; cartUrl: string; checkoutUrl?: string; navigationAction?: MerchantNavigationAction;
}
export interface ShoppingContext {
  currentProductId?: string;
  previousProductId?: string;
  currentProductName?: string;
  lastIntent?: string;
  lastCartAction?: string;
  pendingClarification?: string;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Coordination only. The guest cart and its durable idempotency ledger belong to the merchant browser. */
@Injectable()
export class MerchantCartService {
  private readonly navigation = this.readNavigation();
  constructor(@Inject(SHARED_STATE) private readonly store: SharedState, private readonly products: WebsiteIntegrationRepository) {}

  private readNavigation(): Record<string, { cartUrl: string; checkoutUrl?: string }> {
    const raw = process.env.MCZEN_MERCHANT_NAVIGATION;
    if (!raw) return {};
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('MCZEN_MERCHANT_NAVIGATION must be a JSON object keyed by integration ID.'); }
    if (!record(value)) throw new Error('MCZEN_MERCHANT_NAVIGATION must be a JSON object keyed by integration ID.');
    const config: Record<string, { cartUrl: string; checkoutUrl?: string }> = {};
    for (const [id, entry] of Object.entries(value)) {
      if (!isUuidv7(id) || !record(entry) || Object.keys(entry).some(key => !['cartUrl', 'checkoutUrl'].includes(key)) ||
          typeof entry.cartUrl !== 'string' || (entry.checkoutUrl !== undefined && typeof entry.checkoutUrl !== 'string')) {
        throw new Error('MCZEN_MERCHANT_NAVIGATION contains invalid merchant URL configuration.');
      }
      config[id] = { cartUrl: entry.cartUrl, ...(typeof entry.checkoutUrl === 'string' ? { checkoutUrl: entry.checkoutUrl } : {}) };
    }
    return config;
  }

  private navigationUrls(binding: MerchantBinding) {
    const config = this.navigation[binding.integrationId];
    const validate = (raw: string) => {
      let url: URL;
      try { url = new URL(raw); } catch { throw new BadRequestException('Invalid configured merchant navigation URL.'); }
      if (url.origin !== binding.origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol) ||
          (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
        throw new BadRequestException('Configured navigation URL is outside the authorised merchant origin.');
      }
      return url.href;
    };
    return {
      cartUrl: validate(config?.cartUrl ?? new URL('/cart', binding.origin).href),
      ...(config?.checkoutUrl ? { checkoutUrl: validate(config.checkoutUrl) } : {}),
    };
  }

  private scope(tenant: string, binding: MerchantBinding) {
    return `merchant-cart:${tenant}:${binding.integrationId}:${binding.sessionId}`;
  }

  async poll(tenant: string, binding: MerchantBinding, body: unknown) {
    if (!record(body) || Object.keys(body).some(k => !['selectedProductId'].includes(k)) ||
        (body.selectedProductId !== undefined && (typeof body.selectedProductId !== 'string' || body.selectedProductId.length > 200))) {
      throw new BadRequestException('Invalid merchant cart polling request.');
    }
    const scope = this.scope(tenant, binding);
    await this.store.put(`${scope}:available`, 'true', 15_000);
    if (body.selectedProductId && body.selectedProductId !== await this.store.get(`${scope}:page`)) {
      await this.store.put(`${scope}:page`, body.selectedProductId as string, 3_600_000);
      await this.updateShoppingContext({ tenantId: tenant, merchant: binding, permissions: [], requestId: 'merchant-page-selection' },
        { currentProductId: body.selectedProductId as string, currentProductName: '' });
    }
    const pending = await this.store.get(`${scope}:pending`);
    return { action: pending ? JSON.parse(pending) as CartAction : null };
  }

  async remember(context: AgentExecutionContext, ids: string[], select = true) {
    if (!context.merchant || !ids.length) return;
    await this.store.put(`${this.scope(context.tenantId, context.merchant)}:choices`, JSON.stringify(ids.slice(0, 5)), 3_600_000);
    if (select) await this.store.put(`${this.scope(context.tenantId, context.merchant)}:selected`, ids[0], 3_600_000);
  }

  async shoppingContext(context: AgentExecutionContext): Promise<ShoppingContext> {
    if (!context.merchant) return {};
    const value = await this.store.get(`${this.scope(context.tenantId, context.merchant)}:context`);
    return value ? JSON.parse(value) as ShoppingContext : {};
  }

  async updateShoppingContext(context: AgentExecutionContext, update: ShoppingContext): Promise<void> {
    if (!context.merchant) return;
    const scope = this.scope(context.tenantId, context.merchant);
    const previous = await this.shoppingContext(context);
    const next = { ...previous, ...update };
    if (update.currentProductId && update.currentProductId !== previous.currentProductId) {
      next.previousProductId = previous.currentProductId;
    }
    await this.store.put(`${scope}:context`, JSON.stringify(next), 3_600_000);
    if (update.currentProductId) await this.store.put(`${scope}:selected`, update.currentProductId, 3_600_000);
  }

  async selected(context: AgentExecutionContext, ordinal?: number, pageReference = false): Promise<string | undefined> {
    if (!context.merchant) return undefined;
    const scope = this.scope(context.tenantId, context.merchant);
    if (ordinal !== undefined) {
      const choices = await this.store.get(`${scope}:choices`);
      return choices ? (JSON.parse(choices) as string[])[ordinal] : undefined;
    }
    return (pageReference ? await this.store.get(`${scope}:page`) : undefined) ??
      await this.store.get(`${scope}:selected`) ?? undefined;
  }

  async rememberProductContext(tenant: string, binding: MerchantBinding, assistantId: string, body: unknown) {
    if (!record(body) || Object.keys(body).some(key => !['externalProductId', 'productUrl', 'name', 'sections'].includes(key)) ||
        typeof body.externalProductId !== 'string' || !body.externalProductId || body.externalProductId.length > 200 ||
        typeof body.productUrl !== 'string' || body.productUrl.length > 1000 ||
        typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 ||
        !Array.isArray(body.sections) || !body.sections.length || body.sections.length > 24 ||
        JSON.stringify(body).length > 48000) {
      throw new BadRequestException('Invalid product page context.');
    }
    const sections = body.sections.map((section: unknown) => {
      if (!record(section) || Object.keys(section).some(key => !['title', 'content'].includes(key)) ||
          typeof section.title !== 'string' || !section.title.trim() || section.title.length > 200 ||
          typeof section.content !== 'string' || !section.content.trim() || section.content.length > 12000 ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(section.content)) {
        throw new BadRequestException('Invalid product page section.');
      }
      return { title: section.title.trim(), content: section.content.trim() };
    });
    let url: URL;
    try { url = new URL(body.productUrl); } catch { throw new BadRequestException('Invalid product page URL.'); }
    if (url.origin !== binding.origin || url.username || url.password || url.search || url.hash) {
      throw new BadRequestException('The product page is outside this merchant session.');
    }
    const rows = await this.products.searchProducts(tenant, assistantId, {
      productUrl: url.href, integrationId: binding.integrationId, limit: 1,
    });
    if (rows.length !== 1 || rows[0].productUrl !== url.href || typeof rows[0].externalProductId !== 'string') {
      throw new BadRequestException('The product page does not match the connected catalogue.');
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
    await this.updateShoppingContext({ tenantId: tenant, merchant: binding, permissions: [], requestId: 'merchant-product-context' },
      { currentProductId: rows[0].externalProductId, currentProductName: String(rows[0].name ?? '') });
    return { accepted: true, sections: sections.length };
  }

  async productContext(context: AgentExecutionContext, productId: string): Promise<unknown> {
    if (!context.merchant) return undefined;
    const value = await this.store.get(`${this.scope(context.tenantId, context.merchant)}:product:${productId}`);
    return value ? JSON.parse(value) as unknown : undefined;
  }

  async complete(tenant: string, binding: MerchantBinding, body: unknown) {
    if (!record(body) || Object.keys(body).some(k => !['id', 'success', 'cart', 'error'].includes(k)) ||
        typeof body.id !== 'string' || !/^[a-f0-9]{64}$/.test(body.id) || typeof body.success !== 'boolean') {
      throw new BadRequestException('Invalid merchant cart acknowledgement.');
    }
    const scope = this.scope(tenant, binding);
    const pending = await this.store.get(`${scope}:pending`);
    if (!pending || (JSON.parse(pending) as CartAction).id !== body.id) {
      throw new BadRequestException('Merchant cart operation expired or does not belong to this session.');
    }
    const action = JSON.parse(pending) as CartAction;
    if (body.success) {
      const integration = await this.products.activeRecord(tenant, binding.integrationId);
      if (!integration || integration.origin !== binding.origin) {
        throw new BadRequestException('Merchant integration changed before cart verification.');
      }
      const cart = await this.validateSnapshot(tenant, binding, body.cart);
      const item = cart.items.find(i => i.productId === action.productId && i.variantId === action.variantId);
      if ((action.operation === 'add_to_cart' && (!item || item.quantity !== action.expectedQuantity)) ||
          (action.operation === 'update_cart_item' && item?.quantity !== action.quantity) ||
          (action.operation === 'remove_cart_item' && (item?.quantity ?? 0) !== action.expectedQuantity)) {
        throw new BadRequestException('The merchant cart read-back does not confirm the requested change.');
      }
      const urls = this.navigationUrls(binding);
      const navigationAction: MerchantNavigationAction | undefined = action.operation === 'add_to_cart'
        ? { id: action.id, type: urls.checkoutUrl ? 'OPEN_CHECKOUT' : 'OPEN_CART', url: urls.checkoutUrl ?? urls.cartUrl, merchantOrigin: binding.origin }
        : ['get_cart', 'open_cart'].includes(action.operation)
          ? { id: action.id, type: 'OPEN_CART', url: urls.cartUrl, merchantOrigin: binding.origin } : undefined;
      await this.store.put(`${scope}:result:${action.id}`, JSON.stringify({
        success: true, cart, operation: action.operation, productId: action.productId,
        productName: item?.name, quantity: action.quantity, cartVerified: true, ...urls,
        ...(navigationAction ? { navigationAction } : {}),
      }), 60_000);
    } else {
      if (typeof body.error !== 'string' || !body.error.trim() || body.error.length > 300) {
        throw new BadRequestException('A bounded merchant error message is required.');
      }
      await this.store.put(`${scope}:result:${action.id}`, JSON.stringify({ success: false, error: body.error }), 60_000);
    }
    return { acknowledged: true };
  }

  async execute(operation: Operation, input: Record<string, unknown>, context: AgentExecutionContext, signal: AbortSignal, deadline = Date.now() + 15_000):
    Promise<{ success: boolean; cart?: MerchantCartSnapshot; error?: string } & Partial<VerifiedCartOperation>> {
    const binding = context.merchant;
    if (context.channel !== 'widget' || !binding) return { success: false, error: 'A verified merchant customer session is required.' };
    const integration = await this.products.activeRecord(context.tenantId, binding.integrationId);
    if (!integration || integration.assistantId !== context.assistantId || integration.origin !== binding.origin) {
      return { success: false, error: 'This merchant session is no longer authorised.' };
    }
    const scope = this.scope(context.tenantId, binding);
    this.navigationUrls(binding);
    if (!await this.store.get(`${scope}:available`)) return { success: false, error: 'The merchant cart adapter is offline. Open the merchant website and try again.' };
    const productId = typeof input.productId === 'string' ? input.productId : undefined;
    const variantId = typeof input.variantId === 'string' ? input.variantId : undefined;
    const quantity = input.quantity;
    const actionId = hash(`${context.requestId}:${operation}:${JSON.stringify({ productId, variantId, quantity })}`);
    const saved = await this.store.get(`${scope}:result:${actionId}`);
    if (saved) return JSON.parse(saved) as { success: boolean; cart?: MerchantCartSnapshot; error?: string } & Partial<VerifiedCartOperation>;
    let expectedQuantity: number | undefined;
    if (['add_to_cart', 'update_cart_item', 'remove_cart_item'].includes(operation)) {
      if (!productId) return { success: false, error: 'Choose a product first.' };
      const rows = await this.products.searchProducts(context.tenantId, context.assistantId!, {
        ids: [productId], integrationId: binding.integrationId, limit: 1,
      });
      if (rows.length !== 1) return { success: false, error: 'The product is unavailable for this merchant.' };
      if (variantId) return { success: false, error: 'This catalogue has no verified variants. Choose the base product; pack estimates are not orderable variants.' };
      if (operation === 'remove_cart_item' && quantity !== undefined &&
          (!Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 99)) {
        return { success: false, error: 'Quantity must be a whole number from 1 to 99.' };
      }
      if (operation !== 'remove_cart_item') {
        if (!Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 99) return { success: false, error: 'Quantity must be a whole number from 1 to 99.' };
        const row = rows[0];
        if (row.availability !== 'in_stock' || typeof row.stock !== 'number' || row.stock < Number(quantity)) {
          return { success: false, error: 'The product is out of stock or its availability cannot be verified.' };
        }
      }
      if (operation === 'add_to_cart' || operation === 'remove_cart_item') {
        const before = await this.execute('get_cart', {}, { ...context, requestId: `${actionId}:before` }, signal, deadline);
        if (!before.success || !before.cart) return { success: false, error: 'The merchant cart could not be read before the change.' };
        const current = before.cart.items.find(item => item.productId === productId)?.quantity ?? 0;
        expectedQuantity = operation === 'add_to_cart' ? current + Number(quantity) :
          quantity === undefined ? 0 : Math.max(0, current - Number(quantity));
        if (operation === 'add_to_cart' && (expectedQuantity > 99 || expectedQuantity > Number(rows[0].stock))) {
          return { success: false, error: 'The requested cart quantity exceeds verified stock or the cart quantity limit.' };
        }
      }
    }
    const action: CartAction = {
      id: actionId,
      operation, ...(productId ? { productId } : {}), ...(variantId ? { variantId } : {}),
      ...(quantity !== undefined ? { quantity: Number(quantity) } : {}),
      ...(expectedQuantity !== undefined ? { expectedQuantity } : {}),
    };
    if (signal.aborted || Date.now() >= deadline) {
      return { success: false, error: 'The merchant cart operation timed out. Check the cart before retrying.' };
    }
    const acquired = await this.store.acquireSlot(scope, action.id, 1, 20_000);
    if (!acquired) return { success: false, error: 'A merchant cart operation is already pending. Check the cart before retrying.' };
    try {
      await this.store.put(`${scope}:pending`, JSON.stringify(action), 18_000);
      while (Date.now() < deadline) {
        if (signal.aborted) break;
        const result = await this.store.get(`${scope}:result:${action.id}`);
        if (result) return JSON.parse(result) as { success: boolean; cart?: MerchantCartSnapshot; error?: string } & Partial<VerifiedCartOperation>;
        await delay(100, undefined, { signal });
      }
      return { success: false, error: 'The merchant cart acknowledgement timed out. The result is uncertain; inspect your cart before requesting another addition.' };
    } finally {
      await this.store.del(`${scope}:pending`);
      await this.store.releaseSlot(scope, action.id);
    }
  }

  private async validateSnapshot(tenant: string, binding: MerchantBinding, value: unknown): Promise<MerchantCartSnapshot> {
    if (!record(value) || !Array.isArray(value.items) || value.items.length > 100 || value.cartPath !== '/cart' ||
        typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) throw new BadRequestException('Invalid merchant cart read-back.');
    const items: MerchantCartItem[] = [];
    for (const entry of value.items) {
      if (!record(entry) || typeof entry.productId !== 'string' || entry.variantId !== undefined ||
          !Number.isInteger(entry.quantity) || Number(entry.quantity) < 1 || Number(entry.quantity) > 99 ||
          items.some(i => i.productId === entry.productId)) throw new BadRequestException('Invalid merchant cart item.');
      const integration = await this.products.activeRecord(tenant, binding.integrationId);
      if (!integration) throw new BadRequestException('Merchant integration is unavailable.');
      const rows = await this.products.searchProducts(tenant, integration.assistantId, { ids: [entry.productId], integrationId: binding.integrationId, limit: 1 });
      const row = rows[0];
      if (!row || entry.name !== row.name || entry.currency !== row.currency ||
          entry.currency !== value.currency || entry.unitPrice !== (row.salePrice ?? row.price)) {
        throw new BadRequestException('Merchant cart product or price differs from the connected catalogue. Refresh the catalogue before retrying.');
      }
      items.push({ productId: entry.productId, name: String(entry.name), quantity: Number(entry.quantity), unitPrice: Number(entry.unitPrice), currency: String(entry.currency) });
    }
    const count = items.reduce((sum, i) => sum + i.quantity, 0);
    const total = Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) * 100) / 100;
    if (value.itemCount !== count || value.total !== total) throw new BadRequestException('Merchant cart totals failed verification.');
    return { items, itemCount: count, total, currency: value.currency, cartPath: '/cart' };
  }
}

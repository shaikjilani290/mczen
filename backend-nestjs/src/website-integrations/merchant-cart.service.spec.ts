import { newUuidv7 } from '../common/ids/uuid';
import { MemorySharedState } from '../shared-state/memory-shared-state';
import { WebsiteIntegrationRepository } from './website-integration.repository';
import { MerchantCartService } from './merchant-cart.service';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';

describe('merchant guest cart coordination (mocked catalogue and merchant read-back)', () => {
  const tenantId = newUuidv7(), assistantId = newUuidv7(), integrationId = newUuidv7();
  const binding = { integrationId, sessionId: 'guest-1', origin: 'https://merchant.example' };
  const context: AgentExecutionContext = { tenantId, assistantId, channel: 'widget', merchant: binding, permissions: ['products:read'], requestId: 'request-1' };
  let cart: MerchantCartService;
  let repository: WebsiteIntegrationRepository;
  const product = { externalProductId: 'tea', name: 'Tea', stock: 10, price: 12, salePrice: null, currency: 'INR', availability: 'in_stock', productUrl: 'https://merchant.example/product/tea' };
  const snapshot = { items: [{ productId: 'tea', name: 'Tea', quantity: 2, unitPrice: 12, currency: 'INR' }], itemCount: 2, total: 24, currency: 'INR', cartPath: '/cart' };

  beforeEach(() => {
    repository = Object.assign(Object.create(WebsiteIntegrationRepository.prototype) as WebsiteIntegrationRepository, {
      activeRecord: jest.fn(async () => ({ id: integrationId, assistantId, origin: binding.origin })),
      searchProducts: jest.fn(async () => [product]),
    });
    cart = new MerchantCartService(new MemorySharedState(), repository);
  });

    it('opens configured checkout only after verified addition, with stable action ID', async () => {
      const previous = process.env.MCZEN_MERCHANT_NAVIGATION;
      process.env.MCZEN_MERCHANT_NAVIGATION = JSON.stringify({
        [integrationId]: { cartUrl: `${binding.origin}/basket`, checkoutUrl: `${binding.origin}/checkout` },
      });
      try {
        cart = new MerchantCartService(new MemorySharedState(), repository);
        await cart.poll(tenantId, binding, {});
        const executing = cart.execute('add_to_cart', { productId: 'tea', quantity: 2 }, context, new AbortController().signal);
        const action = await pending();
        await cart.complete(tenantId, binding, { id: action.id, success: true, cart: snapshot });
        const result = await executing;
        expect(result).toMatchObject({
          success: true, operation: 'add_to_cart', productId: 'tea', productName: 'Tea', quantity: 2,
          cartVerified: true, cartUrl: `${binding.origin}/basket`, checkoutUrl: `${binding.origin}/checkout`,
          navigationAction: { id: action.id, type: 'OPEN_CHECKOUT', url: `${binding.origin}/checkout`, merchantOrigin: binding.origin },
        });
        expect(await cart.execute('add_to_cart', { productId: 'tea', quantity: 2 }, context, new AbortController().signal)).toEqual(result);
      } finally {
        if (previous === undefined) delete process.env.MCZEN_MERCHANT_NAVIGATION;
        else process.env.MCZEN_MERCHANT_NAVIGATION = previous;
      }
    });

    it('rejects an unchanged pre-existing cart line rather than claiming addition', async () => {
      await cart.poll(tenantId, binding, {});
      const controller = new AbortController();
      const executing = cart.execute('add_to_cart', { productId: 'tea', quantity: 1 }, context, controller.signal).catch(() => undefined);
      const action = await pending(snapshot);
      expect(action.expectedQuantity).toBe(3);
      await expect(cart.complete(tenantId, binding, { id: action.id, success: true, cart: snapshot })).rejects.toThrow('requested change');
      controller.abort();
      await executing;
    });

    it('rejects out-of-stock additions before any merchant action', async () => {
      await cart.poll(tenantId, binding, {});
      jest.spyOn(repository, 'searchProducts').mockResolvedValue([{ ...product, stock: 0, availability: 'out_of_stock' }]);
      const result = await cart.execute('add_to_cart', { productId: 'tea', quantity: 1 }, context, new AbortController().signal);
      expect(result).toMatchObject({ success: false });
      expect(result.navigationAction).toBeUndefined();
      expect(await cart.poll(tenantId, binding, {})).toEqual({ action: null });
    });

    it('reads verified cart and returns cart navigation without claiming checkout', async () => {
      await cart.poll(tenantId, binding, {});
      const executing = cart.execute('get_cart', {}, context, new AbortController().signal);
      let action;
      for (let i = 0; i < 50 && !action; i++) {
        action = (await cart.poll(tenantId, binding, {})).action;
        if (!action) await new Promise(resolve => setTimeout(resolve, 5));
      }
      if (!action) throw new Error('Missing cart read');
      await cart.complete(tenantId, binding, { id: action.id, success: true, cart: snapshot });
      await expect(executing).resolves.toMatchObject({ success: true, cartVerified: true,
        navigationAction: { type: 'OPEN_CART', url: `${binding.origin}/cart` } });
    });

    it('verifies quantity updates without navigation', async () => {
      await cart.poll(tenantId, binding, {});
      const executing = cart.execute('update_cart_item', { productId: 'tea', quantity: 2 }, context, new AbortController().signal);
      const action = await pending();
      await cart.complete(tenantId, binding, { id: action.id, success: true, cart: snapshot });
      const result = await executing;
      expect(result.cartVerified).toBe(true);
      expect(result.navigationAction).toBeUndefined();
    });

    it('rejects configured cross-origin checkout and frontend-supplied URLs', async () => {
      const previous = process.env.MCZEN_MERCHANT_NAVIGATION;
      process.env.MCZEN_MERCHANT_NAVIGATION = JSON.stringify({
        [integrationId]: { cartUrl: `${binding.origin}/cart`, checkoutUrl: 'https://untrusted.example/checkout' },
      });
      try {
        cart = new MerchantCartService(new MemorySharedState(), repository);
        await expect(cart.execute('get_cart', {}, context, new AbortController().signal)).rejects.toThrow('authorised merchant origin');
        await expect(cart.complete(tenantId, binding, {
          id: 'a'.repeat(64), success: true, cart: snapshot, checkoutUrl: `${binding.origin}/checkout`,
        })).rejects.toThrow('acknowledgement');
      } finally {
        if (previous === undefined) delete process.env.MCZEN_MERCHANT_NAVIGATION;
        else process.env.MCZEN_MERCHANT_NAVIGATION = previous;
      }
    });
  async function pending(before = { items: [], itemCount: 0, total: 0, currency: 'INR', cartPath: '/cart' } as typeof snapshot) {
    for (let i = 0; i < 100; i++) {
      const result = await cart.poll(tenantId, binding, {});
      if (result.action?.operation === 'get_cart') {
        await cart.complete(tenantId, binding, { id: result.action.id, success: true, cart: before });
      } else if (result.action) return result.action;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Missing pending action');
  }

  it('rejects acknowledgement when the merchant origin changes', async () => {
    await cart.poll(tenantId, binding, {});
    const controller = new AbortController();
    const executing = cart.execute('update_cart_item', { productId: 'tea', quantity: 2 }, context, controller.signal);
    const action = await pending();
    jest.spyOn(repository, 'activeRecord').mockResolvedValue(undefined);
    await expect(cart.complete(tenantId, binding, { id: action.id, success: true, cart: snapshot }))
      .rejects.toThrow('integration changed');
    controller.abort();
    await expect(executing).rejects.toMatchObject({ name: 'AbortError' });
    expect((await cart.poll(tenantId, binding, {})).action).toBeNull();
  });

  it('does not enqueue a mutation after its deadline or cancellation', async () => {
    await cart.poll(tenantId, binding, {});
    const controller = new AbortController();
    controller.abort();
    const result = await cart.execute('update_cart_item', { productId: 'tea', quantity: 2 }, context, controller.signal);
    expect(result.success).toBe(false);
    expect((await cart.poll(tenantId, binding, {})).action).toBeNull();
    const expired = await cart.execute('update_cart_item', { productId: 'tea', quantity: 2 },
      context, new AbortController().signal, Date.now() - 1);
    expect(expired.success).toBe(false);
    expect((await cart.poll(tenantId, binding, {})).action).toBeNull();
  });

  it('waits for validated merchant read-back and prevents repeat additions within a request', async () => {
    await cart.poll(tenantId, binding, {});
    const executing = cart.execute('add_to_cart', { productId: 'tea', quantity: 2 }, context, new AbortController().signal);
    const action = await pending();
    await cart.complete(tenantId, binding, { id: action.id, success: true, cart: snapshot });
    await expect(executing).resolves.toMatchObject({ success: true, cart: snapshot, cartVerified: true,
      navigationAction: { type: 'OPEN_CART', url: `${binding.origin}/cart` } });
    await expect(cart.execute('add_to_cart', { productId: 'tea', quantity: 2 }, context, new AbortController().signal))
      .resolves.toMatchObject({ success: true, cart: snapshot, cartVerified: true });
    expect(await cart.poll(tenantId, binding, {})).toEqual({ action: null });
    expect(repository.searchProducts).toHaveBeenCalledWith(tenantId, assistantId, expect.objectContaining({ integrationId, ids: ['tea'] }));
  });

  it('does not turn a failed merchant write into success', async () => {
    await cart.poll(tenantId, binding, {});
    const executing = cart.execute('add_to_cart', { productId: 'tea', quantity: 1 }, context, new AbortController().signal);
    const action = await pending();
    await cart.complete(tenantId, binding, { id: action.id, success: false, error: 'Merchant storage is full.' });
    await expect(executing).resolves.toEqual({ success: false, error: 'Merchant storage is full.' });
  });

  it('rejects cross-session acknowledgements and forged catalogue totals', async () => {
    await cart.poll(tenantId, binding, {});
    const controller = new AbortController();
    const executing = cart.execute('add_to_cart', { productId: 'tea', quantity: 2 }, context, controller.signal).catch(() => undefined);
    const action = await pending();
    await expect(cart.complete(tenantId, { ...binding, sessionId: 'other' }, { id: action.id, success: true, cart: snapshot })).rejects.toThrow('does not belong');
    await expect(cart.complete(tenantId, binding, { id: action.id, success: true, cart: { ...snapshot, total: 1 } })).rejects.toThrow('totals');
    controller.abort();
    await executing;
  });

  it('rejects invalid quantities, unverified variants, unavailable products and offline adapters', async () => {
    const signal = new AbortController().signal;
    await expect(cart.execute('get_cart', {}, context, signal)).resolves.toMatchObject({ success: false, error: expect.stringContaining('offline') });
    await cart.poll(tenantId, binding, {});
    for (const quantity of [0, -1, 1.5, 100]) {
      await expect(cart.execute('add_to_cart', { productId: 'tea', quantity }, context, signal)).resolves.toMatchObject({ success: false });
    }
    await expect(cart.execute('add_to_cart', { productId: 'tea', quantity: 1, variantId: 'invented' }, context, signal)).resolves.toMatchObject({ success: false, error: expect.stringContaining('variants') });
    jest.spyOn(repository, 'searchProducts').mockResolvedValue([]);
    await expect(cart.execute('add_to_cart', { productId: 'other-shop', quantity: 1 }, context, signal)).resolves.toMatchObject({ success: false, error: expect.stringContaining('unavailable') });
  });

  it('never permits a different tenant assistant or merchant origin', async () => {
    await cart.poll(tenantId, binding, {});
    await expect(cart.execute('get_cart', {}, { ...context, assistantId: newUuidv7() }, new AbortController().signal))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining('authorised') });
  });

  it('resolves remembered first-product and current-product references in the same visitor scope', async () => {
    await cart.remember(context, ['tea', 'coffee']);
    expect(await cart.selected(context, 0)).toBe('tea');
    expect(await cart.selected(context, 1)).toBe('coffee');
    expect(await cart.selected({ ...context, merchant: { ...binding, sessionId: 'other' } })).toBeUndefined();
  });
  it('does not replace a discussed product on every poll of an unchanged page', async () => {
    await cart.poll(tenantId, binding, { selectedProductId: 'tea' });
    await cart.updateShoppingContext(context, { currentProductId: 'coffee', currentProductName: 'Coffee', lastIntent: 'PRODUCT_DETAILS' });
    await cart.poll(tenantId, binding, { selectedProductId: 'tea' });
    expect(await cart.selected(context)).toBe('coffee');
    expect(await cart.selected(context, undefined, true)).toBe('tea');
    await cart.remember(context, ['other', 'another'], false);
    expect(await cart.selected(context)).toBe('coffee');
    expect(await cart.selected(context, 0)).toBe('other');
    await cart.poll(tenantId, binding, { selectedProductId: 'new-page' });
    expect(await cart.selected(context)).toBe('new-page');
    expect(await cart.shoppingContext(context)).toMatchObject({ currentProductId: 'new-page', previousProductId: 'coffee' });
    expect(await cart.shoppingContext({ ...context, merchant: { ...binding, sessionId: 'other' } })).toEqual({});
  });
  it('keeps full rendered sections scoped to the validated product and visitor, without changing catalogue prices', async () => {
    const body = {
      externalProductId: 'tea', name: 'Tea', productUrl: product.productUrl,
      sections: [{ title: 'Ingredients', content: 'Retained tea leaves.' }, { title: 'Usage', content: 'Follow packaging directions.' }],
    };
    await expect(cart.rememberProductContext(tenantId, binding, assistantId, body)).resolves.toEqual({ accepted: true, sections: 2 });
    expect(await cart.selected(context)).toBe('tea');
    expect(await cart.productContext(context, 'tea')).toMatchObject({ sections: body.sections });
    expect(await cart.productContext({ ...context, merchant: { ...binding, sessionId: 'other' } }, 'tea')).toBeUndefined();
    expect(await cart.productContext({ ...context, tenantId: newUuidv7() }, 'tea')).toBeUndefined();
    expect(product.price).toBe(12);
    for (const invalid of [
      { ...body, price: 1 },
      { ...body, productUrl: 'https://other.example/product/tea' },
      { ...body, productUrl: 'https://merchant.example/product/other' },
      { ...body, sections: [{ title: 'Bad', content: 'x'.repeat(12001) }] },
    ]) await expect(cart.rememberProductContext(tenantId, binding, assistantId, invalid)).rejects.toThrow();
  });
  it('acknowledges relative removals without requiring the whole line to disappear', async () => {
    await cart.poll(tenantId, binding, {});
    const executing = cart.execute('remove_cart_item', { productId: 'tea', quantity: 1 }, context, new AbortController().signal);
    const action = await pending({ ...snapshot, items: [{ ...snapshot.items[0], quantity: 3 }], itemCount: 3, total: 36 });
    expect(action).toMatchObject({ operation: 'remove_cart_item', quantity: 1 });
    await cart.complete(tenantId, binding, { id: action.id, success: true, cart: snapshot });
    await expect(executing).resolves.toMatchObject({ success: true, cart: snapshot, cartVerified: true });
    await expect(cart.execute('remove_cart_item', { productId: 'tea', quantity: 0 }, context, new AbortController().signal))
      .resolves.toMatchObject({ success: false });
  });
});

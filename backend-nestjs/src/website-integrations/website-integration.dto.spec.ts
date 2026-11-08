import { BadRequestException } from '@nestjs/common';
import {
  parseCreateWebsiteIntegration,
  parsePageView,
  parseSiteConnect,
  parseWebsiteBatch,
  parseWebsitePage,
  parseWebsiteProduct,
} from './website-integration.dto';

describe('website integration DTOs', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLocal = process.env.MCZEN_ALLOW_LOCAL_INGESTION;
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalLocal === undefined) delete process.env.MCZEN_ALLOW_LOCAL_INGESTION;
    else process.env.MCZEN_ALLOW_LOCAL_INGESTION = originalLocal;
  });
  const origin = 'https://shop.example.com';
  const page = {
    url: `${origin}/faq`, title: 'Help', mainContent: 'Returns are accepted for 30 days.',
    pageType: 'faq', headings: ['Returns'], links: [{ url: `${origin}/returns`, text: 'Policy' }],
  };
  const product = {
    externalProductId: 'item-1', name: 'Tea', productUrl: `${origin}/tea`,
    price: 4.5, availability: 'in_stock', attributes: { size: '20 bags' },
  };

  it('normalizes a domain into its exact origin and rejects secret body fields', () => {
    expect(parseCreateWebsiteIntegration({
      name: 'Shop', domain: 'https://shop.example.com/', assistantId: '01974a11-3270-7da8-a3fc-c6a06fe90df0',
    }).origin).toBe(origin);
    expect(() => parseCreateWebsiteIntegration({
      name: 'Shop', domain: origin, assistantId: '01974a11-3270-7da8-a3fc-c6a06fe90df0', tenantId: 'foreign',
    })).toThrow(BadRequestException);
  });

  it('accepts same-origin page URLs but rejects cross-origin links and unknown fields', () => {
    expect(parseWebsitePage(page, origin).pageType).toBe('faq');
    expect(parseWebsitePage({ ...page, url: `${origin}/faq?email=private#section` }, origin).url).toBe(`${origin}/faq`);
    expect(() => parseWebsitePage({ ...page, links: [{ url: 'http://127.0.0.1/admin', text: 'internal' }] }, origin))
      .toThrow(BadRequestException);
    expect(() => parseWebsitePage({ ...page, tenantId: 'foreign' }, origin)).toThrow(BadRequestException);
  });

  it('validates product prices, stock, links and compact structured attributes', () => {
    expect(parseWebsiteProduct(product, origin).price).toBe(4.5);
    expect(() => parseWebsiteProduct({ ...product, price: -1 }, origin)).toThrow(BadRequestException);
    expect(() => parseWebsiteProduct({ ...product, stock: -1 }, origin)).toThrow(BadRequestException);
    expect(() => parseWebsiteProduct({ ...product, productUrl: 'http://127.0.0.1/private' }, origin))
      .toThrow(BadRequestException);
  });

  it('limits ingestion batches and requires a strongly shaped public site key', () => {
    expect(parseWebsiteBatch({ pages: [page], products: [product] }, origin)).toMatchObject({
      pages: [{ title: 'Help' }], products: [{ name: 'Tea' }],
    });
    expect(() => parseWebsiteBatch({ pages: Array(51).fill(page) }, origin)).toThrow(BadRequestException);
    expect(() => parseSiteConnect({ publicKey: 'wk_old-key' })).toThrow(BadRequestException);
    expect(parseSiteConnect({ publicKey: `mzp_${'A'.repeat(43)}`, assistantId: '01974a11-3270-7da8-a3fc-c6a06fe90df0' }))
      .toHaveProperty('assistantId');
  });

  it('drops query strings and fragments from tracked page URLs and stores only referrer origin', () => {
    expect(parsePageView({
      pageUrl: 'https://shop.example.com/products/item?email=private#details',
      title: 'Item', referrer: 'https://search.example.com/result?q=private',
    })).toEqual({
      pageUrl: 'https://shop.example.com/products/item',
      title: 'Item',
      referrer: 'https://search.example.com',
    });
  });

  it('gates loopback JSON ingestion explicitly and preserves local source page identities only', () => {
    process.env.NODE_ENV = 'development';
    process.env.MCZEN_ALLOW_LOCAL_INGESTION = '1';
    const local = 'http://localhost:5173';
    expect(parseCreateWebsiteIntegration({
      name: 'Local', domain: local, assistantId: '01974a11-3270-7da8-a3fc-c6a06fe90df0',
    }).origin).toBe(local);
    for (const path of ['/products?category=Health', '/#faq']) {
      expect(parseWebsitePage({ ...page, url: local + path, links: [] }, local).url).toBe(local + path);
    }
    expect(parseWebsiteProduct({ ...product, productUrl: `${local}/tea` }, local).productUrl).toBe(`${local}/tea`);
    expect(() => parseWebsiteProduct(product, local)).toThrow(BadRequestException);
    // The local switch does not change public-site canonicalization.
    expect(parseWebsitePage({ ...page, url: `${origin}/faq?private=1#section` }, origin).url).toBe(`${origin}/faq`);
    delete process.env.MCZEN_ALLOW_LOCAL_INGESTION;
    expect(() => parseWebsitePage({ ...page, url: `${local}/faq`, links: [] }, local)).toThrow('MCZEN_ALLOW_LOCAL_INGESTION');
    process.env.NODE_ENV = 'production';
    process.env.MCZEN_ALLOW_LOCAL_INGESTION = '1';
    for (const host of ['localhost', 'localhost.', '127.0.0.1', '[::1]']) {
      const localHttps = `https://${host}:5173`;
      expect(() => parseCreateWebsiteIntegration({
        name: 'Local', domain: localHttps, assistantId: '01974a11-3270-7da8-a3fc-c6a06fe90df0',
      })).toThrow(BadRequestException);
      expect(() => parseWebsiteProduct({ ...product, productUrl: `${localHttps}/tea` }, localHttps))
        .toThrow(BadRequestException);
    }
  });
});

import { WebsiteCrawler } from './website-crawler';

describe('WebsiteCrawler extraction and URL safety', () => {
  it('extracts readable content and same-origin links while excluding active markup', () => {
    const crawler = new WebsiteCrawler() as unknown as {
      safePageUrl(url: string, origin: string): string | undefined;
    };
    const safeUrl = crawler.safePageUrl.bind(crawler);
    expect(safeUrl('https://shop.example.com/products/1?ref=x#details', 'https://shop.example.com'))
      .toBe('https://shop.example.com/products/1');
    expect(safeUrl('http://127.0.0.1/admin', 'https://shop.example.com')).toBeUndefined();
  });

  it('handles robots directives, HTML entities and no-follow scope without fetching the network', async () => {
    const instance = new WebsiteCrawler() as unknown as {
      readRobots(origin: string): Promise<{ rules: Array<{ allow: boolean; path: string }> }>;
      fetchText(url: string, origin: string, types: string): Promise<string>;
    };
    instance.fetchText = async () => 'User-agent: *\nDisallow: /private\nAllow: /private/public';
    const robots = await instance.readRobots('https://shop.example.com');
    expect(robots.rules).toEqual([
      { allow: false, path: '/private' },
      { allow: true, path: '/private/public' },
    ]);
  });

  it('rejects loopback and documentation IP addresses before making an outbound request', async () => {
    const crawler = new WebsiteCrawler() as unknown as {
      resolvePublic(host: string): Promise<unknown>;
    };
    await expect(crawler.resolvePublic('127.0.0.1')).rejects.toThrow('Non-public address rejected');
    await expect(crawler.resolvePublic('::1')).rejects.toThrow('Non-public address rejected');
    await expect(crawler.resolvePublic('2001:db8::1')).rejects.toThrow('Non-public address rejected');
    for (const address of ['10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254', 'fe80::1']) {
      await expect(crawler.resolvePublic(address)).rejects.toThrow('Non-public address rejected');
    }
  });

  it('follows bounded same-origin links and honors robots disallow rules', async () => {
    const crawler = new WebsiteCrawler() as unknown as {
      resolvePublic(host: string): Promise<unknown>;
      readRobots(origin: string): Promise<{ rules: Array<{ allow: boolean; path: string }>; sitemaps: string[] }>;
      fetchText(url: string, origin: string, acceptedTypes: string): Promise<string>;
      crawl(origin: string): Promise<{ pages: Array<{ url: string }>; errors: string[] }>;
    };
    const fetched: string[] = [];
    crawler.resolvePublic = async () => [{ address: '93.184.216.34', family: 4 }];
    crawler.readRobots = async () => ({ rules: [{ allow: false, path: '/private' }], sitemaps: [] });
    crawler.fetchText = async (url) => {
      fetched.push(url);
      if (url.endsWith('/sitemap.xml')) throw new Error('HTTP 404');
      if (url.endsWith('/about')) return '<main><h1>About</h1><p>More about this store.</p></main>';
      return '<main><h1>Shop</h1><p>Welcome to our store.</p><a href="/about?ref=private">About</a><a href="/private">Private</a></main>';
    };
    const result = await crawler.crawl('https://shop.example.com');
    expect(result.pages.map((page) => page.url)).toEqual([
      'https://shop.example.com/', 'https://shop.example.com/about',
    ]);
    expect(fetched.some((url) => url.endsWith('/private'))).toBe(false);
  });

  it('fails closed when robots.txt cannot be retrieved for a reason other than not found', async () => {
    const crawler = new WebsiteCrawler() as unknown as {
      fetchText(url: string, origin: string, acceptedTypes: string): Promise<string>;
      readRobots(origin: string): Promise<unknown>;
    };
    crawler.fetchText = async () => { throw new Error('Request timed out'); };
    await expect(crawler.readRobots('https://shop.example.com')).rejects.toThrow('Request timed out');
  });

  it.each(['development', 'production'])('never enables loopback crawling with the local ingestion flag (%s)', async (mode) => {
    const nodeEnv = process.env.NODE_ENV;
    const flag = process.env.MCZEN_ALLOW_LOCAL_INGESTION;
    process.env.NODE_ENV = mode;
    process.env.MCZEN_ALLOW_LOCAL_INGESTION = '1';
    try {
      await expect(new WebsiteCrawler().crawl('http://127.0.0.1:5173'))
        .rejects.toThrow('Non-public address rejected');
      await expect(new WebsiteCrawler().crawl('http://169.254.169.254'))
        .rejects.toThrow('Non-public address rejected');
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      if (flag === undefined) delete process.env.MCZEN_ALLOW_LOCAL_INGESTION;
      else process.env.MCZEN_ALLOW_LOCAL_INGESTION = flag;
    }
  });
});

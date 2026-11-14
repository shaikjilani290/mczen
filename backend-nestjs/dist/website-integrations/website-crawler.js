"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteCrawler = void 0;
const promises_1 = require("node:dns/promises");
const node_net_1 = require("node:net");
const node_http_1 = require("node:http");
const node_https_1 = require("node:https");
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 7000;
const CRAWLER_AGENT = 'McZENBot/1.0 (+https://mczen.in/bot)';
class WebsiteCrawler {
    async fetchStorefrontCatalog(origin) {
        const url = new URL('/data/storefront.json', origin).toString();
        try {
            const body = await this.fetchText(url, origin, 'application/json');
            const catalog = JSON.parse(body);
            if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
                throw new Error('Invalid storefront catalogue');
            }
            const data = catalog;
            if (!Array.isArray(data.products) ||
                !data.details ||
                typeof data.details !== 'object' ||
                !data.assets ||
                typeof data.assets !== 'object') {
                throw new Error('Storefront catalogue has an unexpected structure');
            }
            return catalog;
        }
        catch (error) {
            if (error instanceof Error && /^HTTP (?:404|410)$/.test(error.message)) {
                return null;
            }
            throw error;
        }
    }
    async crawl(origin, onDiscovered) {
        const root = new URL(origin);
        await this.resolvePublic(root.hostname);
        const robots = await this.readRobots(origin);
        const sitemaps = [...robots.sitemaps, new URL('/sitemap.xml', origin).toString()];
        const candidates = new Set([new URL('/', origin).toString()]);
        for (const sitemap of sitemaps) {
            try {
                const xml = await this.fetchText(new URL(sitemap, origin).toString(), origin, 'application/xml,text/xml,text/plain');
                for (const match of xml.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi)) {
                    const value = decodeEntities(match[1].trim());
                    const pageUrl = this.safePageUrl(value, origin);
                    if (pageUrl)
                        candidates.add(pageUrl);
                    if (candidates.size >= MAX_PAGES)
                        break;
                }
            }
            catch {
            }
            if (candidates.size >= MAX_PAGES)
                break;
        }
        const pages = [];
        const errors = [];
        for (const pageUrl of candidates) {
            if (pages.length >= MAX_PAGES)
                break;
            const path = new URL(pageUrl).pathname;
            if (isDisallowed(path, robots.rules))
                continue;
            try {
                const html = await this.fetchText(pageUrl, origin, 'text/html');
                const page = extractPage(html, pageUrl, origin);
                if (page.mainContent.length < 20)
                    continue;
                pages.push(page);
                await onDiscovered?.(pages.length);
                for (const link of page.links) {
                    if (candidates.size >= MAX_PAGES)
                        break;
                    candidates.add(link.url);
                }
            }
            catch {
                errors.push(`${new URL(pageUrl).pathname}: page could not be fetched`);
                if (errors.length >= 50)
                    break;
            }
        }
        return { pages, errors };
    }
    async readRobots(origin) {
        try {
            const text = await this.fetchText(new URL('/robots.txt', origin).toString(), origin, 'text/plain');
            let applies = false;
            const rules = [];
            const sitemaps = [];
            for (const line of text.split(/\r?\n/)) {
                const [rawName, ...rest] = line.split(':');
                if (!rawName)
                    continue;
                const name = rawName.trim().toLowerCase();
                const value = rest.join(':').trim();
                if (!name || name.startsWith('#'))
                    continue;
                if (name === 'user-agent') {
                    applies = value === '*' || /mczenbot/i.test(value);
                }
                else if (name === 'sitemap' && value) {
                    const sitemap = this.safePageUrl(value, origin);
                    if (sitemap)
                        sitemaps.push(sitemap);
                }
                else if (applies && (name === 'allow' || name === 'disallow') && value) {
                    rules.push({ allow: name === 'allow', path: value });
                }
            }
            return { rules, sitemaps: sitemaps.slice(0, 10) };
        }
        catch (error) {
            if (error instanceof Error && /^HTTP (?:404|410)$/.test(error.message))
                return { rules: [], sitemaps: [] };
            throw error;
        }
    }
    safePageUrl(value, origin) {
        try {
            const url = new URL(value, origin);
            if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password)
                return undefined;
            if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|mp4|mp3|woff2?)$/i.test(url.pathname))
                return undefined;
            url.search = '';
            url.hash = '';
            return url.toString();
        }
        catch {
            return undefined;
        }
    }
    async fetchText(urlValue, origin, acceptedTypes) {
        let url = new URL(urlValue);
        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
            if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
                throw new Error('URL outside origin');
            const addresses = await this.resolvePublic(url.hostname);
            const result = await this.requestOnce(url, addresses);
            if (result.status >= 300 && result.status < 400 && result.location) {
                if (redirects === MAX_REDIRECTS)
                    throw new Error('Redirect limit exceeded');
                url = new URL(result.location, url);
                continue;
            }
            if (result.status < 200 || result.status >= 300)
                throw new Error(`HTTP ${result.status}`);
            const contentType = result.contentType.split(';', 1)[0].trim().toLowerCase();
            if (!acceptedTypes.split(',').includes(contentType))
                throw new Error('Unexpected content type');
            return result.body;
        }
        throw new Error('Redirect limit exceeded');
    }
    async resolvePublic(hostname) {
        const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
            throw new Error('Private host rejected');
        }
        const ipVersion = (0, node_net_1.isIP)(normalized);
        const addresses = ipVersion
            ? [{ address: normalized, family: ipVersion }]
            : await (0, promises_1.lookup)(normalized, { all: true, verbatim: true });
        if (addresses.length === 0 || addresses.some(({ address, family }) => !isPublicAddress(address, family))) {
            throw new Error('Non-public address rejected');
        }
        return addresses;
    }
    requestOnce(url, addresses) {
        return new Promise((resolve, reject) => {
            const transport = url.protocol === 'https:' ? node_https_1.request : node_http_1.request;
            let finished = false;
            const req = transport(url, {
                method: 'GET',
                headers: {
                    'User-Agent': CRAWLER_AGENT,
                    Accept: 'text/html,application/xml,text/xml,text/plain,application/json',
                    'Accept-Encoding': 'identity',
                },
                lookup: (_hostname, options, callback) => {
                    if (options && typeof options === 'object' && 'all' in options && options.all) {
                        callback(null, addresses);
                    }
                    else {
                        callback(null, addresses[0].address, addresses[0].family);
                    }
                },
                timeout: REQUEST_TIMEOUT_MS,
            }, (response) => {
                const chunks = [];
                let bytes = 0;
                response.on('data', (chunk) => {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    bytes += buffer.length;
                    if (bytes > MAX_RESPONSE_BYTES) {
                        req.destroy(new Error('Response too large'));
                        return;
                    }
                    chunks.push(buffer);
                });
                response.on('error', fail);
                response.on('end', () => {
                    if (finished)
                        return;
                    finished = true;
                    resolve({
                        status: response.statusCode ?? 0,
                        location: response.headers.location,
                        contentType: String(response.headers['content-type'] ?? ''),
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            });
            function fail(error) {
                if (finished)
                    return;
                finished = true;
                reject(error);
            }
            req.on('timeout', () => req.destroy(new Error('Request timed out')));
            req.on('error', fail);
            req.end();
        });
    }
}
exports.WebsiteCrawler = WebsiteCrawler;
function isPublicAddress(address, family) {
    if (family === 4) {
        const octets = address.split('.').map(Number);
        if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
            return false;
        const [a, b, c] = octets;
        return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 192 && b === 0 && c === 0) ||
            (a === 192 && b === 0 && c === 2) ||
            (a === 198 && (b === 18 || b === 19)) ||
            (a === 198 && b === 51 && c === 100) ||
            (a === 203 && b === 0 && c === 113) ||
            (a === 255));
    }
    if (family !== 6)
        return false;
    const value = address.toLowerCase();
    if (value.startsWith('::ffff:'))
        return isPublicAddress(value.slice(7), 4);
    const segments = expandIpv6(value);
    if (!segments)
        return false;
    const first = segments[0];
    const second = segments[1];
    return first >= 0x2000 && first <= 0x3fff &&
        !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8));
}
function expandIpv6(value) {
    const halves = value.split('::');
    if (halves.length > 2)
        return undefined;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/i.test(part)))
        return undefined;
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
        return undefined;
    const parts = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
    return parts.length === 8 ? parts.map((part) => Number.parseInt(part, 16)) : undefined;
}
function isDisallowed(path, rules) {
    const matching = rules
        .filter((rule) => path.startsWith(rule.path.replace(/\*.*$/, '')))
        .sort((a, b) => b.path.length - a.path.length);
    return matching[0]?.allow === false;
}
function decodeEntities(value) {
    return value
        .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, number) => String.fromCodePoint(Number.parseInt(number, 16)));
}
function cleanText(value) {
    return decodeEntities(value.replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ').trim().slice(0, 200_000);
}
function extractAttribute(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : null;
}
function extractPage(html, pageUrl, origin) {
    const title = cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(pageUrl).pathname) || 'Website page';
    const meta = html.match(/<meta\b[^>]*>/gi)?.find((tag) => (extractAttribute(tag, 'name') ?? '').toLowerCase() === 'description');
    const metaDescription = meta ? extractAttribute(meta, 'content')?.slice(0, 1000) ?? null : null;
    const updatedMeta = html.match(/<meta\b[^>]*>/gi)?.find((tag) => ['article:modified_time', 'og:updated_time'].includes((extractAttribute(tag, 'property') ?? '').toLowerCase()));
    const updatedValue = updatedMeta ? extractAttribute(updatedMeta, 'content') :
        html.match(/<time\b[^>]*>/i)?.[0] ? extractAttribute(html.match(/<time\b[^>]*>/i)?.[0] ?? '', 'datetime') : null;
    const lastUpdatedAt = updatedValue && Number.isFinite(Date.parse(updatedValue)) ? new Date(updatedValue) : null;
    const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
        .map((match) => cleanText(match[1])).filter(Boolean).slice(0, 100);
    const links = [];
    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const href = extractAttribute(match[1], 'href');
        if (!href || links.length >= 100)
            continue;
        try {
            const url = new URL(href, pageUrl);
            if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
                continue;
            if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|mp4|mp3|woff2?)$/i.test(url.pathname))
                continue;
            url.search = '';
            url.hash = '';
            if (!links.some((item) => item.url === url.toString())) {
                links.push({ url: url.toString(), text: cleanText(match[2]).slice(0, 300) });
            }
        }
        catch { }
    }
    const body = html
        .replace(/<(script|style|noscript|svg|header|footer|nav|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
        html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
    const mainContent = cleanText(body);
    const path = new URL(pageUrl).pathname.toLowerCase();
    const pageHints = `${path} ${title} ${headings.join(' ')}`.toLowerCase();
    const pageType = /faq|frequently[- ]asked|common questions/.test(pageHints) ? 'faq'
        : /product/.test(pageHints) ? 'product'
            : /service/.test(pageHints) ? 'service'
                : /policy|privacy|terms|return|refund|shipping|delivery|warranty/.test(pageHints) ? 'policy'
                    : /category|categories|collection/.test(pageHints) ? 'category' : 'page';
    return { url: pageUrl, title: title.slice(0, 200), metaDescription, mainContent, headings, links, pageType, lastUpdatedAt };
}
//# sourceMappingURL=website-crawler.js.map
/**
 * Live website-integration verification (non-destructive).
 *
 *   npm run verify:live-integration -- --origin http://localhost:5173
 *   npm run verify:live-integration -- --integration-id <uuidv7> --api --ask
 *
 * Phases
 *   db      (always)   Migration ledger, tables, indexes, FKs, merchant counts, tenant
 *                      ownership, and product/page search through the real repository SQL.
 *                      Runs in a MySQL `START TRANSACTION READ ONLY` session that is rolled
 *                      back; a SELECT-only guard also rejects any other statement.
 *   api     (--api)    Public connect endpoint: invalid key and wrong origin must be rejected,
 *                      the real key + exact origin must issue a session. No database writes.
 *   ask     (--ask)    Sends assistant questions through the public widget endpoint and checks
 *                      answers/product cards against database records. NOTE: this creates NEW
 *                      widget conversation/message rows (append-only, as any visitor would);
 *                      it never modifies or deletes existing records.
 *
 * Options (flags override env):
 *   --integration-id / MCZEN_VERIFY_INTEGRATION_ID   --origin / MCZEN_VERIFY_ORIGIN
 *   --expect-products (16) --expect-pages (25) --max-price (2000) --currency (INR)
 *   --policy-query ("return policy") --api-base-url / MCZEN_API_BASE_URL (http://127.0.0.1:3000)
 *   --report <file.json>
 *
 * Uses the runtime DB account (DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME/DB_USER, DB_PASSWORD).
 * Secrets (DB password, public/ingestion keys, session tokens) are never printed.
 * Exit: 0 all checks passed, 1 a check failed, 2 configuration/connection error.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { DataSource, type QueryRunner } from 'typeorm';
import { binaryToUuid, isUuidv7, newUuidv7, uuidToBinary } from '../src/common/ids/uuid';
import { MysqlConfig, loadOptionalDotEnv } from '../src/database/mysql-config';
import { ALL_MIGRATIONS } from '../src/database/migrations';
import { WebsiteIntegrationRepository } from '../src/website-integrations/website-integration.repository';

type Row = Record<string, unknown>;
type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
interface Check { phase: string; name: string; status: Status; detail: string }

const MIGRATION = 'WebsiteIntegrations1740000000013';
const EXPECTED_SCHEMA: Record<string, { indexes: string[]; fks: string[] }> = {
  website_integrations: {
    indexes: ['PRIMARY', 'uk_website_integrations_id_tenant', 'uk_website_integrations_tenant_origin',
      'uk_website_integrations_public_key', 'uk_website_integrations_ingestion_hash',
      'ix_website_integrations_tenant_status', 'ix_website_integrations_assistant'],
    fks: ['fk_website_integrations_tenants', 'fk_website_integrations_assistants', 'fk_website_integrations_users'],
  },
  website_pages: {
    indexes: ['PRIMARY', 'uk_website_pages_id_tenant', 'uk_website_pages_integration_url',
      'ix_website_pages_tenant_status', 'ix_website_pages_tenant_type', 'ix_website_pages_article'],
    fks: ['fk_website_pages_integrations', 'fk_website_pages_articles'],
  },
  website_products: {
    indexes: ['PRIMARY', 'uk_website_products_id_tenant', 'uk_website_products_external',
      'ix_website_products_tenant_status', 'ix_website_products_sku', 'ft_website_products_search'],
    fks: ['fk_website_products_integrations'],
  },
  website_page_views: {
    indexes: ['PRIMARY', 'ix_website_page_views_integration_created', 'ix_website_page_views_dedupe'],
    fks: ['fk_website_page_views_integrations'],
  },
};

const checks: Check[] = [];
function record(phase: string, name: string, status: Status, detail = ''): void {
  checks.push({ phase, name, status, detail });
  console.log(`[${phase}] ${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
}
const expectTrue = (phase: string, name: string, ok: boolean, detail = '') =>
  record(phase, name, ok ? 'PASS' : 'FAIL', detail);

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'api' || key === 'ask') { flags.add(key); continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    values.set(key, value);
    i++;
  }
  const allowed = ['integration-id', 'origin', 'expect-products', 'expect-pages', 'max-price', 'currency',
    'policy-query', 'api-base-url', 'report'];
  for (const key of values.keys()) if (!allowed.includes(key)) throw new Error(`Unknown option --${key}`);
  const num = (key: string, fallback: number) => {
    const value = Number(values.get(key) ?? fallback);
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number.`);
    return value;
  };
  const integrationId = values.get('integration-id') ?? process.env.MCZEN_VERIFY_INTEGRATION_ID;
  const origin = values.get('origin') ?? process.env.MCZEN_VERIFY_ORIGIN;
  if (!integrationId && !origin) throw new Error('Provide --integration-id or --origin (or MCZEN_VERIFY_INTEGRATION_ID / MCZEN_VERIFY_ORIGIN).');
  if (integrationId && !isUuidv7(integrationId)) throw new Error('--integration-id must be a UUIDv7.');
  const currency = (values.get('currency') ?? 'INR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('--currency must be a 3-letter ISO code.');
  const ask = flags.has('ask');
  return {
    integrationId, origin, ask, api: ask || flags.has('api'), currency,
    expectProducts: num('expect-products', 16), expectPages: num('expect-pages', 25),
    maxPrice: num('max-price', 2000),
    policyQuery: values.get('policy-query') ?? 'return policy',
    apiBaseUrl: (values.get('api-base-url') ?? process.env.MCZEN_API_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    report: values.get('report'),
  };
}
type Options = ReturnType<typeof parseArgs>;

/** Only read statements may reach MySQL; the session is also READ ONLY at the server. */
function readOnly(runner: QueryRunner) {
  return {
    query: (sql: string, params?: unknown[]): Promise<Row[]> => {
      if (!/^\s*(SELECT|SHOW|WITH)\b/i.test(sql) || /\bFOR\s+UPDATE\b/i.test(sql)) {
        return Promise.reject(new Error('Refused non-read statement in verification session.'));
      }
      return runner.query(sql, params) as Promise<Row[]>;
    },
  };
}

interface Integration {
  id: string; tenantId: string; assistantId: string; name: string; origin: string; publicKey: string;
  status: string; syncStatus: string; lastSyncAt: unknown; productsImported: number; knowledgeIndexed: number;
  syncErrors: number;
}
interface DbProduct {
  externalProductId: string; name: string; price: number | null; salePrice: number | null;
  currency: string | null; productUrl: string;
}
interface DbResult { integration?: Integration; products: DbProduct[] }

async function verifyDatabase(db: ReturnType<typeof readOnly>, options: Options): Promise<DbResult> {
  const P = 'db';
  const [identity] = await db.query('SELECT VERSION() AS version, DATABASE() AS name, CURRENT_USER() AS account');
  record(P, 'Connected', 'PASS', `MySQL ${String(identity.version)}, database ${String(identity.name)}, account ${String(identity.account)}`);

  // Migration ledger
  const registered = ALL_MIGRATIONS.map((m) => { const i = new m(); return i.name ?? i.constructor.name; });
  let executed: string[] = [];
  try {
    executed = (await db.query('SELECT `name` FROM `migrations` ORDER BY `id`')).map((r) => String(r.name));
  } catch {
    record(P, 'Migration ledger readable', 'FAIL', 'migrations table missing or not readable');
  }
  const pending = registered.filter((n) => !executed.includes(n));
  const unknown = executed.filter((n) => !registered.includes(n));
  expectTrue(P, `Migration ${MIGRATION} recorded`, executed.includes(MIGRATION));
  expectTrue(P, 'No pending migrations', pending.length === 0, pending.join(', ') || `${executed.length} applied`);
  expectTrue(P, 'No unknown ledger rows', unknown.length === 0, unknown.join(', '));

  // Tables, indexes, foreign keys
  const tables = Object.keys(EXPECTED_SCHEMA);
  const marks = tables.map(() => '?').join(',');
  const present = new Set((await db.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${marks})`,
    tables)).map((r) => String(r.t)));
  const indexRows = await db.query(
    `SELECT DISTINCT TABLE_NAME AS t, INDEX_NAME AS i FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${marks})`, tables);
  const fkRows = await db.query(
    `SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS c FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN (${marks})`, tables);
  for (const table of tables) {
    expectTrue(P, `Table ${table} exists`, present.has(table));
    if (!present.has(table)) continue;
    const idx = new Set(indexRows.filter((r) => r.t === table).map((r) => String(r.i)));
    const fks = new Set(fkRows.filter((r) => r.t === table).map((r) => String(r.c)));
    const missingIdx = EXPECTED_SCHEMA[table].indexes.filter((n) => !idx.has(n));
    const missingFk = EXPECTED_SCHEMA[table].fks.filter((n) => !fks.has(n));
    expectTrue(P, `${table} indexes`, missingIdx.length === 0, missingIdx.length ? `missing ${missingIdx.join(', ')}` : `${idx.size} present`);
    expectTrue(P, `${table} foreign keys`, missingFk.length === 0, missingFk.length ? `missing ${missingFk.join(', ')}` : `${fks.size} present`);
  }
  if (tables.some((t) => !present.has(t))) {
    record(P, 'Merchant data checks', 'SKIP', 'integration tables are not present; apply migration 0013 first');
    return { products: [] };
  }

  // Locate the integration (public key is selected for the API phase but never printed)
  const where = options.integrationId ? 'i.`id`=?' : 'i.`origin`=?';
  const key = options.integrationId ? uuidToBinary(options.integrationId) : options.origin;
  const found = await db.query(
    `SELECT i.\`id\`,i.\`tenant_id\`,i.\`assistant_id\`,i.\`name\`,i.\`origin\`,i.\`public_key\`,i.\`status\`,
      i.\`sync_status\`,i.\`last_sync_at\`,i.\`products_imported\`,i.\`knowledge_indexed\`,
      COALESCE(JSON_LENGTH(i.\`sync_errors\`),0) AS sync_errors
     FROM \`website_integrations\` i WHERE ${where}`, [key]);
  if (found.length !== 1) {
    record(P, 'Integration located', 'FAIL', found.length === 0 ? 'no matching integration'
      : `${found.length} integrations share this origin across tenants; pass --integration-id`);
    const registered = await db.query(
      'SELECT `id`,`name`,`origin`,`status` FROM `website_integrations` ORDER BY `created_at` DESC LIMIT 20');
    for (const row of registered) {
      console.log(`        registered: ${binaryToUuid(row.id as Uint8Array)} ${String(row.name)} ${String(row.origin)} (${String(row.status)})`);
    }
    if (registered.length === 0) console.log('        no website integrations are registered yet');
    return { products: [] };
  }
  const r = found[0];
  const integration: Integration = {
    id: binaryToUuid(r.id as Uint8Array), tenantId: binaryToUuid(r.tenant_id as Uint8Array),
    assistantId: binaryToUuid(r.assistant_id as Uint8Array), name: String(r.name), origin: String(r.origin),
    publicKey: String(r.public_key), status: String(r.status), syncStatus: String(r.sync_status),
    lastSyncAt: r.last_sync_at, productsImported: Number(r.products_imported),
    knowledgeIndexed: Number(r.knowledge_indexed), syncErrors: Number(r.sync_errors),
  };
  record(P, 'Integration located', 'PASS',
    `${integration.name} (${integration.origin}) id ${integration.id}, tenant ${integration.tenantId}, assistant ${integration.assistantId}`);
  expectTrue(P, 'Integration active', integration.status === 'active', integration.status);
  const [owner] = await db.query(
    `SELECT t.\`status\` AS tenant_status, t.\`deleted_at\` AS tenant_deleted, a.\`status\` AS assistant_status,
      a.\`deleted_at\` AS assistant_deleted
     FROM \`tenants\` t JOIN \`assistants\` a ON a.\`tenant_id\`=t.\`id\` AND a.\`id\`=? WHERE t.\`id\`=?`,
    [uuidToBinary(integration.assistantId), uuidToBinary(integration.tenantId)]);
  expectTrue(P, 'Tenant and assistant active and owned by tenant', Boolean(owner) &&
    owner.tenant_status === 'active' && !owner.tenant_deleted && owner.assistant_status === 'active' && !owner.assistant_deleted,
    owner ? `tenant ${String(owner.tenant_status)}, assistant ${String(owner.assistant_status)}` : 'assistant not owned by tenant');
  record(P, 'Last sync', integration.lastSyncAt && integration.syncStatus !== 'failed' && integration.syncErrors === 0 ? 'PASS' : 'WARN',
    `status ${integration.syncStatus}, last ${integration.lastSyncAt ? new Date(integration.lastSyncAt as string).toISOString() : 'never'}, ${integration.syncErrors} recorded error(s)`);

  // Counts and integrity
  const ids = [uuidToBinary(integration.id), uuidToBinary(integration.tenantId)];
  const [counts] = await db.query(
    `SELECT
      (SELECT COUNT(*) FROM \`website_products\` WHERE \`integration_id\`=? AND \`tenant_id\`=? AND \`status\`='active') AS products,
      (SELECT COUNT(*) FROM \`website_products\` WHERE \`integration_id\`=? AND \`tenant_id\`=? AND \`status\`<>'active') AS inactive_products,
      (SELECT COUNT(*) FROM \`website_pages\` WHERE \`integration_id\`=? AND \`tenant_id\`=? AND \`status\`='active') AS pages,
      (SELECT COUNT(*) FROM \`website_pages\` WHERE \`integration_id\`=? AND \`tenant_id\`=? AND \`status\`<>'active') AS inactive_pages,
      (SELECT COUNT(*) FROM \`website_products\` WHERE \`integration_id\`=? AND \`tenant_id\`<>?) AS foreign_products,
      (SELECT COUNT(*) FROM \`website_pages\` WHERE \`integration_id\`=? AND \`tenant_id\`<>?) AS foreign_pages`,
    [...ids, ...ids, ...ids, ...ids, ...ids, ...ids]);
  const n = (v: unknown) => Number(v);
  expectTrue(P, 'Active product count', n(counts.products) === options.expectProducts,
    `${n(counts.products)} (expected ${options.expectProducts}); ${n(counts.inactive_products)} inactive`);
  expectTrue(P, 'Active page count', n(counts.pages) === options.expectPages,
    `${n(counts.pages)} (expected ${options.expectPages}); ${n(counts.inactive_pages)} inactive`);
  expectTrue(P, 'Tenant ownership of products/pages', n(counts.foreign_products) === 0 && n(counts.foreign_pages) === 0,
    `${n(counts.foreign_products)} foreign products, ${n(counts.foreign_pages)} foreign pages`);
  expectTrue(P, 'Integration counters match records',
    integration.productsImported === n(counts.products) && integration.knowledgeIndexed === n(counts.pages),
    `products_imported ${integration.productsImported}, knowledge_indexed ${integration.knowledgeIndexed}`);

  const [dupes] = await db.query(
    `SELECT
      (SELECT COUNT(*) FROM (SELECT LOWER(\`name\`) n FROM \`website_products\` WHERE \`integration_id\`=? AND \`tenant_id\`=? AND \`status\`='active'
        GROUP BY LOWER(\`name\`),\`sku\` HAVING COUNT(*)>1) d) AS dup_products,
      (SELECT COUNT(*) FROM (SELECT \`canonical_url\` FROM \`website_pages\` WHERE \`integration_id\`=? AND \`tenant_id\`=?
        GROUP BY \`canonical_url\` HAVING COUNT(*)>1) d) AS dup_pages`, [...ids, ...ids]);
  expectTrue(P, 'No duplicate products (name+SKU) or page URLs', n(dupes.dup_products) === 0 && n(dupes.dup_pages) === 0,
    `${n(dupes.dup_products)} duplicate product groups, ${n(dupes.dup_pages)} duplicate URLs`);

  const [knowledge] = await db.query(
    `SELECT COUNT(DISTINCT p.\`id\`) AS indexed_pages, COUNT(c.\`id\`) AS chunks
     FROM \`website_pages\` p
     JOIN \`knowledge_articles\` a ON a.\`id\`=p.\`article_id\` AND a.\`tenant_id\`=p.\`tenant_id\`
     JOIN \`knowledge_chunks\` c ON c.\`article_id\`=a.\`id\` AND c.\`tenant_id\`=a.\`tenant_id\`
     WHERE p.\`integration_id\`=? AND p.\`tenant_id\`=? AND p.\`status\`='active'`, ids);
  expectTrue(P, 'Active pages indexed into knowledge base', n(knowledge.indexed_pages) === n(counts.pages),
    `${n(knowledge.indexed_pages)}/${n(counts.pages)} pages with ${n(knowledge.chunks)} chunks`);

  const productRows = await db.query(
    `SELECT \`external_product_id\` AS id,\`name\`,\`price\`,\`sale_price\`,\`currency\`,\`product_url\`
     FROM \`website_products\` WHERE \`integration_id\`=? AND \`tenant_id\`=? AND \`status\`='active' ORDER BY \`name\``, ids);
  const products: DbProduct[] = productRows.map((p) => ({
    externalProductId: String(p.id), name: String(p.name),
    price: p.price === null ? null : Number(p.price), salePrice: p.sale_price === null ? null : Number(p.sale_price),
    currency: typeof p.currency === 'string' ? p.currency : null, productUrl: String(p.product_url),
  }));
  const unpriced = products.filter((p) => p.price === null && p.salePrice === null).length;
  const noCurrency = products.filter((p) => (p.price !== null || p.salePrice !== null) && !p.currency).length;
  record(P, 'Product price data', unpriced === 0 && noCurrency === 0 ? 'PASS' : 'WARN',
    `${unpriced} without price, ${noCurrency} priced without currency`);

  // Product and page search through the production repository SQL
  const S = 'search';
  const repo = new WebsiteIntegrationRepository(db as unknown as DataSource);
  const { tenantId, assistantId } = integration;
  const all = await repo.searchProducts(tenantId, assistantId, { limit: 100, integrationId: integration.id });
  expectTrue(S, 'search_products lists active catalog', all.length === Math.min(products.length, 100), `${all.length} results`);

  if (products[0]) {
    const target = products[0];
    const byName = await repo.searchProducts(tenantId, assistantId, { query: target.name, limit: 10, integrationId: integration.id });
    expectTrue(S, `Text search finds "${target.name}"`, byName.some((p) => p.externalProductId === target.externalProductId), `${byName.length} results`);
  }

  const effective = (p: { price: number | null; salePrice: number | null }) => p.salePrice ?? p.price;
  const expectedBudget = products.filter((p) => p.currency === options.currency &&
    effective(p) !== null && (effective(p) as number) <= options.maxPrice);
  const budget = await repo.searchProducts(tenantId, assistantId, {
    maxPrice: options.maxPrice, currency: options.currency, limit: 100, integrationId: integration.id,
  });
  const overBudget = budget.filter((p) => p.currency !== options.currency ||
    (effective(p as never) ?? Infinity) > options.maxPrice);
  expectTrue(S, `Budget search (<= ${options.maxPrice} ${options.currency})`,
    overBudget.length === 0 && budget.length === expectedBudget.length,
    `${budget.length} results, expected ${expectedBudget.length}, ${overBudget.length} violating`);

  const otherTenant = await repo.searchProducts(newUuidv7(), assistantId, { limit: 100 });
  const otherAssistant = await repo.searchProducts(tenantId, newUuidv7(), { limit: 100 });
  expectTrue(S, 'Tenant/assistant isolation in product search', otherTenant.length === 0 && otherAssistant.length === 0,
    `other tenant ${otherTenant.length}, other assistant ${otherAssistant.length}`);

  const pagesFound = await repo.searchPages(tenantId, assistantId, options.policyQuery, null, 5);
  record(S, `search_website_content "${options.policyQuery}"`, pagesFound.length > 0 ? 'PASS' : 'WARN',
    pagesFound.length ? pagesFound.map((p) => String(p.url)).join(', ') : 'no matching indexed page');
  const pagesOther = await repo.searchPages(newUuidv7(), assistantId, options.policyQuery, null, 5);
  expectTrue(S, 'Tenant isolation in page search', pagesOther.length === 0, `${pagesOther.length} results`);

  return { integration, products };
}

function call(base: string, path: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; json: Row }> {
  const url = new URL(path, `${base}/`);
  const payload = JSON.stringify(body);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(url, {
      method: 'POST', timeout: 180_000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
    }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => {
        let json: Row = {};
        try { json = JSON.parse(Buffer.concat(parts).toString('utf8')) as Row; } catch { /* non-JSON error body */ }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out.')));
    req.on('error', reject);
    req.end(payload);
  });
}

async function connect(options: Options, integration: Integration, origin = integration.origin, publicKey = integration.publicKey) {
  return call(options.apiBaseUrl, '/api/website-integrations/connect',
    { publicKey, assistantId: integration.assistantId }, { origin });
}

async function verifyApi(options: Options, integration: Integration): Promise<void> {
  const P = 'api';
  const fakeKey = `mzp_${randomBytes(32).toString('base64url').slice(0, 43)}`;
  const invalid = await connect(options, integration, integration.origin, fakeKey);
  expectTrue(P, 'Invalid public key rejected', invalid.status === 403, `HTTP ${invalid.status}`);
  const wrongOrigin = await connect(options, integration, 'https://unrelated-origin.invalid');
  expectTrue(P, 'Wrong origin rejected', wrongOrigin.status === 403, `HTTP ${wrongOrigin.status}`);
  const ok = await connect(options, integration);
  expectTrue(P, 'Session issued for registered origin', ok.status === 200 && typeof ok.json.sessionToken === 'string',
    `HTTP ${ok.status}`);
  const badMessage = await call(options.apiBaseUrl, '/api/website-integrations/message', { message: 'hello' },
    { origin: integration.origin, authorization: 'Bearer mzw_invalid.token' });
  expectTrue(P, 'Message with invalid session rejected', badMessage.status === 401, `HTTP ${badMessage.status}`);
}

const PRICE = /(?:₹|\brs\.?|\binr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
const mentionedPrices = (text: string) => [...text.matchAll(PRICE)].map((m) => Number(m[1].replace(/,/g, '')));

async function verifyAssistant(options: Options, integration: Integration, products: DbProduct[]): Promise<Row[]> {
  const P = 'ask';
  const transcript: Row[] = [];
  const known = new Map(products.map((p) => [p.externalProductId, p]));
  const knownPrices = new Set(products.flatMap((p) => [p.price, p.salePrice]).filter((v): v is number => v !== null));
  const [first, second] = products;
  const questions: Array<{ q: string; expect: (answer: string, cards: Row[], sources: Row[]) => [boolean, string] }> = [
    { q: 'What products are available?', expect: (a, c) => {
      const named = products.filter((p) => a.toLowerCase().includes(p.name.toLowerCase())).length;
      return [named > 0 || c.length > 0, `${named} catalog names in answer, ${c.length} cards`];
    } },
    { q: `Find products under ${options.currency === 'INR' ? '₹' : `${options.currency} `}${options.maxPrice.toLocaleString('en-IN')}.`, expect: (_a, c) => {
      const over = c.filter((card) => ((card.salePrice ?? card.price) as number | null ?? Infinity) > options.maxPrice);
      const expected = products.filter((p) => p.currency === options.currency && (p.salePrice ?? p.price ?? Infinity) <= options.maxPrice).length;
      return [over.length === 0 && (expected === 0 || c.length > 0),
        `${c.length} cards, ${over.length} over budget, ${expected} matching database records`];
    } },
  ];
  if (first) questions.push({ q: `Give me details of ${first.name}.`, expect: (a, c) => {
    const ok = a.toLowerCase().includes(first.name.toLowerCase()) || c.some((card) => card.externalProductId === first.externalProductId);
    return [ok, ok ? 'product referenced' : 'requested product not referenced'];
  } });
  if (first && second) questions.push({ q: `Compare ${first.name} and ${second.name}.`, expect: (a, c) => {
    const has = (p: DbProduct) => a.toLowerCase().includes(p.name.toLowerCase()) &&
      c.some((card) => card.externalProductId === p.externalProductId);
    return [has(first) && has(second), `${Number(has(first)) + Number(has(second))}/2 products referenced`];
  } });
  questions.push({ q: `What is the ${options.policyQuery}?`, expect: (_a, _c, s) => [s.length > 0, `${s.length} sources`] });

  for (const { q, expect } of questions) {
    const session = await connect(options, integration);
    if (session.status !== 200) { record(P, q, 'FAIL', `connect HTTP ${session.status}`); continue; }
    const res = await call(options.apiBaseUrl, '/api/website-integrations/message', { message: q },
      { origin: integration.origin, authorization: `Bearer ${String(session.json.sessionToken)}` });
    if (res.status !== 200 || res.json.success !== true) {
      record(P, q, 'FAIL', `HTTP ${res.status}, success=${String(res.json.success)}`);
      transcript.push({ question: q, status: res.status });
      continue;
    }
    const answer = typeof res.json.answer === 'string' ? res.json.answer : '';
    const cards = Array.isArray(res.json.products) ? res.json.products as Row[] : [];
    const sources = Array.isArray(res.json.sources) ? res.json.sources as Row[] : [];
    transcript.push({ question: q, answer, products: cards, sources });

    const [ok, detail] = expect(answer, cards, sources);
    expectTrue(P, q, ok, detail);
    const mismatched = cards.filter((card) => {
      const db = known.get(String(card.externalProductId));
      return !db || db.price !== (card.price ?? null) || db.salePrice !== (card.salePrice ?? null) ||
        db.productUrl !== card.productUrl;
    });
    expectTrue(P, `  product cards match database`, mismatched.length === 0,
      `${cards.length} cards, ${mismatched.length} not matching active records`);
    const ungrounded = mentionedPrices(answer).filter((v) => !knownPrices.has(v) && v !== options.maxPrice);
    expectTrue(P, `  prices in answer are real catalog prices`, ungrounded.length === 0,
      ungrounded.length ? `ungrounded: ${ungrounded.join(', ')}` : `${mentionedPrices(answer).length} price mentions`);
    console.log(`        answer: ${answer.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  return transcript;
}

async function main(): Promise<number> {
  loadOptionalDotEnv();
  let options: Options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) {
    console.error(`[config] ${(error as Error).message}`);
    return 2;
  }
  let dataSource: DataSource | undefined;
  let runner: QueryRunner | undefined;
  let result: DbResult = { products: [] };
  let transcript: Row[] = [];
  try {
    dataSource = new DataSource({ ...MysqlConfig.fromEnv().toTypeormOptions(), entities: [], migrations: [], logging: false });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query('START TRANSACTION READ ONLY');
    result = await verifyDatabase(readOnly(runner), options);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    console.error(`[db] verification aborted${typeof code === 'string' ? ` (${code})` : ''}: ${(error as Error).message}`);
    return 2;
  } finally {
    if (runner) { try { await runner.query('ROLLBACK'); } catch { /* connection already closed */ } await runner.release(); }
    if (dataSource?.isInitialized) await dataSource.destroy();
  }

  if (options.api && !result.integration) record('api', 'API checks', 'SKIP', 'integration not verified in database phase');
  if (options.api && result.integration) {
    try {
      await verifyApi(options, result.integration);
      if (options.ask) transcript = await verifyAssistant(options, result.integration, result.products);
    } catch (error) {
      record('api', 'Backend reachable', 'FAIL', `${options.apiBaseUrl}: ${(error as Error).message}`);
    }
  } else if (!options.api) {
    record('api', 'API and assistant checks', 'SKIP', 'pass --api (no writes) and/or --ask (creates new widget conversations)');
  }

  const failed = checks.filter((c) => c.status === 'FAIL').length;
  const warned = checks.filter((c) => c.status === 'WARN').length;
  console.log(`\nSummary: ${checks.filter((c) => c.status === 'PASS').length} passed, ${failed} failed, ${warned} warnings, ${checks.filter((c) => c.status === 'SKIP').length} skipped.`);
  if (options.report) {
    writeFileSync(options.report, JSON.stringify({ generatedAt: new Date().toISOString(), checks, transcript }, null, 2));
    console.log(`Report written to ${options.report}`);
  }
  return failed > 0 ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  console.error(`[fatal] ${(error as Error).message}`);
  process.exitCode = 2;
});

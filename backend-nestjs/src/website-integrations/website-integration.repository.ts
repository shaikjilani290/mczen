import { Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { binaryToUuid, isUuidv7, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import type { CreateWebsiteIntegrationInput, WebsitePageInput, WebsiteProductInput } from './website-integration.dto';

type Row = Record<string, unknown>;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const id = (value: unknown) => binaryToUuid(value as Uint8Array);
const json = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
};
const iso = (value: unknown) => value instanceof Date
  ? value.toISOString()
  : typeof value === 'string' && value ? new Date(value).toISOString() : null;

export interface WebsiteIntegrationRecord {
  id: string;
  tenantId: string;
  assistantId: string;
  name: string;
  origin: string;
  publicKey: string;
  ingestionKeyHash: string;
  createdBy: string | null;
  status: 'active' | 'revoked';
}

@Injectable()
export class WebsiteIntegrationRepository {
  constructor(@Optional() @InjectDataSource() private readonly database?: DataSource) {}

  private get db(): DataSource {
    if (!this.database) throw new ServiceUnavailableException('Website integrations are unavailable.');
    return this.database;
  }

  private run<T extends Row = Row>(sql: string, values: unknown[] = [], manager?: EntityManager): Promise<T[]> {
    return (manager ?? this.db).query(sql, values) as Promise<T[]>;
  }

  async assistantExists(tenantId: string, assistantId: string): Promise<boolean> {
    if (!isUuidv7(tenantId) || !isUuidv7(assistantId)) return false;
    const rows = await this.run(
      `SELECT 1 FROM \`assistants\` WHERE \`tenant_id\`=? AND \`id\`=? AND \`status\`='active' AND \`deleted_at\` IS NULL LIMIT 1`,
      [uuidToBinary(tenantId), uuidToBinary(assistantId)],
    );
    return rows.length === 1;
  }

  async create(
    tenantId: string,
    input: CreateWebsiteIntegrationInput,
    publicKey: string,
    ingestionKeyHash: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.run(
      `INSERT INTO \`website_integrations\`
       (\`id\`,\`tenant_id\`,\`assistant_id\`,\`name\`,\`origin\`,\`public_key\`,\`ingestion_key_hash\`,\`created_by\`)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuidToBinary(newUuidv7()), uuidToBinary(tenantId), uuidToBinary(input.assistantId),
        input.name, input.origin, publicKey, ingestionKeyHash, uuidToBinary(userId)], manager,
    );
  }

  async list(tenantId: string): Promise<Row[]> {
    const rows = await this.run(
      `SELECT i.\`id\`,i.\`tenant_id\`,i.\`assistant_id\`,i.\`name\`,i.\`origin\`,i.\`public_key\`,i.\`status\`,
        i.\`sync_status\`,i.\`sync_started_at\`,i.\`sync_finished_at\`,i.\`last_sync_at\`,i.\`pages_discovered\`,
        i.\`products_imported\`,i.\`knowledge_indexed\`,i.\`sync_errors\`,i.\`created_at\`,i.\`updated_at\`,
        a.\`name\` AS assistant_name,
        (SELECT COUNT(*) FROM \`website_pages\` p WHERE p.\`tenant_id\`=i.\`tenant_id\` AND p.\`integration_id\`=i.\`id\` AND p.\`status\`='active') AS page_count,
        (SELECT COUNT(*) FROM \`website_products\` p WHERE p.\`tenant_id\`=i.\`tenant_id\` AND p.\`integration_id\`=i.\`id\` AND p.\`status\`='active') AS product_count
       FROM \`website_integrations\` i JOIN \`assistants\` a ON a.\`id\`=i.\`assistant_id\` AND a.\`tenant_id\`=i.\`tenant_id\`
       WHERE i.\`tenant_id\`=? ORDER BY i.\`created_at\` DESC`,
      [uuidToBinary(tenantId)],
    );
    return rows.map((row) => this.adminView(row));
  }

  async get(tenantId: string, integrationId: string): Promise<Row> {
    if (!isUuidv7(integrationId)) throw new NotFoundException('Website integration not found.');
    const rows = await this.run(
      `SELECT i.\`id\`,i.\`tenant_id\`,i.\`assistant_id\`,i.\`name\`,i.\`origin\`,i.\`public_key\`,i.\`status\`,
        i.\`sync_status\`,i.\`sync_started_at\`,i.\`sync_finished_at\`,i.\`last_sync_at\`,i.\`pages_discovered\`,
        i.\`products_imported\`,i.\`knowledge_indexed\`,i.\`sync_errors\`,i.\`created_by\`,i.\`ingestion_key_hash\`,
        i.\`created_at\`,i.\`updated_at\`,a.\`name\` AS assistant_name,
        (SELECT COUNT(*) FROM \`website_pages\` p WHERE p.\`tenant_id\`=i.\`tenant_id\` AND p.\`integration_id\`=i.\`id\` AND p.\`status\`='active') AS page_count,
        (SELECT COUNT(*) FROM \`website_products\` p WHERE p.\`tenant_id\`=i.\`tenant_id\` AND p.\`integration_id\`=i.\`id\` AND p.\`status\`='active') AS product_count
       FROM \`website_integrations\` i JOIN \`assistants\` a ON a.\`id\`=i.\`assistant_id\` AND a.\`tenant_id\`=i.\`tenant_id\`
       WHERE i.\`tenant_id\`=? AND i.\`id\`=? LIMIT 1`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId)],
    );
    if (!rows[0]) throw new NotFoundException('Website integration not found.');
    return this.adminView(rows[0]);
  }

  private adminView(row: Row): Row {
    return {
      id: id(row.id), assistantId: id(row.assistant_id), assistantName: row.assistant_name,
      name: row.name, domain: row.origin, publicKey: row.public_key, status: row.status,
      syncStatus: row.sync_status, syncStartedAt: iso(row.sync_started_at), syncFinishedAt: iso(row.sync_finished_at),
      lastSyncAt: iso(row.last_sync_at), pagesDiscovered: Number(row.pages_discovered),
      productsImported: Number(row.products_imported), knowledgeIndexed: Number(row.knowledge_indexed),
      pageCount: Number(row.page_count), productCount: Number(row.product_count),
      errors: json(row.sync_errors) ?? [], createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    };
  }

  async record(tenantId: string, integrationId: string, requireActive = false): Promise<WebsiteIntegrationRecord> {
    if (!isUuidv7(integrationId)) throw new NotFoundException('Website integration not found.');
    const rows = await this.run(
      `SELECT \`id\`,\`tenant_id\`,\`assistant_id\`,\`name\`,\`origin\`,\`public_key\`,
        \`ingestion_key_hash\`,\`created_by\`,\`status\`
       FROM \`website_integrations\` WHERE \`tenant_id\`=? AND \`id\`=?${requireActive ? " AND `status`='active'" : ''} LIMIT 1`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId)],
    );
    if (!rows[0]) throw new NotFoundException('Website integration not found.');
    return this.recordView(rows[0]);
  }

  async byPublicKey(publicKey: string): Promise<WebsiteIntegrationRecord | undefined> {
    const rows = await this.run(
      `SELECT i.\`id\`,i.\`tenant_id\`,i.\`assistant_id\`,i.\`name\`,i.\`origin\`,i.\`public_key\`,
        i.\`ingestion_key_hash\`,i.\`created_by\`,i.\`status\`
       FROM \`website_integrations\` i JOIN \`tenants\` t ON t.\`id\`=i.\`tenant_id\`
       JOIN \`assistants\` a ON a.\`id\`=i.\`assistant_id\` AND a.\`tenant_id\`=i.\`tenant_id\`
       WHERE i.\`public_key\`=? AND i.\`status\`='active' AND t.\`status\`='active' AND t.\`deleted_at\` IS NULL
         AND a.\`status\`='active' AND a.\`deleted_at\` IS NULL LIMIT 1`,
      [publicKey],
    );
    return rows[0] ? this.recordView(rows[0]) : undefined;
  }

  async activeRecord(tenantId: string, integrationId: string): Promise<WebsiteIntegrationRecord | undefined> {
    if (!isUuidv7(tenantId) || !isUuidv7(integrationId)) return undefined;
    const rows = await this.run(
      `SELECT i.\`id\`,i.\`tenant_id\`,i.\`assistant_id\`,i.\`name\`,i.\`origin\`,i.\`public_key\`,
        i.\`ingestion_key_hash\`,i.\`created_by\`,i.\`status\`
       FROM \`website_integrations\` i JOIN \`tenants\` t ON t.\`id\`=i.\`tenant_id\`
       JOIN \`assistants\` a ON a.\`id\`=i.\`assistant_id\` AND a.\`tenant_id\`=i.\`tenant_id\`
       WHERE i.\`tenant_id\`=? AND i.\`id\`=? AND i.\`status\`='active'
         AND t.\`status\`='active' AND t.\`deleted_at\` IS NULL
         AND a.\`status\`='active' AND a.\`deleted_at\` IS NULL LIMIT 1`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId)],
    );
    return rows[0] ? this.recordView(rows[0]) : undefined;
  }

  async byIngestionKey(key: string): Promise<WebsiteIntegrationRecord | undefined> {
    const rows = await this.run(
      `SELECT i.\`id\`,i.\`tenant_id\`,i.\`assistant_id\`,i.\`name\`,i.\`origin\`,i.\`public_key\`,
        i.\`ingestion_key_hash\`,i.\`created_by\`,i.\`status\`
       FROM \`website_integrations\` i JOIN \`tenants\` t ON t.\`id\`=i.\`tenant_id\`
       JOIN \`assistants\` a ON a.\`id\`=i.\`assistant_id\` AND a.\`tenant_id\`=i.\`tenant_id\`
       WHERE i.\`ingestion_key_hash\`=? AND i.\`status\`='active' AND t.\`status\`='active' AND t.\`deleted_at\` IS NULL
         AND a.\`status\`='active' AND a.\`deleted_at\` IS NULL LIMIT 1`,
      [sha256(key)],
    );
    return rows[0] ? this.recordView(rows[0]) : undefined;
  }

  private recordView(row: Row): WebsiteIntegrationRecord {
    return {
      id: id(row.id), tenantId: id(row.tenant_id), assistantId: id(row.assistant_id),
      name: String(row.name), origin: String(row.origin), publicKey: String(row.public_key),
      ingestionKeyHash: String(row.ingestion_key_hash),
      createdBy: row.created_by ? id(row.created_by) : null,
      status: row.status as WebsiteIntegrationRecord['status'],
    };
  }

  async rotateKeys(tenantId: string, integrationId: string, publicKey: string, ingestionKeyHash: string): Promise<void> {
    await this.run(
      `UPDATE \`website_integrations\` SET \`public_key\`=?,\`ingestion_key_hash\`=?,\`status\`='active'
       WHERE \`tenant_id\`=? AND \`id\`=?`,
      [publicKey, ingestionKeyHash, uuidToBinary(tenantId), uuidToBinary(integrationId)],
    );
  }

  async revoke(tenantId: string, integrationId: string): Promise<void> {
    await this.run(
      `UPDATE \`website_integrations\` SET \`status\`='revoked' WHERE \`tenant_id\`=? AND \`id\`=?`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId)],
    );
  }

  async beginSync(tenantId: string, integrationId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE \`website_integrations\` SET \`sync_status\`='running',\`sync_started_at\`=CURRENT_TIMESTAMP(3),
        \`sync_finished_at\`=NULL,\`sync_errors\`=JSON_ARRAY(),\`pages_discovered\`=0
       WHERE \`tenant_id\`=? AND \`id\`=? AND \`status\`='active' AND \`sync_status\`<>'running'`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId)],
    ) as { affectedRows?: number };
    return Number(result.affectedRows) === 1;
  }

  async setSyncDiscovery(tenantId: string, integrationId: string, count: number): Promise<void> {
    await this.run('UPDATE `website_integrations` SET `pages_discovered`=? WHERE `tenant_id`=? AND `id`=? AND `sync_status`=\'running\'',
      [count, uuidToBinary(tenantId), uuidToBinary(integrationId)]);
  }

  async finishSync(tenantId: string, integrationId: string, result: {
    status: 'completed' | 'failed'; pages: number; products: number; indexed: number; errors: string[];
  }): Promise<void> {
    await this.run(
      `UPDATE \`website_integrations\` SET \`sync_status\`=?,\`sync_finished_at\`=CURRENT_TIMESTAMP(3),
        \`last_sync_at\`=CURRENT_TIMESTAMP(3),\`pages_discovered\`=?,\`products_imported\`=?,\`knowledge_indexed\`=?,
        \`sync_errors\`=? WHERE \`tenant_id\`=? AND \`id\`=?`,
      [result.status, result.pages, result.products, result.indexed, JSON.stringify(result.errors.slice(0, 50)),
        uuidToBinary(tenantId), uuidToBinary(integrationId)],
    );
  }

  async refreshCounts(tenantId: string, integrationId: string): Promise<void> {
    await this.run(
      `UPDATE \`website_integrations\` i SET
        i.\`products_imported\`=(SELECT COUNT(*) FROM \`website_products\` p
          WHERE p.\`tenant_id\`=i.\`tenant_id\` AND p.\`integration_id\`=i.\`id\` AND p.\`status\`='active'),
        i.\`knowledge_indexed\`=(SELECT COUNT(*) FROM \`website_pages\` p
          WHERE p.\`tenant_id\`=i.\`tenant_id\` AND p.\`integration_id\`=i.\`id\` AND p.\`status\`='active')
       WHERE i.\`tenant_id\`=? AND i.\`id\`=?`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId)],
    );
  }

  async findPage(tenantId: string, integrationId: string, urlHash: string, manager?: EntityManager): Promise<Row | undefined> {
    const rows = await this.run(
      `SELECT \`id\`,\`article_id\`,\`content_hash\`,\`status\` FROM \`website_pages\`
       WHERE \`tenant_id\`=? AND \`integration_id\`=? AND \`url_hash\`=? LIMIT 1${manager ? ' FOR UPDATE' : ''}`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId), urlHash], manager,
    );
    return rows[0];
  }

  async upsertPage(input: {
    tenantId: string; integrationId: string; articleId: Buffer; pageId: Buffer;
    url: string; urlHash: string; contentHash: string; page: WebsitePageInput;
  }, manager?: EntityManager): Promise<void> {
    await this.run(
      `INSERT INTO \`website_pages\`
       (\`id\`,\`tenant_id\`,\`integration_id\`,\`article_id\`,\`canonical_url\`,\`url_hash\`,\`content_hash\`,
        \`title\`,\`meta_description\`,\`headings\`,\`links\`,\`page_type\`,\`last_updated_at\`,\`last_seen_at\`,\`status\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(3)),?)
       ON DUPLICATE KEY UPDATE \`article_id\`=VALUES(\`article_id\`),\`canonical_url\`=VALUES(\`canonical_url\`),
        \`content_hash\`=VALUES(\`content_hash\`),\`title\`=VALUES(\`title\`),\`meta_description\`=VALUES(\`meta_description\`),
        \`headings\`=VALUES(\`headings\`),\`links\`=VALUES(\`links\`),\`page_type\`=VALUES(\`page_type\`),
        \`last_updated_at\`=VALUES(\`last_updated_at\`),\`last_seen_at\`=CURRENT_TIMESTAMP(3),\`status\`=VALUES(\`status\`)`,
      [input.pageId, uuidToBinary(input.tenantId), uuidToBinary(input.integrationId), input.articleId,
        input.url, input.urlHash, input.contentHash, input.page.title, input.page.metaDescription,
        JSON.stringify(input.page.headings), JSON.stringify(input.page.links), input.page.pageType,
        input.page.lastUpdatedAt, null, input.page.status],
      manager,
    );
  }

  async pages(tenantId: string, integrationId: string, page = 1, pageSize = 25): Promise<Row[]> {
    return this.run(
      `SELECT \`canonical_url\` AS url,\`title\`,\`meta_description\` AS metaDescription,\`page_type\` AS pageType,
        \`status\`,\`content_hash\` AS contentHash,\`last_updated_at\` AS lastUpdatedAt,\`last_seen_at\` AS lastSeenAt
       FROM \`website_pages\` WHERE \`tenant_id\`=? AND \`integration_id\`=?
       ORDER BY \`last_seen_at\` DESC LIMIT ? OFFSET ?`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId), pageSize, (page - 1) * pageSize],
    );
  }

  async upsertProduct(tenantId: string, integrationId: string, product: WebsiteProductInput, contentHash: string): Promise<void> {
    await this.run(
      `INSERT INTO \`website_products\`
       (\`id\`,\`tenant_id\`,\`integration_id\`,\`external_product_id\`,\`name\`,\`description\`,\`sku\`,\`brand\`,
        \`category\`,\`price\`,\`sale_price\`,\`currency\`,\`stock\`,\`availability\`,\`images\`,\`product_url\`,
        \`attributes\`,\`content_hash\`,\`external_updated_at\`,\`last_seen_at\`,\`status\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3),?)
       ON DUPLICATE KEY UPDATE \`name\`=VALUES(\`name\`),\`description\`=VALUES(\`description\`),\`sku\`=VALUES(\`sku\`),
        \`brand\`=VALUES(\`brand\`),\`category\`=VALUES(\`category\`),\`price\`=VALUES(\`price\`),
        \`sale_price\`=VALUES(\`sale_price\`),\`currency\`=VALUES(\`currency\`),\`stock\`=VALUES(\`stock\`),
        \`availability\`=VALUES(\`availability\`),\`images\`=VALUES(\`images\`),\`product_url\`=VALUES(\`product_url\`),
        \`attributes\`=VALUES(\`attributes\`),\`content_hash\`=VALUES(\`content_hash\`),
        \`external_updated_at\`=VALUES(\`external_updated_at\`),\`last_seen_at\`=CURRENT_TIMESTAMP(3),\`status\`=VALUES(\`status\`)`,
      [uuidToBinary(newUuidv7()), uuidToBinary(tenantId), uuidToBinary(integrationId), product.externalProductId,
        product.name, product.description, product.sku, product.brand, product.category, product.price,
        product.salePrice, product.currency, product.stock, product.availability, JSON.stringify(product.images),
        product.productUrl, JSON.stringify(product.attributes), contentHash, product.updatedAt, product.status],
    );
  }

  async products(tenantId: string, integrationId: string, page = 1, pageSize = 25): Promise<Row[]> {
    const rows = await this.run(
      `SELECT \`external_product_id\` AS externalProductId,\`name\`,\`description\`,\`sku\`,\`brand\`,\`category\`,
        \`price\`,\`sale_price\` AS salePrice,\`currency\`,\`stock\`,\`availability\`,\`images\`,
        \`product_url\` AS productUrl,\`attributes\`,\`status\`,\`external_updated_at\` AS updatedAt
       FROM \`website_products\` WHERE \`tenant_id\`=? AND \`integration_id\`=?
       ORDER BY \`updated_at\` DESC LIMIT ? OFFSET ?`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId), pageSize, (page - 1) * pageSize],
    );
    return rows.map((row) => this.productView(row));
  }

  private productView(row: Row): Row {
    return {
      ...row, images: json(row.images) ?? [], attributes: json(row.attributes) ?? {},
      price: row.price === null ? null : Number(row.price),
      salePrice: row.salePrice === null ? null : Number(row.salePrice),
      stock: row.stock === null ? null : Number(row.stock), updatedAt: iso(row.updatedAt),
    };
  }

  async trackPage(input: {
    tenantId: string; integrationId: string; visitorId: string; pageUrl: string;
    pageHash: string; title: string | null; referrer: string | null;
  }): Promise<void> {
    await this.run(
      `DELETE FROM \`website_page_views\` WHERE \`tenant_id\`=? AND \`integration_id\`=? AND
       \`visitor_id\`=? AND \`page_hash\`=? AND \`created_at\` > CURRENT_TIMESTAMP(3)-INTERVAL 1 MINUTE`,
      [uuidToBinary(input.tenantId), uuidToBinary(input.integrationId), uuidToBinary(input.visitorId), input.pageHash],
    );
    await this.run(
      `INSERT INTO \`website_page_views\` (\`tenant_id\`,\`integration_id\`,\`visitor_id\`,\`page_url\`,\`page_hash\`,\`page_title\`,\`referrer_origin\`)
       VALUES (?,?,?,?,?,?,?)`,
      [uuidToBinary(input.tenantId), uuidToBinary(input.integrationId), uuidToBinary(input.visitorId),
        input.pageUrl, input.pageHash, input.title, input.referrer],
    );
    await this.run(
      `DELETE FROM \`website_page_views\` WHERE \`tenant_id\`=? AND \`integration_id\`=? AND
       \`id\` < (SELECT \`id\` FROM (SELECT \`id\` FROM \`website_page_views\`
       WHERE \`tenant_id\`=? AND \`integration_id\`=? ORDER BY \`id\` DESC LIMIT 10000,1) \`oldest\`)`,
      [uuidToBinary(input.tenantId), uuidToBinary(input.integrationId), uuidToBinary(input.tenantId), uuidToBinary(input.integrationId)],
    );
  }

  async pageCounts(tenantId: string, integrationId: string): Promise<{ pageViews: number }> {
    const rows = await this.run(
      `SELECT COUNT(*) AS pageViews FROM \`website_page_views\` WHERE \`tenant_id\`=? AND \`integration_id\`=?`,
      [uuidToBinary(tenantId), uuidToBinary(integrationId)],
    );
    return { pageViews: Number(rows[0]?.pageViews ?? 0) };
  }

  async searchPages(tenantId: string, assistantId: string, query: string, type: string | null, limit: number): Promise<Row[]> {
    const typeClause = type ? ' AND p.`page_type`=?' : '';
    const params: unknown[] = [
      uuidToBinary(tenantId), uuidToBinary(assistantId), query,
      ...(type ? [type] : []), query, limit,
    ];
    return this.run(
      `SELECT p.\`canonical_url\` AS url,p.\`title\`,p.\`meta_description\` AS metaDescription,p.\`page_type\` AS pageType,
        SUBSTRING_INDEX(GROUP_CONCAT(REPLACE(SUBSTRING(k.\`content\`,1,1600),CHAR(10),' ')
          ORDER BY MATCH(k.\`content\`) AGAINST (? IN NATURAL LANGUAGE MODE) DESC SEPARATOR '\\n'),'\\n',1) AS excerpt
       FROM \`website_pages\` p
       JOIN \`website_integrations\` i ON i.\`id\`=p.\`integration_id\` AND i.\`tenant_id\`=p.\`tenant_id\`
       JOIN \`knowledge_chunks\` k ON k.\`article_id\`=p.\`article_id\` AND k.\`tenant_id\`=p.\`tenant_id\`
       WHERE p.\`tenant_id\`=? AND i.\`assistant_id\`=? AND i.\`status\`='active' AND p.\`status\`='active'
         AND MATCH(k.\`content\`) AGAINST (? IN NATURAL LANGUAGE MODE)${typeClause}
       GROUP BY p.\`id\`,p.\`canonical_url\`,p.\`title\`,p.\`meta_description\`,p.\`page_type\`
       ORDER BY MAX(MATCH(k.\`content\`) AGAINST (? IN NATURAL LANGUAGE MODE)) DESC LIMIT ?`,
      [query, ...params],
    );
  }

  async searchProducts(tenantId: string, assistantId: string, input: {
    query?: string; category?: string; maxPrice?: number; currency?: string;
    limit: number; ids?: string[]; integrationId?: string; productUrl?: string;
  }): Promise<Row[]> {
    const where = [
      'p.`tenant_id`=?', 'i.`assistant_id`=?', "i.`status`='active'", "p.`status`='active'",
    ];
    const params: unknown[] = [uuidToBinary(tenantId), uuidToBinary(assistantId)];
    if (input.ids) {
      where.push(`p.\`external_product_id\` IN (${input.ids.map(() => '?').join(',')})`);
      params.push(...input.ids);
    }
    if (input.productUrl) {
      where.push('p.`product_url`=?');
      params.push(input.productUrl);
    }
    if (input.integrationId) {
      if (!isUuidv7(input.integrationId)) return [];
      where.push('i.`id`=?');
      params.push(uuidToBinary(input.integrationId));
    }
    if (input.category) { where.push('p.`category`=?'); params.push(input.category); }
    if (input.query) {
      where.push('(MATCH(p.`name`,p.`description`,p.`brand`,p.`category`) AGAINST (? IN NATURAL LANGUAGE MODE) OR p.`sku`=?)');
      params.push(input.query, input.query);
    }
    if (input.currency) { where.push('p.`currency`=?'); params.push(input.currency); }
    if (input.maxPrice !== undefined) {
      where.push('COALESCE(p.`sale_price`,p.`price`)<=?');
      params.push(input.maxPrice);
    }
    const relevanceOrder = input.query
      ? ' (LOCATE(LOWER(p.`name`),LOWER(?))>0) DESC, MATCH(p.`name`,p.`description`,p.`brand`,p.`category`) AGAINST (? IN NATURAL LANGUAGE MODE) DESC,'
      : '';
    if (input.query) params.push(input.query, input.query);
    params.push(input.limit);
    const rows = await this.run(
      `SELECT p.\`external_product_id\` AS externalProductId,i.\`id\` AS integrationId,i.\`name\` AS integrationName,
        i.\`origin\` AS websiteDomain,p.\`name\`,p.\`description\`,p.\`sku\`,p.\`brand\`,p.\`category\`,
        p.\`price\`,p.\`sale_price\` AS salePrice,p.\`currency\`,p.\`stock\`,p.\`availability\`,p.\`images\`,
        p.\`product_url\` AS productUrl,p.\`attributes\`,p.\`external_updated_at\` AS updatedAt
       FROM \`website_products\` p JOIN \`website_integrations\` i
        ON i.\`id\`=p.\`integration_id\` AND i.\`tenant_id\`=p.\`tenant_id\`
       WHERE ${where.join(' AND ')} ORDER BY ${relevanceOrder} p.\`updated_at\` DESC LIMIT ?`,
      params,
    );
    return rows.map((row) => this.productView(row));
  }

  async productVocabulary(tenantId: string, assistantId: string, integrationId: string):
    Promise<Array<{ externalProductId: string; name: string }>> {
    if (!isUuidv7(tenantId) || !isUuidv7(assistantId) || !isUuidv7(integrationId)) {
      throw new NotFoundException('The product catalogue scope is invalid.');
    }
    const rows = await this.run(
      `SELECT p.\`external_product_id\` AS externalProductId,p.\`name\`
       FROM \`website_products\` p JOIN \`website_integrations\` i
         ON i.\`id\`=p.\`integration_id\` AND i.\`tenant_id\`=p.\`tenant_id\`
       WHERE p.\`tenant_id\`=? AND i.\`assistant_id\`=? AND i.\`id\`=?
         AND i.\`status\`='active' AND p.\`status\`='active' ORDER BY p.\`name\` LIMIT 2001`,
      [uuidToBinary(tenantId), uuidToBinary(assistantId), uuidToBinary(integrationId)],
    );
    if (rows.length > 2000) throw new ServiceUnavailableException('The product vocabulary exceeds the supported size.');
    return rows.map(row => ({ externalProductId: String(row.externalProductId), name: String(row.name) }));
  }

  async listKnowledge(tenantId: string, integrationId: string, page = 1, pageSize = 25): Promise<Row[]> {
    return this.pages(tenantId, integrationId, page, pageSize);
  }
}

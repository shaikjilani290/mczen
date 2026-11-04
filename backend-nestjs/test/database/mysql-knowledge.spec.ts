import * as mysql from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MysqlConfig } from '../../src/database/mysql-config';
import { ALL_MIGRATIONS } from '../../src/database/migrations';
import { newUuidv7, uuidToBinary } from '../../src/common/ids/uuid';
import { tenantContextStore } from '../../src/common/tenant/tenant-context.store';
import { KnowledgeRepository } from '../../src/knowledge/knowledge.repository';
import { KnowledgeContentService } from '../../src/knowledge/knowledge-content.service';
import { KnowledgeDocumentsService } from '../../src/knowledge/knowledge-documents.service';
import { MysqlKnowledgeRetriever } from '../../src/knowledge/knowledge-retriever';
import { parseArticle } from '../../src/knowledge/knowledge.dto';

/**
 * Opt-in Phase 6E integration test against a REAL MySQL 8 server (ngram parser required).
 * Creates and drops its own throwaway schema; never point it at the VPS or a shared database.
 *
 *   RUN_DB_TESTS=1 DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=... DB_NAME=unused \
 *     npm test -- test/database/mysql-knowledge.spec.ts
 */
const RUN = process.env.RUN_DB_TESTS === '1' && ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].every((key) => typeof process.env[key] === 'string');
const describeDb = RUN ? describe : describe.skip;
jest.setTimeout(120_000);

describeDb('Phase 6E knowledge retrieval (real MySQL, FULLTEXT + ngram)', () => {
  const database = `mczen_6e_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const tenantA = newUuidv7();
  const tenantB = newUuidv7();
  const userId = newUuidv7();
  let admin: Connection;
  let source: DataSource;
  let created = false;
  let content: KnowledgeContentService;
  let documents: KnowledgeDocumentsService;
  let repo: KnowledgeRepository;
  let retriever: MysqlKnowledgeRetriever;
  const as = (tenantId: string) => ({ tenantId, actorType: 'user' as const, userId, permissions: ['knowledge:read', 'knowledge:write'] });
  const inTenant = <T>(tenantId: string, fn: () => Promise<T>) => tenantContextStore.run(as(tenantId), fn);

  const categoryId = async (name: string) => (await content.listCategories()).categories.find((c) => c.name === name)!.id as string;
  const publish = async (title: string, body: string, language: 'en' | 'hi' | 'te', category: string) =>
    content.createArticle(parseArticle({ title, content: body, language, categoryId: await categoryId(category), status: 'published', tags: ['sleep'] }), userId);

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    created = true;
    source = new DataSource({ ...MysqlConfig.fromEnv({ ...process.env, DB_NAME: database }).toTypeormOptions(ALL_MIGRATIONS), entities: [], logging: false, migrationsTransactionMode: 'each' });
    await source.initialize();
    await source.runMigrations();
    await source.query("INSERT INTO `users` (`id`, `email`, `password_hash`) VALUES (?, 'k@example.test', 'x')", [uuidToBinary(userId)]);
    for (const [id, slug] of [[tenantA, 'a'], [tenantB, 'b']]) {
      await source.query('INSERT INTO `tenants` (`id`, `name`, `slug`) VALUES (?, ?, ?)', [uuidToBinary(id), `Tenant ${slug}`, `k-${slug}-${randomBytes(2).toString('hex')}`]);
    }
    repo = new KnowledgeRepository(source);
    retriever = new MysqlKnowledgeRetriever(repo);
    content = new KnowledgeContentService(repo, retriever);
    documents = new KnowledgeDocumentsService(repo, { put: async () => undefined, get: async () => Buffer.from('మంచి నిద్ర ఆరోగ్యానికి అవసరం'), delete: async () => undefined } as never);
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin) {
      if (created) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });

  it('seeds the six categories and stores en/hi/te articles', async () => {
    await inTenant(tenantA, async () => {
      expect((await content.listCategories()).categories).toHaveLength(6);
      await publish('Sleep basics', 'Adults generally benefit from seven to nine hours of sleep each night.', 'en', 'Sleep & Wellness');
      await publish('नींद की सलाह', 'नींद अच्छी सेहत के लिए बहुत ज़रूरी है। रोज़ाना सात से आठ घंटे की नींद लें।', 'hi', 'Sleep & Wellness');
      await publish('నిద్ర ప్రాముఖ్యత', 'ఆరోగ్యానికి నిద్ర చాలా ముఖ్యం. ప్రతిరోజూ ఏడు గంటలు నిద్రపోవాలి.', 'te', 'Sleep & Wellness');
      await publish('Protein sources', 'Lentils, eggs and paneer provide dietary protein.', 'en', 'Nutrition');
    });
  });

  it('finds English, Hindi and Telugu content with source references', async () => {
    await inTenant(tenantA, async () => {
      const en = await retriever.search({ query: 'how many hours of sleep' });
      expect(en[0]).toMatchObject({ title: 'Sleep basics', kind: 'article' });
      expect(en[0].source).toMatch(/^knowledge:\/\/article\//);
      expect((await retriever.search({ query: 'नींद', language: 'hi' }))[0].title).toBe('नींद की सलाह');
      expect((await retriever.search({ query: 'నిద్ర', language: 'te' }))[0].title).toBe('నిద్ర ప్రాముఖ్యత');
    });
  });

  it('applies language and category filters', async () => {
    await inTenant(tenantA, async () => {
      expect((await retriever.search({ query: 'protein', categoryId: await categoryId('Fitness') }))).toHaveLength(0);
      expect((await retriever.search({ query: 'protein', categoryId: await categoryId('Nutrition') })).map((h) => h.title)).toEqual(['Protein sources']);
      expect((await retriever.search({ query: 'sleep', language: 'hi' }))).toHaveLength(0);
    });
  });

  it('never returns another tenant’s content, drafts or archived articles', async () => {
    await inTenant(tenantB, async () => {
      expect(await retriever.search({ query: 'sleep' })).toHaveLength(0);
      const draft = await content.createArticle(parseArticle({ title: 'Secret draft', content: 'confidential zinc roadmap', categoryId: await categoryId('Nutrition') }), userId);
      expect(await retriever.search({ query: 'zinc' })).toHaveLength(0);
      await content.updateArticle(draft.id as string, parseArticle({ status: 'published' }, true), userId);
      expect(await retriever.search({ query: 'zinc' })).toHaveLength(1);
      await content.archiveArticle(draft.id as string, userId);
      expect(await retriever.search({ query: 'zinc' })).toHaveLength(0);
    });
    await inTenant(tenantA, async () => expect(await retriever.search({ query: 'zinc' })).toHaveLength(0));
  });

  it('indexes documents only when processed and published, and searches their Telugu text', async () => {
    await inTenant(tenantA, async () => {
      const doc = await documents.upload({ originalname: 'guide.txt', size: 40, buffer: Buffer.from('మంచి నిద్ర ఆరోగ్యానికి అవసరం', 'utf8') }, { categoryId: await categoryId('Sleep & Wellness'), language: 'te', publication: 'draft' }, userId);
      expect(doc.status).toBe('processed');
      expect((await retriever.search({ query: 'ఆరోగ్యానికి', language: 'te' })).some((h) => h.kind === 'document')).toBe(false);
      await documents.update(doc.id as string, { publication: 'published' }, userId);
      const hit = (await retriever.search({ query: 'ఆరోగ్యానికి', language: 'te' })).find((h) => h.kind === 'document');
      expect(hit).toMatchObject({ title: 'guide', source: expect.stringMatching(/^knowledge:\/\/document\//) });
      await documents.archive(doc.id as string, userId);
      expect((await retriever.search({ query: 'ఆరోగ్యానికి', language: 'te' })).some((h) => h.kind === 'document')).toBe(false);
    });
  });

  it('reverts and reapplies the knowledge migration cleanly', async () => {
    await source.undoLastMigration();
    expect(await source.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'knowledge_%'", [database])).toHaveLength(0);
    expect((await source.runMigrations()).map((m) => m.name)).toEqual(['KnowledgeManagement1740000000007']);
    expect(await source.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'knowledge_%'", [database])).toHaveLength(5);
  });
});

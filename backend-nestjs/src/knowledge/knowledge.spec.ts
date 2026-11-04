import { NotFoundException } from '@nestjs/common';
import { binaryToUuid, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { TenantContextMissingError, tenantContextStore } from '../common/tenant/tenant-context.store';
import { KnowledgeService } from '../agent/knowledge.service';
import { createKnowledgeSearchTool } from '../agent/tools/implementations/knowledge-search.tool';
import { ExtractionError } from './document-extractor';
import type { DocumentStorage } from './document-storage';
import { KnowledgeContentService } from './knowledge-content.service';
import { KnowledgeDocumentsService } from './knowledge-documents.service';
import { buildMatchQuery, MysqlKnowledgeRetriever, rankHits } from './knowledge-retriever';
import { parseArticle, parseCategory } from './knowledge.dto';
import { KnowledgeRepository, Row } from './knowledge.repository';
import { buildZip, docxWith } from './test-fixtures';

const tenantA = newUuidv7();
const tenantB = newUuidv7();
const userA = newUuidv7();
const as = (tenantId: string) => ({ tenantId, actorType: 'user' as const, userId: userA, permissions: ['knowledge:read', 'knowledge:write'] });
const inTenant = <T>(tenantId: string, fn: () => T): T => tenantContextStore.run(as(tenantId), fn);

describe('KnowledgeRepository SQL (mocked DataSource — not a database integration test)', () => {
  const make = (rows: Row[] = []) => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const source = { query: jest.fn(async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return rows; }) };
    return { repo: new KnowledgeRepository(source as never), calls };
  };
  const hasTenant = (params: unknown[], tenant: string) => params.some((p) => Buffer.isBuffer(p) && p.equals(uuidToBinary(tenant)));

  it('fails closed without a verified tenant context', async () => {
    const { repo } = make();
    await expect(repo.listArticles({ page: 1, pageSize: 10 })).rejects.toThrow(TenantContextMissingError);
    await expect(repo.searchChunks({ match: 'x', limit: 5 })).rejects.toThrow(TenantContextMissingError);
  });

  it('scopes every read/write statement by the context tenant, never another', async () => {
    const { repo, calls } = make([{ n: 1, next: 1 }]);
    await inTenant(tenantA, async () => {
      await repo.listCategories();
      await repo.listArticles({ page: 1, pageSize: 10, status: 'published', language: 'hi', tag: 'sleep', q: '50%_off' });
      await repo.listDocuments({ page: 1, pageSize: 10 });
      await repo.dashboardCounts();
      await repo.searchChunks({ match: 'sleep', limit: 10, language: 'te', categoryId: newUuidv7() });
      await repo.tagsFor([uuidToBinary(newUuidv7())]);
    });
    expect(calls.length).toBeGreaterThan(6);
    for (const call of calls) {
      expect(call.sql).toContain('`tenant_id`');
      expect(hasTenant(call.params, tenantA)).toBe(true);
      expect(hasTenant(call.params, tenantB)).toBe(false);
    }
  });

  it('keeps FULLTEXT MATCH top-level and restricts to published/processed content', async () => {
    const { repo, calls } = make();
    await inTenant(tenantA, () => repo.searchChunks({ match: 'నిద్ర', limit: 10, language: 'te' }));
    const { sql, params } = calls[0];
    expect(sql).toMatch(/WHERE c\.`tenant_id` = \? AND MATCH\(c\.`content`\) AGAINST \(\? IN NATURAL LANGUAGE MODE\)\s+AND \(a\.`id` IS NOT NULL OR d\.`id` IS NOT NULL\)/);
    expect(sql).toContain("a.`status` = 'published'");
    expect(sql).toContain("d.`status` = 'processed' AND d.`publication` = 'published'");
    expect(sql).toContain('c.`language_code` = ?');
    expect(params).toContain('నిద్ర');
    expect(sql).not.toContain('నిద్ర');
  });

  it('escapes LIKE wildcards in list filters', async () => {
    const { repo, calls } = make([{ n: 0 }]);
    await inTenant(tenantA, () => repo.listArticles({ page: 1, pageSize: 10, q: '50%_off' }));
    expect(calls[0].params).toContain('%50\\%\\_off%');
  });

  it('treats malformed and unknown ids as not found', async () => {
    const { repo } = make([]);
    await expect(inTenant(tenantA, () => repo.findArticle('not-a-uuid'))).rejects.toThrow(NotFoundException);
    await expect(inTenant(tenantA, () => repo.findArticle(newUuidv7()))).rejects.toThrow(NotFoundException);
    await expect(inTenant(tenantA, () => repo.findDocument(newUuidv7()))).rejects.toThrow(NotFoundException);
  });
});

describe('retrieval ranking and source references', () => {
  const article = (over: Row): Row => ({ chunk_id: 1, article_id: uuidToBinary(newUuidv7()), document_id: null, content: '', language_code: 'en', score: 1, article_title: 'Sleep', article_source_name: null, article_source_url: null, category_name: 'Sleep & Wellness', ...over });

  it('strips FULLTEXT operators from user text', () => {
    expect(buildMatchQuery('+sleep -"tips" (*) <hello> ~x')).toBe('sleep tips hello');
    expect(buildMatchQuery('!!! ??')).toBe('');
  });

  it('drops rows with no term overlap, keeps the best chunk per source, ranks by relevance', () => {
    const id = uuidToBinary(newUuidv7());
    const rows = [
      article({ article_id: id, content: 'Sleep hygiene tips for adults', score: 3 }),
      article({ article_id: id, content: 'Sleep and sleep and more sleep hygiene', score: 9 }),
      article({ content: 'Unrelated pizza recipe', article_title: 'Food', score: 8 }),
      article({ article_id: null, document_id: uuidToBinary(newUuidv7()), content: 'Sleep hygiene guide PDF', article_title: null, document_title: 'Guide', document_source_name: 'WHO', score: 2 }),
    ];
    const hits = rankHits(rows, 'sleep hygiene', 5);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.kind).sort()).toEqual(['article', 'document']);
    expect(hits.every((h) => h.excerpt.length > 0 && h.source.startsWith('knowledge://'))).toBe(true);
    expect(hits.find((h) => h.kind === 'document')).toMatchObject({ title: 'Guide', sourceName: 'WHO' });
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it('uses the article source URL as the reference when provided and matches Hindi and Telugu terms', () => {
    const hits = rankHits([
      article({ content: 'नींद अच्छी सेहत के लिए ज़रूरी है', language_code: 'hi', article_source_url: 'https://example.org/sleep' }),
      article({ content: 'ఆరోగ్యానికి నిద్ర చాలా ముఖ్యం', language_code: 'te' }),
    ], 'नींद', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ language: 'hi', source: 'https://example.org/sleep' });
    expect(rankHits([article({ content: 'ఆరోగ్యానికి నిద్ర చాలా ముఖ్యం', language_code: 'te' })], 'నిద్ర', 5)[0].language).toBe('te');
  });

  it('truncates long excerpts and respects the limit', () => {
    const rows = Array.from({ length: 6 }, () => article({ content: `sleep ${'x'.repeat(2000)}` }));
    const hits = rankHits(rows, 'sleep', 3);
    expect(hits).toHaveLength(3);
    expect(hits[0].excerpt.length).toBeLessThanOrEqual(601);
  });

  it('MysqlKnowledgeRetriever returns [] for operator-only queries without touching the database', async () => {
    const repo = { searchChunks: jest.fn() };
    await expect(new MysqlKnowledgeRetriever(repo as never).search({ query: '+-*' })).resolves.toEqual([]);
    expect(repo.searchChunks).not.toHaveBeenCalled();
  });
});

/** In-memory stand-in for KnowledgeRepository, partitioned by the ALS tenant like the real one. */
class FakeRepo {
  categories = new Map<string, Row>();
  articles = new Map<string, Row>();
  tags = new Map<string, string[]>();
  chunks = new Map<string, { content: string; language: string }[]>();
  documents = new Map<string, Row>();
  private tenant() { const t = tenantContextStore.getOrThrow().tenantId; return t; }
  tenantIdString() { return this.tenant(); }
  private key(id: Buffer | string) { return `${this.tenant()}|${typeof id === 'string' ? id : binaryToUuid(id)}`; }
  transaction<T>(work: (m: unknown) => Promise<T>) { return work({}); }
  async ensureDefaultCategories() {
    for (const name of ['Symptoms', 'Nutrition', 'Fitness', 'Sleep & Wellness', 'McZEN Products', 'Health Education']) {
      const id = `${this.tenant()}-${name}`;
      if (![...this.categories.keys()].some((k) => k.startsWith(`${this.tenant()}|`) && this.categories.get(k)?.name === name)) {
        const real = newUuidv7();
        this.categories.set(this.key(real), { id: uuidToBinary(real), name, is_system: 1, _id: id });
      }
    }
  }
  async listCategories() {
    return [...this.categories.entries()].filter(([k]) => k.startsWith(`${this.tenant()}|`)).map(([, c]) => ({ ...c, slug: String(c.name), article_count: 0, document_count: 0 }));
  }
  async findCategory(id: string) {
    const c = this.categories.get(this.key(id));
    if (!c) throw new NotFoundException('Category not found.');
    return c;
  }
  categoryIdByName(name: string) { return [...this.categories.entries()].find(([k, v]) => k.startsWith(`${this.tenant()}|`) && v.name === name)![0].split('|')[1]; }
  async insertArticle(_m: unknown, a: Row) {
    this.articles.set(this.key(a.id as Buffer), { id: a.id, category_id: a.categoryId, title: a.title, summary: a.summary, content: a.content, language_code: a.language, status: a.status, source_name: a.sourceName, source_url: a.sourceUrl, reference_note: a.referenceNote, created_by: a.userId, updated_by: a.userId, created_at: new Date(), updated_at: new Date(), published_at: a.status === 'published' ? new Date() : null });
  }
  async findArticle(id: string) {
    const a = this.articles.get(this.key(id));
    if (!a) throw new NotFoundException('Article not found.');
    return { ...a, category_name: [...this.categories.values()].find((c) => (c.id as Buffer).equals(a.category_id as Buffer))?.name };
  }
  async updateArticle(_m: unknown, id: Buffer, fields: Row, publishing: boolean) {
    const a = this.articles.get(this.key(id))!;
    const map: Record<string, string> = { categoryId: 'category_id', language: 'language_code', sourceName: 'source_name', sourceUrl: 'source_url', referenceNote: 'reference_note', updatedBy: 'updated_by' };
    for (const [k, v] of Object.entries(fields)) a[map[k] ?? k] = v;
    if (publishing && !a.published_at) a.published_at = new Date();
  }
  async tagsFor(ids: Buffer[]) { return ids.flatMap((id) => (this.tags.get(this.key(id)) ?? []).map((tag) => ({ article_id: id, tag }))); }
  async replaceTags(_m: unknown, id: Buffer, tags: string[]) { this.tags.set(this.key(id), tags); }
  async replaceChunks(_m: unknown, parent: { articleId?: Buffer; documentId?: Buffer }, chunks: string[], language: string) {
    this.chunks.set(this.key((parent.articleId ?? parent.documentId) as Buffer), chunks.map((content) => ({ content, language })));
  }
  async setChunkLanguage(_m: unknown, parent: { articleId?: Buffer; documentId?: Buffer }, language: string) {
    for (const c of this.chunks.get(this.key((parent.articleId ?? parent.documentId) as Buffer)) ?? []) c.language = language;
  }
  async listArticles(q: { status?: string; language?: string; page: number; pageSize: number }) {
    const rows = [...this.articles.entries()].filter(([k, a]) => k.startsWith(`${this.tenant()}|`) && (q.status ? a.status === q.status : a.status !== 'archived') && (!q.language || a.language_code === q.language)).map(([, a]) => ({ ...a, category_name: 'x' }));
    return { rows, total: rows.length };
  }
  async dashboardCounts() { return { articles: [], documents: [], categories: 6, recent: [] }; }
  async insertDocument(d: Row) {
    this.documents.set(this.key(d.id as Buffer), { id: d.id, category_id: d.categoryId, title: d.title, original_filename: d.filename, file_type: d.fileType, byte_size: d.byteSize, storage_key: d.storageKey, language_code: d.language, publication: d.publication, status: 'pending', error_code: null, chunk_count: 0, char_count: 0, source_name: d.sourceName, created_by: d.userId, created_at: new Date(), updated_at: new Date(), processed_at: null });
  }
  async findDocument(id: string) {
    const d = this.documents.get(this.key(id));
    if (!d) throw new NotFoundException('Document not found.');
    return { ...d, category_name: 'Sleep & Wellness' };
  }
  async updateDocument(id: Buffer, fields: Row) {
    const d = this.documents.get(this.key(id))!;
    const map: Record<string, string> = { errorCode: 'error_code', chunkCount: 'chunk_count', charCount: 'char_count', originalFilename: 'original_filename', fileType: 'file_type', byteSize: 'byte_size', language: 'language_code', categoryId: 'category_id', updatedBy: 'updated_by' };
    for (const [k, v] of Object.entries(fields)) d[map[k] ?? k] = v;
  }
  async listDocuments() { return { rows: [], total: 0 }; }
}

class MemoryStorage implements DocumentStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.files.set(key, data); }
  async get(key: string) { const f = this.files.get(key); if (!f) throw new Error('missing'); return f; }
  async delete(key: string) { this.files.delete(key); }
}

describe('article and category lifecycle (in-memory repository — service logic only)', () => {
  const setup = () => {
    const repo = new FakeRepo();
    return { repo, service: new KnowledgeContentService(repo as never, { search: jest.fn() } as never) };
  };
  const body = (categoryId: string, over: Record<string, unknown> = {}) => parseArticle({ title: 'Sleep basics', content: 'नींद अच्छी सेहत के लिए ज़रूरी है। '.repeat(3), categoryId, language: 'hi', tags: ['Sleep', 'rest'], ...over });

  it('creates the six default categories lazily and per tenant', async () => {
    const { service } = setup();
    const a = await inTenant(tenantA, () => service.listCategories());
    expect(a.categories.map((c) => c.name)).toEqual(expect.arrayContaining(['Symptoms', 'Nutrition', 'Fitness', 'Sleep & Wellness', 'McZEN Products', 'Health Education']));
    expect(a.categories).toHaveLength(6);
  });

  it('runs create → read → update → publish → archive, re-indexing chunks', async () => {
    const { repo, service } = setup();
    await inTenant(tenantA, async () => {
      await service.listCategories();
      const category = repo.categoryIdByName('Sleep & Wellness');
      const created = await service.createArticle(body(category), userA);
      expect(created).toMatchObject({ status: 'draft', language: 'hi', tags: ['sleep', 'rest'], publishedAt: null, createdBy: userA });
      expect(repo.chunks.get(`${tenantA}|${created.id}`)?.every((c) => c.language === 'hi')).toBe(true);

      const published = await service.updateArticle(created.id as string, parseArticle({ status: 'published', language: 'te' }, true), userA);
      expect(published).toMatchObject({ status: 'published', language: 'te' });
      expect(published.publishedAt).not.toBeNull();
      expect(repo.chunks.get(`${tenantA}|${created.id}`)?.every((c) => c.language === 'te')).toBe(true);

      const edited = await service.updateArticle(created.id as string, parseArticle({ content: 'ఆరోగ్యానికి నిద్ర చాలా ముఖ్యం.' }, true), userA);
      expect(edited.content).toBe('ఆరోగ్యానికి నిద్ర చాలా ముఖ్యం.');
      expect(repo.chunks.get(`${tenantA}|${created.id}`)?.[0].content).toContain('ఆరోగ్యానికి');

      const archived = await service.archiveArticle(created.id as string, userA);
      expect(archived.status).toBe('archived');
      const list = await service.listArticles({ page: 1, pageSize: 10 });
      expect(list.items).toHaveLength(0);
      expect((await service.listArticles({ page: 1, pageSize: 10, status: 'archived' })).items).toHaveLength(1);
    });
  });

  it('rejects an article in another tenant’s category', async () => {
    const { repo, service } = setup();
    const foreign = await inTenant(tenantB, async () => { await service.listCategories(); return repo.categoryIdByName('Fitness'); });
    await inTenant(tenantA, async () => {
      await service.listCategories();
      await expect(service.createArticle(body(foreign), userA)).rejects.toThrow(NotFoundException);
    });
  });

  it('tenant A cannot read, update, archive or list tenant B articles', async () => {
    const { repo, service } = setup();
    const id = await inTenant(tenantB, async () => {
      await service.listCategories();
      return (await service.createArticle(body(repo.categoryIdByName('Nutrition')), userA)).id as string;
    });
    await inTenant(tenantA, async () => {
      await expect(service.getArticle(id)).rejects.toThrow(NotFoundException);
      await expect(service.updateArticle(id, parseArticle({ title: 'x' }, true), userA)).rejects.toThrow(NotFoundException);
      await expect(service.archiveArticle(id, userA)).rejects.toThrow(NotFoundException);
      expect((await service.listArticles({ page: 1, pageSize: 10 })).items).toHaveLength(0);
    });
    await inTenant(tenantB, async () => {
      expect((await service.listArticles({ page: 1, pageSize: 10 })).items).toHaveLength(1);
    });
  });

  it('refuses to rename or delete built-in categories', async () => {
    const repo = { ensureDefaultCategories: jest.fn(), findCategory: jest.fn(async () => ({ is_system: 1, name: 'Symptoms' })), categoryUsage: jest.fn(), updateCategory: jest.fn(), deleteCategory: jest.fn() };
    const service = new KnowledgeContentService(repo as never, {} as never);
    await expect(service.updateCategory(newUuidv7(), parseCategory({ name: 'Other' }, true))).rejects.toThrow('cannot be renamed');
    await expect(service.deleteCategory(newUuidv7())).rejects.toThrow('cannot be deleted');
    expect(repo.deleteCategory).not.toHaveBeenCalled();
  });

  it('blocks deleting a category that still has content', async () => {
    const repo = { findCategory: jest.fn(async () => ({ is_system: 0 })), categoryUsage: jest.fn(async () => 2), deleteCategory: jest.fn() };
    await expect(new KnowledgeContentService(repo as never, {} as never).deleteCategory(newUuidv7())).rejects.toThrow('Move or remove');
    expect(repo.deleteCategory).not.toHaveBeenCalled();
  });
});

describe('document lifecycle (in-memory repository and storage)', () => {
  const setup = () => {
    const repo = new FakeRepo();
    const storage = new MemoryStorage();
    const service = new KnowledgeDocumentsService(repo as never, storage as never, { extract: async () => 'pdf text' });
    return { repo, storage, service };
  };
  const meta = (repo: FakeRepo) => ({ categoryId: repo.categoryIdByName('Sleep & Wellness'), language: 'hi' as const, publication: 'published' as const });
  const txt = (content: string) => ({ originalname: 'sleep.txt', size: 1, buffer: Buffer.from(content, 'utf8') });

  it('uploads, extracts, chunks and exposes no storage path', async () => {
    const { repo, storage, service } = setup();
    await inTenant(tenantA, async () => {
      await repo.ensureDefaultCategories();
      const doc = await service.upload(txt('नींद अच्छी सेहत के लिए ज़रूरी है। '.repeat(40)), meta(repo), userA);
      expect(doc).toMatchObject({ status: 'processed', fileType: 'txt', language: 'hi', publication: 'published', errorCode: null });
      expect(doc.chunkCount).toBeGreaterThan(0);
      const json = JSON.stringify(doc);
      expect(json).not.toMatch(/storage|key|path|[A-Za-z]:\\|\/tenant/i);
      expect([...storage.files.keys()][0]).toMatch(new RegExp(`^${tenantA}/`));
    });
  });

  it('processes DOCX and PDF uploads', async () => {
    const { repo, service } = setup();
    await inTenant(tenantA, async () => {
      await repo.ensureDefaultCategories();
      const docx = await service.upload({ originalname: 'a.docx', size: 1, buffer: docxWith(['ఆరోగ్యం ముఖ్యం']) }, meta(repo), userA);
      expect(docx.status).toBe('processed');
      const pdf = await service.upload({ originalname: 'a.pdf', size: 1, buffer: Buffer.from('%PDF-1.4 x') }, meta(repo), userA);
      expect(pdf.status).toBe('processed');
    });
  });

  it('rejects invalid files before anything is stored', async () => {
    const { repo, storage, service } = setup();
    await inTenant(tenantA, async () => {
      await repo.ensureDefaultCategories();
      await expect(service.upload({ originalname: 'a.pdf', size: 1, buffer: Buffer.from('nope') }, meta(repo), userA)).rejects.toThrow();
      await expect(service.upload(undefined, meta(repo), userA)).rejects.toThrow();
      await expect(service.upload(txt('x'), { ...meta(repo), categoryId: newUuidv7() }, userA)).rejects.toThrow(NotFoundException);
    });
    expect(storage.files.size).toBe(0);
  });

  it('records a safe failure for corrupt documents, then recovers on replace + reprocess', async () => {
    const { repo, service } = setup();
    await inTenant(tenantA, async () => {
      await repo.ensureDefaultCategories();
      const bad = await service.upload({ originalname: 'a.docx', size: 1, buffer: buildZip({ 'x.xml': 'y' }) }, meta(repo), userA);
      expect(bad).toMatchObject({ status: 'failed', errorCode: 'CORRUPT_DOCX', chunkCount: 0 });
      expect(bad.errorMessage).toMatch(/damaged/);
      const fixed = await service.replaceFile(bad.id as string, { originalname: 'a.docx', size: 1, buffer: docxWith(['good text']) }, userA);
      expect(fixed).toMatchObject({ status: 'processed', errorCode: null });
      expect((await service.reprocess(bad.id as string, userA)).status).toBe('processed');
    });
  });

  it('archiving removes the document from retrieval (chunks deleted)', async () => {
    const { repo, service } = setup();
    await inTenant(tenantA, async () => {
      await repo.ensureDefaultCategories();
      const doc = await service.upload(txt('Sleep hygiene guide'), meta(repo), userA);
      expect(repo.chunks.get(`${tenantA}|${doc.id}`)?.length).toBe(1);
      expect((await service.archive(doc.id as string, userA)).status).toBe('archived');
      expect(repo.chunks.get(`${tenantA}|${doc.id}`)).toEqual([]);
    });
  });

  it('prevents cross-tenant access to documents, files and downloads', async () => {
    const { repo, service } = setup();
    const id = await inTenant(tenantB, async () => {
      await repo.ensureDefaultCategories();
      return (await service.upload(txt('tenant B secret'), meta(repo), userA)).id as string;
    });
    await inTenant(tenantA, async () => {
      await expect(service.get(id)).rejects.toThrow(NotFoundException);
      await expect(service.download(id)).rejects.toThrow(NotFoundException);
      await expect(service.reprocess(id, userA)).rejects.toThrow(NotFoundException);
      await expect(service.archive(id, userA)).rejects.toThrow(NotFoundException);
      await expect(service.replaceFile(id, txt('overwrite'), userA)).rejects.toThrow(NotFoundException);
    });
    await inTenant(tenantB, async () => {
      const { data, filename } = await service.download(id);
      expect(data.toString()).toBe('tenant B secret');
      expect(filename).toBe('sleep.txt');
    });
  });
});

describe('knowledge_search tool integration', () => {
  const hit = { kind: 'article' as const, sourceId: newUuidv7(), title: 'Sleep basics', category: 'Sleep & Wellness', language: 'en', excerpt: 'Aim for 7-9 hours.', score: 1, source: 'knowledge://article/x', sourceName: null, sourceUrl: null };

  it('returns tenant knowledge with source references for a real tenant', async () => {
    const retriever = { search: jest.fn(async () => [hit]) };
    const tool = createKnowledgeSearchTool(new KnowledgeService(retriever));
    const out = await inTenant(tenantA, () => tool.handler({ query: 'sleep', tenantId: tenantB }, { tenantId: tenantA, permissions: [], requestId: 'r' } as never, new AbortController().signal));
    expect(out).toEqual([{ id: `article:${hit.sourceId}`, title: 'Sleep basics (Sleep & Wellness)', content: 'Aim for 7-9 hours.\n[language: en]', source: 'knowledge://article/x' }]);
    // the AI-supplied tenantId is ignored; the retriever never receives a tenant at all
    expect(retriever.search).toHaveBeenCalledWith({ query: 'sleep', limit: 5 });
  });

  it('fails closed when the trusted context tenant and the verified request tenant differ', async () => {
    const retriever = { search: jest.fn(async () => [hit]) };
    const service = new KnowledgeService(retriever);
    await expect(Promise.resolve().then(() => inTenant(tenantB, () => service.search('sleep', { tenantId: tenantA })))).rejects.toThrow('unavailable');
    await expect(Promise.resolve().then(() => service.search('sleep', { tenantId: tenantA }))).rejects.toThrow('unavailable');
    expect(retriever.search).not.toHaveBeenCalled();
  });

  it('fails closed for a real tenant when no retriever is configured', async () => {
    await expect(Promise.resolve().then(() => inTenant(tenantA, () => new KnowledgeService().search('sleep', { tenantId: tenantA })))).rejects.toThrow('unavailable');
  });

  it('keeps the Phase 5 demo documents for non-UUID development tenants', () => {
    const service = new KnowledgeService();
    expect(service.search('earning plan')).toHaveLength(1);
    expect(service.search('earning plan', { tenantId: 'tenant-a' })).toHaveLength(1);
  });

  it('propagates retrieval errors so the agent reports a safe failure', async () => {
    const service = new KnowledgeService({ search: jest.fn(async () => { throw new Error('db down'); }) });
    await expect(inTenant(tenantA, async () => service.search('sleep', { tenantId: tenantA }))).rejects.toThrow('db down');
  });
});

export { ExtractionError };

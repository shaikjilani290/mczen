import { chunkText, sanitizeText, slugify, tokenize } from './text-utils';
import {
  parseArticle, parseArticleQuery, parseCategory, parseDocumentMeta, parseSearchQuery, parseTags,
} from './knowledge.dto';
import { newUuidv7 } from '../common/ids/uuid';

const HINDI = 'नींद अच्छी सेहत के लिए बहुत ज़रूरी है। रोज़ाना सात से आठ घंटे की नींद लें। सोने से पहले स्क्रीन का उपयोग कम करें।';
const TELUGU = 'ఆరోగ్యానికి నిద్ర చాలా ముఖ్యం. ప్రతిరోజూ ఏడు నుండి ఎనిమిది గంటలు నిద్రపోవాలి. నిద్రకు ముందు స్క్రీన్ వాడకాన్ని తగ్గించండి.';

describe('text utilities', () => {
  it('sanitises control characters, bidi overrides and newlines but keeps Indic text intact', () => {
    const dirty = `a\u0000b\u202ec\r\n\r\n\r\n\r\n${HINDI}`;
    const clean = sanitizeText(dirty);
    expect(clean).toBe(`abc\n\n${HINDI}`);
    expect(sanitizeText(TELUGU)).toBe(TELUGU);
  });

  it('does not interpret HTML (it is stored as inert plain text)', () => {
    expect(sanitizeText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });

  it('tokenises Hindi and Telugu words without splitting combining marks', () => {
    expect(tokenize('नींद और सेहत')).toEqual(expect.arrayContaining(['नींद', 'सेहत']));
    expect(tokenize('ఆరోగ్యానికి నిద్ర')).toEqual(['ఆరోగ్యానికి', 'నిద్ర']);
    expect(tokenize('What is the best sleep?')).toEqual(['best', 'sleep']);
  });

  it('chunks long English text within limits and with overlap', () => {
    const sentence = 'Regular exercise supports general wellness and healthy habits. ';
    const chunks = chunkText(sentence.repeat(80), { target: 300, max: 400, overlap: 60 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 400)).toBe(true);
    expect(chunks.join(' ')).toContain('Regular exercise');
  });

  it('splits Hindi on the danda and Telugu on full stops', () => {
    const hindi = chunkText(`${HINDI} `.repeat(30), { target: 200, max: 300, overlap: 30 });
    expect(hindi.length).toBeGreaterThan(3);
    expect(hindi.every((c) => c.length <= 300)).toBe(true);
    expect(hindi[0]).toContain('नींद');
    const telugu = chunkText(`${TELUGU} `.repeat(30), { target: 200, max: 300, overlap: 30 });
    expect(telugu.length).toBeGreaterThan(3);
    expect(telugu[0]).toContain('నిద్ర');
  });

  it('hard-splits a single oversized run and returns [] for blank input', () => {
    expect(chunkText('x'.repeat(5000), { target: 900, max: 1400 }).every((c) => c.length <= 1400)).toBe(true);
    expect(chunkText('  \n\n ')).toEqual([]);
  });

  it('creates stable slugs including for non-Latin names', () => {
    expect(slugify('Sleep & Wellness')).toBe('sleep-wellness');
    expect(slugify('నిద్ర')).toBe('నిద్ర');
    expect(slugify('!!!')).toBe('category');
  });
});

describe('knowledge DTO parsers', () => {
  const categoryId = newUuidv7();
  const valid = { title: ' Sleep basics ', content: HINDI, categoryId, language: 'hi', tags: ['Sleep', 'sleep', 'Rest'] };

  it('accepts a valid article, applies defaults and normalises tags', () => {
    const out = parseArticle(valid);
    expect(out).toMatchObject({ title: 'Sleep basics', language: 'hi', status: 'draft', tags: ['sleep', 'rest'] });
    expect(parseArticle({ title: 't', content: 'c', categoryId }).language).toBe('en');
  });

  it('rejects tenant identifiers and unknown keys anywhere', () => {
    expect(() => parseArticle({ ...valid, tenantId: newUuidv7() })).toThrow();
    expect(() => parseArticle({ ...valid, tenant_id: 'x' })).toThrow();
    expect(() => parseCategory({ name: 'x', tenantId: newUuidv7() })).toThrow();
    expect(() => parseDocumentMeta({ categoryId, tenantId: newUuidv7() })).toThrow();
    expect(() => parseArticleQuery({ tenantId: newUuidv7() })).toThrow();
    expect(() => parseSearchQuery({ q: 'x', tenantId: newUuidv7() })).toThrow();
  });

  it('rejects bad languages, statuses, ids, urls and oversized tag lists', () => {
    expect(() => parseArticle({ ...valid, language: 'fr' })).toThrow();
    expect(() => parseArticle({ ...valid, status: 'archived' })).toThrow();
    expect(() => parseArticle({ ...valid, categoryId: 'nope' })).toThrow();
    expect(() => parseArticle({ ...valid, sourceUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => parseArticle({ ...valid, sourceUrl: 'https://user:pw@example.com' })).toThrow();
    expect(parseArticle({ ...valid, sourceUrl: 'https://example.com/a' }).sourceUrl).toBe('https://example.com/a');
    expect(() => parseTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toThrow();
    expect(() => parseArticle({})).toThrow();
  });

  it('requires at least one field for partial updates', () => {
    expect(() => parseArticle({}, true)).toThrow();
    expect(parseArticle({ status: 'published' }, true)).toEqual({ status: 'published' });
  });

  it('bounds pagination and search limits', () => {
    expect(parseArticleQuery({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(() => parseArticleQuery({ pageSize: '500' })).toThrow();
    expect(() => parseArticleQuery({ page: '0' })).toThrow();
    expect(parseSearchQuery({ q: 'నిద్ర', language: 'te' })).toMatchObject({ q: 'నిద్ర', language: 'te', limit: 8 });
    expect(() => parseSearchQuery({})).toThrow();
    expect(() => parseSearchQuery({ q: 'x', limit: '99' })).toThrow();
  });

  it('parses multipart metadata even when the body has a null prototype', () => {
    const body = Object.assign(Object.create(null), { categoryId, language: 'te', publication: 'published' });
    expect(parseDocumentMeta(body)).toMatchObject({ language: 'te', publication: 'published' });
    expect(() => parseDocumentMeta({})).toThrow();
  });
});

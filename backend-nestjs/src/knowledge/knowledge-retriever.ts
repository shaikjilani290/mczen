import { Injectable } from '@nestjs/common';
import { binaryToUuid } from '../common/ids/uuid';
import { KnowledgeRepository, Row } from './knowledge.repository';
import { KnowledgeLanguage } from './knowledge.dto';
import { tokenize } from './text-utils';

export const KNOWLEDGE_RETRIEVER = Symbol('KNOWLEDGE_RETRIEVER');

export interface KnowledgeSearchParams {
  query: string;
  categoryId?: string;
  language?: KnowledgeLanguage;
  limit?: number;
}

export interface KnowledgeHit {
  kind: 'article' | 'document';
  sourceId: string;
  title: string;
  category: string | null;
  language: string;
  excerpt: string;
  score: number;
  /** Stable reference for citations; never a filesystem path. */
  source: string;
  sourceName: string | null;
  sourceUrl: string | null;
}

/**
 * Retrieval contract. The tenant is NOT a parameter: implementations must take
 * it from the verified request context so callers cannot choose it. A vector
 * provider can implement this interface later without touching callers.
 */
export interface KnowledgeRetriever {
  search(params: KnowledgeSearchParams): Promise<KnowledgeHit[]>;
}

export const EXCERPT_CHARS = 600;
const OVERFETCH = 40;

function excerpt(content: string): string {
  return content.length <= EXCERPT_CHARS ? content : `${content.slice(0, EXCERPT_CHARS).trimEnd()}…`;
}

/** Fraction of query terms found (as substrings, so Indic word forms still match) in the text. */
export function termOverlap(terms: string[], text: string): number {
  if (terms.length === 0) return 0;
  const haystack = text.normalize('NFC').toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}

/** Re-ranks FULLTEXT rows, drops rows sharing no query term, keeps the best chunk per source. */
export function rankHits(rows: Row[], query: string, limit: number): KnowledgeHit[] {
  const terms = tokenize(query);
  const maxScore = Math.max(...rows.map((r) => Number(r.score) || 0), 0) || 1;
  const best = new Map<string, KnowledgeHit>();
  for (const row of rows) {
    const content = String(row.content ?? '');
    const isArticle = row.article_id != null;
    const title = String(isArticle ? row.article_title : row.document_title);
    const overlap = termOverlap(terms, content);
    const titleOverlap = termOverlap(terms, title);
    if (overlap === 0 && titleOverlap === 0) continue;
    const sourceId = binaryToUuid((isArticle ? row.article_id : row.document_id) as Uint8Array);
    const kind = isArticle ? 'article' : 'document';
    const score = 0.5 * ((Number(row.score) || 0) / maxScore) + 0.4 * overlap + 0.1 * titleOverlap;
    const key = `${kind}:${sourceId}`;
    if ((best.get(key)?.score ?? -1) >= score) continue;
    const sourceUrl = isArticle ? (row.article_source_url as string | null) : null;
    best.set(key, {
      kind,
      sourceId,
      title,
      category: (row.category_name as string | null) ?? null,
      language: String(row.language_code),
      excerpt: excerpt(content),
      score: Math.round(score * 1000) / 1000,
      source: sourceUrl || `knowledge://${kind}/${sourceId}`,
      sourceName: ((isArticle ? row.article_source_name : row.document_source_name) as string | null) ?? null,
      sourceUrl,
    });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Builds the FULLTEXT query from sanitised tokens only, so operators in user text are inert. */
export function buildMatchQuery(query: string): string {
  return tokenize(query).join(' ');
}

@Injectable()
export class MysqlKnowledgeRetriever implements KnowledgeRetriever {
  constructor(private readonly repository: KnowledgeRepository) {}

  async search(params: KnowledgeSearchParams): Promise<KnowledgeHit[]> {
    const match = buildMatchQuery(params.query);
    if (!match) return [];
    const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
    const rows = await this.repository.searchChunks({
      match,
      categoryId: params.categoryId,
      language: params.language,
      limit: Math.max(OVERFETCH, limit * 4),
    });
    return rankHits(rows, params.query, limit);
  }
}

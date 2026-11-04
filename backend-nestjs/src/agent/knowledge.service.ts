import { Inject, Injectable, Optional } from '@nestjs/common';
import { isUuidv7 } from '../common/ids/uuid';
import { tenantContextStore } from '../common/tenant/tenant-context.store';
import { KNOWLEDGE_RETRIEVER } from '../knowledge/knowledge-retriever';
import type { KnowledgeRetriever } from '../knowledge/knowledge-retriever';

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source: string;
}

@Injectable()
export class KnowledgeService {
  constructor(@Optional() @Inject(KNOWLEDGE_RETRIEVER) private readonly retriever?: KnowledgeRetriever) {}

  /**
   * Tenant knowledge search for the knowledge_search tool. For real (UUIDv7)
   * tenants it queries the tenant's published knowledge only. The tenant comes
   * from the trusted execution context and must match the verified request
   * context; otherwise the search fails closed. Non-UUID demo tenants keep the
   * Phase 5 demonstration documents.
   */
  search(query: string, context?: { tenantId: string }): KnowledgeDocument[] | Promise<KnowledgeDocument[]> {
    if (context && isUuidv7(context.tenantId)) return this.searchTenantKnowledge(query, context.tenantId);
    return this.searchDemo(query);
  }

  private async searchTenantKnowledge(query: string, tenantId: string): Promise<KnowledgeDocument[]> {
    if (!this.retriever || tenantContextStore.get()?.tenantId !== tenantId) {
      throw new Error('Tenant knowledge is unavailable.');
    }
    const hits = await this.retriever.search({ query, limit: 5 });
    return hits.map((hit) => ({
      id: `${hit.kind}:${hit.sourceId}`,
      title: hit.category ? `${hit.title} (${hit.category})` : hit.title,
      content: `${hit.excerpt}\n[language: ${hit.language}]`,
      source: hit.source,
    }));
  }

  private readonly documents: KnowledgeDocument[] = [
    {
      id: 'plan-001',
      title: 'Example earning plan',
      content:
        'This is demonstration data only. Replace it with the client application’s actual earning plan, eligibility requirements, benefits, conditions, and disclosures.',
      source: 'demo://earning-plan',
    },
    {
      id: 'product-001',
      title: 'Example product information',
      content:
        'This is demonstration data only. Replace it with the actual product description, features, price, availability, and specifications.',
      source: 'demo://product',
    },
  ];

  
private searchDemo(query: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2);

  const terms = normalize(query);

  if (terms.length === 0) {
    return [];
  }

  const scored = this.documents.map((document) => {
    const titleTerms = normalize(document.title);
    const contentTerms = normalize(document.content);

    const score = terms.reduce((total, term) => {
      const inTitle = titleTerms.includes(term);
      const inContent = contentTerms.includes(term);

      return total + (inTitle ? 3 : inContent ? 1 : 0);
    }, 0);

    return { document, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.document);
}

}
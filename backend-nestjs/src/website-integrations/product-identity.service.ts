import { Injectable } from '@nestjs/common';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { WebsiteIntegrationRepository } from './website-integration.repository';

export interface ProductIdentity {
  externalProductId: string;
  name: string;
}

export function normalizeProductName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function productMentions(text: string, vocabulary: readonly ProductIdentity[]): ProductIdentity[] {
  const normalized = ` ${normalizeProductName(text)} `;
  return vocabulary.filter(product => {
    const name = normalizeProductName(product.name);
    return name.length > 0 && normalized.includes(` ${name} `);
  });
}

@Injectable()
export class ProductIdentityService {
  constructor(private readonly repository: WebsiteIntegrationRepository) {}

  async vocabulary(context: AgentExecutionContext): Promise<ProductIdentity[]> {
    if (!context.merchant || !context.assistantId || !context.permissions.includes('products:read')) return [];
    return this.repository.productVocabulary(context.tenantId, context.assistantId, context.merchant.integrationId);
  }
}

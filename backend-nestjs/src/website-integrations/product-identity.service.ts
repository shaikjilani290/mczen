import { Injectable } from '@nestjs/common';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { WebsiteIntegrationRepository } from './website-integration.repository';

export interface ProductIdentity {
  externalProductId: string;
  name: string;
  aliases?: readonly string[];
}

const aliasData: unknown = require('./product-aliases.json');
if (aliasData === null || typeof aliasData !== 'object' || Array.isArray(aliasData) ||
    !Object.values(aliasData).every(value => Array.isArray(value) && value.every(name => typeof name === 'string'))) {
  throw new Error('Product alias configuration must contain lists of product spellings.');
}
const aliasEntries: [string, unknown][] = Object.entries(aliasData);

export function normalizeProductName(name: string): string {
  return name.normalize('NFKD').toLowerCase()
    .replace(/[\u093c\u0c3c\u094d\u0c4d]/gu, '')
    .replace(/\u0901/gu, '\u0902').replace(/[\u0c00\u0c01]/gu, '\u0c02')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function productNames(product: ProductIdentity): string[] {
  const configured: unknown = aliasEntries.find(([key]) =>
    normalizeProductName(key) === normalizeProductName(product.name))?.[1];
  const aliases = Array.isArray(configured) ? configured.filter((name): name is string => typeof name === 'string') : [];
  return [product.name, ...(product.aliases ?? []), ...aliases].map(normalizeProductName).filter(Boolean);
}

export function productMentions(text: string, vocabulary: readonly ProductIdentity[]): ProductIdentity[] {
  const normalized = ` ${normalizeProductName(text)} `;
  const mentions: Array<{ product: ProductIdentity; start: number; end: number }> = [];
  for (const product of vocabulary) {
    for (const name of productNames(product)) {
      const needle = ` ${name} `;
      let start = normalized.indexOf(needle);
      while (start !== -1) {
        mentions.push({ product, start, end: start + needle.length });
        start = normalized.indexOf(needle, start + 1);
      }
    }
  }
  // A pack name can contain its base product name; retain only the longest mention at that position.
  const explicit = mentions.filter(mention => !mentions.some(other =>
    other.start <= mention.start && other.end >= mention.end &&
    (other.start < mention.start || other.end > mention.end)));
  return vocabulary.filter(product => explicit.some(mention => mention.product === product));
}

export function canonicalizeProductNames(text: string, vocabulary: readonly ProductIdentity[]): string {
  const names = new Map<string, Map<string, string>>();
  let maxWords = 0;
  for (const product of vocabulary) {
    for (const name of productNames(product)) {
      const matches = names.get(name) ?? new Map<string, string>();
      matches.set(product.externalProductId, product.name);
      names.set(name, matches);
      maxWords = Math.max(maxWords, name.split(' ').length);
    }
  }
  if (!maxWords) return text;
  const words = [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)];
  let output = '';
  let copiedUntil = 0;
  for (let index = 0; index < words.length; index++) {
    const start = words[index].index;
    for (let width = Math.min(maxWords, words.length - index); width > 0; width--) {
      const last = words[index + width - 1];
      const end = last.index + last[0].length;
      const matches = names.get(normalizeProductName(text.slice(start, end)));
      if (!matches) continue;
      // Do not turn a shared alias into an arbitrary product, even if a shorter name matches.
      if (matches.size !== 1) { index += width - 1; break; }
      const name = matches.values().next().value;
      if (name === undefined) break;
      output += text.slice(copiedUntil, start) + name;
      copiedUntil = end;
      index += width - 1;
      break;
    }
  }
  return output + text.slice(copiedUntil);
}

export interface ProductResolution {
  status: 'resolved' | 'clarify' | 'none';
  score: number;
  candidates: readonly ProductIdentity[];
}

function editSimilarity(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    }
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length, 1);
}

export function resolveProduct(text: string, vocabulary: readonly ProductIdentity[]): ProductResolution {
  const exact = productMentions(text, vocabulary);
  if (exact.length) return { status: exact.length === 1 ? 'resolved' : 'clarify', score: 1, candidates: exact };
  const words = normalizeProductName(text).split(' ').filter(Boolean);
  // Indic product spellings require an exact catalogue name or configured alias.
  const indicScript = /[\p{Script=Devanagari}\p{Script=Telugu}]/u;
  const windows: string[] = [];
  for (let start = 0; start < words.length; start++) {
    for (let width = 1; width <= 3 && start + width <= words.length; width++) {
      const window = words.slice(start, start + width).join(' ');
      if (!indicScript.test(window)) windows.push(window);
    }
  }
  let score = 0;
  let candidates: ProductIdentity[] = [];
  for (const product of vocabulary) {
    let best = 0;
    for (const name of productNames(product)) {
      if (indicScript.test(name)) continue;
      for (const window of windows) best = Math.max(best, editSimilarity(window, name));
    }
    if (best > score) { score = best; candidates = [product]; }
    else if (best === score && best > 0) candidates.push(product);
  }
  if (score < 0.6) return { status: 'none', score, candidates: [] };
  return { status: score >= 0.8 && candidates.length === 1 ? 'resolved' : 'clarify', score, candidates };
}

@Injectable()
export class ProductIdentityService {
  constructor(private readonly repository: WebsiteIntegrationRepository) {}

  async vocabulary(context: AgentExecutionContext): Promise<ProductIdentity[]> {
    if (!context.merchant || !context.assistantId || !context.permissions.includes('products:read')) return [];
    return this.repository.productVocabulary(context.tenantId, context.assistantId, context.merchant.integrationId);
  }
}

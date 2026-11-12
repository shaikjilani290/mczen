import { Injectable, Optional } from '@nestjs/common';
import { tokenize } from '../knowledge/text-utils';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { MerchantCartService } from './merchant-cart.service';
import { WebsiteIntegrationRepository } from './website-integration.repository';

type Row = Record<string, unknown>;

export interface WebsiteKnowledgeAnswer {
  answer: string;
  toolCalls: Array<{ name: string; resultCount: number }>;
  sources: Array<{ id: string; title: string; source: string }>;
  products: Array<{
    externalProductId: string;
    name: string;
    productUrl: string;
    images: string[];
    price: number | null;
    salePrice: number | null;
    currency: string | null;
  }>;
}

const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['price', 'cost', 'pricing', 'how much', 'amount'],
  ['stock', 'availability', 'available', 'in stock', 'inventory'],
  ['shipping', 'delivery', 'dispatch', 'ship'],
  ['return', 'returns', 'refund', 'refunds', 'exchange', 'money back'],
  ['ingredients', 'ingredient', 'composition', 'made of', 'contains'],
  ['specifications', 'specification', 'specs', 'features', 'details'],
  ['faq', 'faqs', 'frequently asked', 'common questions', 'questions'],
  ['policy', 'policies', 'terms', 'conditions'],
  ['compare', 'comparison', 'versus', 'vs', 'difference'],
];

const STOP_WORDS = new Set([
  'about', 'and', 'are', 'can', 'could', 'do', 'does', 'for', 'get', 'give', 'have', 'i', 'is',
  'me', 'my', 'of', 'please', 'show', 'tell', 'the', 'this', 'to', 'what', 'which', 'with',
  'product', 'products', 'price', 'prices', 'cost', 'costs', 'pricing', 'stock', 'stocks', 'availability', 'available',
  'variant', 'variants', 'specification', 'specifications', 'specs', 'ingredients', 'ingredient',
  'composition', 'features', 'feature', 'details', 'detail', 'compare', 'comparison', 'versus',
  'difference', 'cheaper', 'recommend', 'suggest', 'best', 'catalogue', 'catalog', 'current',
  'live', 'latest', 'today', 'now', 'actual', 'recorded',
]);

function normalized(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

function queryVariants(query: string): string[] {
  const variants = new Set<string>([query.trim()]);
  const lowered = query.toLowerCase();
  for (const group of SYNONYM_GROUPS) {
    if (!group.some((term) => lowered.includes(term))) continue;
    variants.add(group.slice(0, 3).join(' '));
  }
  return [...variants].filter(Boolean).slice(0, 5);
}

function relevance(query: string, text: string): number {
  const terms = tokenize(query).filter((term) => !STOP_WORDS.has(term));
  if (!terms.length) return 0;
  const haystack = normalized(text);
  const found = terms.filter((term) => haystack.includes(term)).length;
  return found / terms.length;
}

function pageRelevance(query: string, text: string): number {
  const terms = tokenize(query).filter((term) => !STOP_WORDS.has(term));
  const direct = relevance(query, text);
  const expanded = Math.max(0, ...queryVariants(query).slice(1).map((variant) => relevance(variant, text)));
  return Math.max(direct, expanded * Math.min(1, 2 / Math.max(terms.length, 1)));
}

function budgetConstraint(question: string): { maxPrice: number; currency: string } | undefined {
  const match = question.match(
    /\b(?:under|below|up to|less than|within)\s*(₹|INR|Rs\.?|USD|EUR|GBP)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  if (!match) return undefined;
  const maxPrice = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(maxPrice) || maxPrice < 0) return undefined;
  const currency = /^(?:₹|INR|Rs\.?)$/i.test(match[1]) ? 'INR' : match[1].toUpperCase();
  return { maxPrice, currency };
}

function asRecord(value: unknown): Row {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Row : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function excerpt(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isCartAction(question: string): boolean {
  return /\b(?:add|remove|delete|update|change|increase|decrease)\b.{0,50}\b(?:cart|basket)\b/i.test(question);
}

function websiteQuery(question: string, hasMerchantSession: boolean): boolean {
  return hasMerchantSession || /\b(products?|catalog(?:ue)?|category|categories|prices?|costs?|stock|availability|variants?|specifications?|specs?|ingredients?|composition|features?|compare|comparison|versus|vs|difference|faqs?|polic(?:y|ies)|refunds?|returns?|shipping|delivery|warrant(?:y|ies)|contact|about|hours|address|orders?|checkout|check out|payment|purchase|money back|send it back|exchange)\b/i.test(question);
}

function complexQuestion(question: string): boolean {
  return question.length > 420 || /\b(analy[sz]e|forecast|design a plan|multi[- ]step|in depth|research)\b/i.test(question);
}

function sourceForProduct(product: Row): { id: string; title: string; source: string } | undefined {
  const url = product.productUrl;
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return { id: parsed.href, title: textValue(product.name, 'Product'), source: parsed.href };
  } catch {
    return undefined;
  }
}

function productCard(product: Row): WebsiteKnowledgeAnswer['products'][number] | undefined {
  const source = sourceForProduct(product);
  if (!source || typeof product.externalProductId !== 'string' || typeof product.name !== 'string') return undefined;
  const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    externalProductId: product.externalProductId,
    name: product.name,
    productUrl: source.source,
    images: Array.isArray(product.images)
      ? product.images.filter((image): image is string => {
        if (typeof image !== 'string') return false;
        try {
          const parsed = new URL(image);
          return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
        } catch {
          return false;
        }
      }).slice(0, 3)
      : [],
    price: amount(product.price),
    salePrice: amount(product.salePrice),
    currency: typeof product.currency === 'string' && /^[A-Z]{3}$/.test(product.currency) ? product.currency : null,
  };
}

function amountText(product: Row): string {
  const amount = typeof product.salePrice === 'number' ? product.salePrice : product.price;
  if (typeof amount !== 'number') return 'price not supplied';
  return `${amount} ${typeof product.currency === 'string' ? product.currency : ''}`.trim();
}

function sourceFreshness(product: Row): string {
  const updatedAt = product.updatedAt;
  if (updatedAt instanceof Date && Number.isFinite(updatedAt.getTime())) {
    return ` Source update: ${updatedAt.toISOString()}.`;
  }
  if (typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt))) {
    return ` Source update: ${new Date(updatedAt).toISOString()}.`;
  }
  return ' Source update time was not supplied.';
}

@Injectable()
export class WebsiteKnowledgeEngine {
  constructor(
    private readonly repository: WebsiteIntegrationRepository,
    @Optional() private readonly merchant?: MerchantCartService,
  ) {}

  async answer(
    question: string,
    context: AgentExecutionContext,
    allowLlmFallback = false,
  ): Promise<WebsiteKnowledgeAnswer | undefined> {
    const trimmed = question.trim();
    if (!trimmed || isCartAction(trimmed) || !websiteQuery(trimmed, Boolean(context.merchant))) return undefined;
    if (allowLlmFallback && complexQuestion(trimmed)) return undefined;

    const result: WebsiteKnowledgeAnswer = { answer: '', toolCalls: [], sources: [], products: [] };
    if (/^(hi|hello|hey|good morning|good afternoon|good evening)[!. ]*$/i.test(trimmed)) {
      result.answer = 'Hello! Ask me about products, specifications, prices, availability, shipping, returns, or website policies.';
      return result;
    }

    if (!context.assistantId) {
      result.answer = 'I could not identify a connected website for this request. Please contact the website administrator.';
      return result;
    }

    const needsProduct = Boolean(context.merchant) ||
      /\b(products?|catalog(?:ue)?|category|categories|prices?|costs?|stock|availability|variants?|specifications?|specs?|ingredients?|composition|features?|compare|comparison|versus|vs|difference|cheaper|recommend|suggest)\b/i.test(trimmed);
    const needsKnowledge = /\b(faqs?|polic(?:y|ies)|refunds?|returns?|shipping|delivery|warrant(?:y|ies)|contact|about|hours|address|terms|conditions|orders?|checkout|check out|payment|purchase|money back|send it back|exchange)\b/i.test(trimmed);
    if (needsProduct && !context.permissions.includes('products:read')) {
      result.answer = 'Product information is not available in this assistant session.';
      return result;
    }
    if (needsKnowledge && !context.permissions.includes('knowledge:read')) {
      result.answer = 'Website information is not available in this assistant session.';
      return result;
    }

    const integrationId = context.merchant?.integrationId;
    const wantsComparison = /\b(compare|comparisons?|versus|vs\.?|difference|which is cheaper)\b/i.test(trimmed);
    const wantsPolicy = /\b(faqs?|polic(?:y|ies)|refunds?|returns?|shipping|delivery|warrant(?:y|ies)|contact|about|hours|address|terms|conditions|orders?|checkout|check out|payment|purchase|money back|send it back|exchange)\b/i.test(trimmed);

    if (wantsPolicy || (!needsProduct && needsKnowledge)) {
      const pageType = /\b(faqs?|frequently asked|common questions|orders?|checkout|check out|payment|purchase)\b/i.test(trimmed) ? 'faq'
        : /\b(polic(?:y|ies)|refunds?|returns?|shipping|delivery|warrant(?:y|ies)|terms|conditions|money back|send it back|exchange)\b/i.test(trimmed) ? 'policy' : null;
      const pages = await this.searchPages(context.tenantId, context.assistantId, trimmed, pageType, integrationId);
      result.toolCalls.push({ name: pageType === 'faq' ? 'search_website_faqs' : 'search_website_content', resultCount: pages.length });
      if (pages.length) {
        result.answer = pages.slice(0, 2).map((page) => {
          const title = textValue(page.title, 'Website information');
          const content = excerpt(page.excerpt ?? page.metaDescription, 600);
          const url = typeof page.url === 'string' ? page.url : '';
          if (url) result.sources.push({ id: url, title, source: url });
          return `${title}: ${content || 'The connected page contains no readable excerpt.'}`;
        }).join('\n\n');
        return result;
      }
      if (wantsPolicy) {
        result.answer = 'I could not verify that information in the connected website data. Please rephrase your question or ask about a specific product or policy.';
        return result;
      }
    }

    const selectedId = context.merchant && this.merchant
      ? await this.merchant.selected(context, undefined, /\b(this|that|it|its|selected)\b/i.test(trimmed))
      : undefined;
    const asksReference = /\b(this|that|it|its|selected)\b/i.test(trimmed);
    if (asksReference && selectedId && !wantsComparison) {
      const products = await this.repository.searchProducts(context.tenantId, context.assistantId, {
        ids: [selectedId], ...(integrationId ? { integrationId } : {}), limit: 1,
      });
      result.toolCalls.push({ name: 'get_product_details', resultCount: products.length });
      if (products.length) return this.answerProducts(trimmed, products, result, context);
    }

    if (needsProduct || context.merchant) {
      const hasSearchTerms = tokenize(trimmed).some((term) => !STOP_WORDS.has(term));
      const catalogueBrowse = /\b(show|list|browse|catalog(?:ue)?|do you sell|what products? (?:are )?(?:available|there|do you have)|what do you have|best products|all products|available products)\b/i.test(trimmed);
      if (!hasSearchTerms && !catalogueBrowse && !selectedId && !wantsComparison) {
        result.answer = 'Which product should I check? Please provide a product name.';
        return result;
      }
      const budget = budgetConstraint(trimmed);
      if (budget) {
        const products = await this.repository.searchProducts(context.tenantId, context.assistantId, {
          maxPrice: budget.maxPrice,
          currency: budget.currency,
          ...(integrationId ? { integrationId } : {}),
          limit: 5,
        });
        result.toolCalls.push({ name: 'search_products', resultCount: products.length });
        if (!products.length) {
          result.answer = `I could not find active ${budget.currency} products at or below ${budget.maxPrice} in the connected catalogue.`;
          return result;
        }
        return this.answerProducts(trimmed, products, result, context);
      }
      const products = wantsComparison
        ? await this.resolveComparison(trimmed, context.tenantId, context.assistantId, integrationId)
        : await this.searchProducts(trimmed, context.tenantId, context.assistantId, integrationId);
      result.toolCalls.push({ name: wantsComparison ? 'compare_products' : 'search_products', resultCount: products.length });
      if (wantsComparison && products.length !== 2) {
        result.answer = 'Which two product names should I compare? I could not uniquely identify both from the connected catalogue.';
        return result;
      }
      if (products.length) {
        return this.answerProducts(trimmed, products, result, context);
      }
    }

    if (!result.answer) {
      result.answer = 'I could not verify that information in the connected website data. Please rephrase your question or ask about a specific product or policy.';
    }
    return result;
  }

  private async searchProducts(query: string, tenantId: string, assistantId: string, integrationId?: string): Promise<Row[]> {
    const terms = tokenize(query).filter((term) => !STOP_WORDS.has(term));
    const variants: Array<string | undefined> = terms.length ? queryVariants(query) : [undefined];
    const found = new Map<string, Row>();
    for (const variant of variants) {
      const rows = await this.repository.searchProducts(tenantId, assistantId, {
        ...(variant ? { query: variant } : {}), ...(integrationId ? { integrationId } : {}), limit: 10,
      });
      for (const row of rows) {
        if (typeof row.externalProductId === 'string') found.set(row.externalProductId, row);
      }
    }
    if (!terms.length) return [...found.values()].slice(0, 5);
    const queryText = normalized(query);
    const exactNames = [...found.values()].filter((row) => {
      const name = normalized(textValue(row.name));
      return name.length > 0 && queryText.includes(name);
    });
    if (exactNames.length) {
      const longestName = Math.max(...exactNames.map((row) => normalized(textValue(row.name)).length));
      const mostSpecific = exactNames.filter((row) => normalized(textValue(row.name)).length === longestName);
      if (mostSpecific.length === 1) return mostSpecific;
    }
    return [...found.values()]
      .map((row) => ({
        row,
        score: Math.max(...queryVariants(query).map((variant) =>
          relevance(variant, [
            textValue(row.name),
            textValue(row.description),
            textValue(row.category),
            JSON.stringify(asRecord(row.attributes)),
          ].join(' ')))),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ row }) => row);
  }

  private async resolveComparison(
    question: string,
    tenantId: string,
    assistantId: string,
    integrationId?: string,
  ): Promise<Row[]> {
    const phrase = question
      .replace(/^(?:please\s+)?(?:compare|comparison|what(?:'s| is) the difference between|difference between|which is cheaper)\s+/i, '')
      .replace(/[?.!]+$/, '');
    const names = phrase.split(/\s+(?:and|or|versus|vs\.?)\s+/i)
      .map((part) => part.replace(/\b(product|products|the|a|an|please|compare|between|price|cost|cheaper|specs?)\b/gi, '').trim())
      .filter(Boolean);
    if (names.length !== 2) return [];
    const resolved: Row[] = [];
    for (const name of names) {
      const matches = await this.repository.searchProducts(tenantId, assistantId, {
        query: name, ...(integrationId ? { integrationId } : {}), limit: 5,
      });
      const exact = matches.filter((row) => normalized(textValue(row.name)) === normalized(name));
      const options = exact.length ? exact : matches.filter((row) => relevance(name, textValue(row.name)) >= 0.6);
      if (options.length !== 1) return [];
      resolved.push(options[0]);
    }
    return resolved[0].externalProductId !== resolved[1].externalProductId ? resolved : [];
  }

  private async searchPages(
    tenantId: string,
    assistantId: string,
    query: string,
    pageType: string | null,
    integrationId?: string,
  ): Promise<Row[]> {
    const found = new Map<string, Row>();
    for (const variant of queryVariants(query)) {
      const rows = await this.repository.searchPages(tenantId, assistantId, variant, pageType, 5, integrationId);
      for (const row of rows) {
        if (typeof row.url === 'string') found.set(row.url, row);
      }
    }
    return [...found.values()]
      .map((row) => ({
        row,
        score: pageRelevance(query, [
            textValue(row.title),
            textValue(row.metaDescription),
            textValue(row.excerpt),
          ].join(' ')),
      }))
      .filter(({ score }) => score >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(({ row }) => row);
  }

  private async answerProducts(
    question: string,
    products: Row[],
    result: WebsiteKnowledgeAnswer,
    context: AgentExecutionContext,
  ): Promise<WebsiteKnowledgeAnswer> {
    for (const product of products) {
      const card = productCard(product);
      if (card) result.products.push(card);
      const source = sourceForProduct(product);
      if (source) result.sources.push(source);
    }
    const isComparison = /\b(compare|comparison|versus|vs\.?|difference|which is cheaper)\b/i.test(question);
    const asksPrice = /\b(prices?|costs?|pricing|how much|cheaper)\b/i.test(question) || Boolean(budgetConstraint(question));
    const asksStock = /\b(stock|availability|available|in stock|inventory)\b|\bcan (?:i|we) (?:buy|order|get)\b/i.test(question);
    const asksVariant = /\b(variant|variants|size option|colour option|color option)\b/i.test(question);
    const asksSpecs = isComparison ||
      /\b(specifications?|specs?|ingredients?|composition|features?|details?|explain|benefits?|what is|what's)\b/i.test(question);
    const summaries = await Promise.all(products.map(async (product) => {
      const name = textValue(product.name, 'Product');
      const sentences = [`${name}.`];
      if (asksPrice || isComparison) sentences.push(`Connected catalogue price: ${amountText(product)}.${sourceFreshness(product)}`);
      if (asksStock) {
        const availability = typeof product.availability === 'string' && product.availability !== 'unknown'
          ? product.availability.replace(/_/g, ' ') : 'unknown';
        const stock = typeof product.stock === 'number' ? ` Recorded stock: ${product.stock}.` : '';
        sentences.push(`Availability: ${availability}.${stock}${sourceFreshness(product)}`);
      }
      if (asksVariant) sentences.push('Variant information is not supplied as a verified catalogue field.');
      if (asksSpecs || (!asksPrice && !asksStock && !isComparison)) {
        const description = excerpt(product.description, 500);
        if (description) sentences.push(description);
        const attributes = asRecord(product.attributes);
        for (const [key, value] of Object.entries(attributes)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            sentences.push(`${key}: ${String(value)}.`);
          }
        }
        const details = contextProductSections(context.merchant && this.merchant
          ? await this.merchant.productContext(context, textValue(product.externalProductId))
          : undefined);
        if (details) sentences.push(details);
        if (!description && !Object.keys(attributes).length && !details && asksSpecs) {
          sentences.push('The connected product data does not supply additional specifications.');
        }
      }
      return sentences.join(' ');
    }));

    result.answer = summaries.join('\n\n');
    if (isComparison && products.length === 2) {
      const first = typeof products[0].salePrice === 'number' ? products[0].salePrice : products[0].price;
      const second = typeof products[1].salePrice === 'number' ? products[1].salePrice : products[1].price;
      if (typeof first === 'number' && typeof second === 'number' &&
          typeof products[0].currency === 'string' && products[0].currency === products[1].currency) {
        result.answer += first === second ? '\n\nBoth products have the same connected catalogue price.'
          : `\n\n${String(products[first < second ? 0 : 1].name)} has the lower connected catalogue price.`;
      } else {
        result.answer += '\n\nPrices cannot be compared because both amounts in the same currency are not available.';
      }
    } else if (products.length > 0 && /\b(recommend|suggest|best|products|catalog(?:ue)?)\b/i.test(question)) {
      result.answer = `Here are matching products from the connected catalogue; this is not a bestseller ranking.\n\n${result.answer}`;
    }
    return result;
  }
}

function contextProductSections(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const sections = (value as Row).sections;
  if (!Array.isArray(sections)) return '';
  return sections
    .filter((section): section is Row => !!section && typeof section === 'object' && !Array.isArray(section))
    .filter((section) => typeof section.title === 'string' && typeof section.content === 'string')
    .map((section) => `${String(section.title)}: ${excerpt(section.content, 600)}`)
    .join(' ');
}

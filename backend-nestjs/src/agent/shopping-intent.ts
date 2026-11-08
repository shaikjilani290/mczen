export type ShoppingIntent = 'PRODUCT_SEARCH' | 'PRODUCT_DETAILS' | 'PRODUCT_COMPARISON' |
  'ADD_TO_CART' | 'REMOVE_FROM_CART' | 'UPDATE_CART_QUANTITY' | 'VIEW_CART' |
  'CHECKOUT' | 'PRODUCT_FOLLOW_UP' | 'GENERAL_CONVERSATION';

export function shoppingIntent(question: string): ShoppingIntent {
  if (/\b(don'?t|do not|never|not now)\b/i.test(question)) return 'GENERAL_CONVERSATION';
  if (/\b(checkout|check out|pay|payment)\b/i.test(question)) return 'CHECKOUT';
  if (/\b(remove|delete)\b/i.test(question)) return 'REMOVE_FROM_CART';
  if (/\b(update|set|change|increase|decrease)\b/i.test(question) && /\b(quantity|units?|items?|to)\b/i.test(question)) return 'UPDATE_CART_QUANTITY';
  if (/\b(add|buy)\b/i.test(question)) return 'ADD_TO_CART';
  if (/\b(cart|basket)\b/i.test(question)) return 'VIEW_CART';
  if (/\b(compare|comparison|cheaper|difference|versus|vs)\b/i.test(question)) return 'PRODUCT_COMPARISON';
  if (/\b(policy|policies|returns?|refunds?|shipping|delivery|contact|website)\b/i.test(question)) return 'GENERAL_CONVERSATION';
  const detail = /\b(details?|explanations?|descriptions?|explain|describe|about|benefits?|ingredients?|composition|specifications?|usage|dosage|directions|warnings?|precautions?|storage|faqs?|reviews?|tabs?|features?|price)\b|side effects|what(?:'s| is) inside|how (?:do i |should i |to )use/i.test(question);
  if (detail || /\btell me more\b/i.test(question)) {
    return /\b(it|its|this|that|selected|first|second|third|more)\b/i.test(question) ||
      !productQuery(question) ? 'PRODUCT_FOLLOW_UP' : 'PRODUCT_DETAILS';
  }
  if (/\b(products?|find|search|show|catalogue|catalog|categories|category|under|below)\b/i.test(question)) return 'PRODUCT_SEARCH';
  return 'GENERAL_CONVERSATION';
}

export function productQuery(question: string): string {
  return question.replace(/\b(what|s|are|is|the|a|an|main|all|full|complete|detailed|everything|need|want|give|me|my|please|show|tell|explain|describe|details?|explanations?|descriptions?|about|of|for|in|inside|and|more|how|do|i|can|should|to|use|take|products?|benefits?|ingredients?|composition|specifications?|usage|dosage|directions|warnings?|precautions?|storage|faqs?|reviews?|tabs?|features?|side|effects|price|add|buy|remove|delete|cart|basket|also|too|one|units?|items?|quantity|update|set|change|increase|decrease)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ').replace(/[?!,]|(?<![\p{L}\p{N}])\.|\.(?![\p{L}\p{N}])/gu, ' ').replace(/\s+/g, ' ').trim();
}

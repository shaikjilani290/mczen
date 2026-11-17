export type ShoppingIntent = 'PRODUCT_SEARCH' | 'PRODUCT_DETAILS' | 'PRODUCT_COMPARISON' |
  'ADD_TO_CART' | 'REMOVE_FROM_CART' | 'UPDATE_CART_QUANTITY' | 'VIEW_CART' |
  'CHECKOUT' | 'PRODUCT_FOLLOW_UP' | 'GENERAL_CONVERSATION';

const localizedDetail = /గురించ[ిే]|వివరాలు|చ[ెే]ప్పండ[ిీే]|చెప్పు|పదార్థాలు|ప్రయోజనాలు|ఎలా పనిచేస్తుంది|ఎలా వాడాలి|ఎలా ఉపయోగించాలి|మోతాదు|నిల్వ|జాగ్రత్తలు|దుష్ప్రభావాలు|హెచ్చరికలు|के बारे में|बताइए|बताईए|बताएं|बताओ|बोलिये|बोलिए|जानकारी|सामग्री|फ़ायदे|फायदे|कैसे (?:लें|लेना|इस्तेमाल|उपयोग|रखें)|खुराक|भंडारण|चेतावनी|सावधान|दुष्प्रभाव|\b(?:gurinchi|chepandi|cheppandi|cheppu|bataiye|bataye|batao|boliye|jaankari)\b/iu;
const localizedReference = /దాని|దీని|ఇందులో|इसके|इसकी|इसमें|\b(?:dani|deeni|indulo|iske|iski|ismein)\b/iu;
const localizedExplain = /(?<![\p{L}\p{M}\p{N}])ఏక్స్ప్లేన్(?![\p{L}\p{M}\p{N}])/u;

export function isPriceOnlyProductRequest(question: string): boolean {
  return /\bprices?\b|\bcost\b|\bhow much\b|कीमत|दाम|ధర|ఖరీదు/iu.test(question) &&
    !/\b(?:about|details?|explain|describe|description|benefits?|ingredients?|composition|specifications?|usage|dosage|warnings?|storage|compare|comparison|policy|policies|shipping|delivery|cart|checkout|buy|order|pay)\b|గురించి|పదార్థాలు|ప్రయోజనాలు|వివరాలు|के बारे में|सामग्री|फायदे/iu.test(question);
}

export function isProductInformationRequest(question: string): boolean {
  if (localizedExplain.test(question)) return true;
  return /గురించ[ిే]|చ[ెే]ప్పండ[ిీే]|के बारे में|बताइए|बताईए|बताओ|\b(?:tell me about|explain|gurinchi|chepandi|cheppandi|bataiye)\b/iu.test(question);
}

export function isGeneralInformationRequest(question: string): boolean {
  return /\b(?:products|polic(?:y|ies)|prices?|pricing|shipping|returns?|refunds?|delivery|tips|wellness|mczen)\b|उत्पादों|उत्पाद|नीति|वापसी|शिपिंग|सुझाव|ఉత్పత్తుల|ఉత్పత్తులు|విధానం|రిటర్న్|షిప్పింగ్|చిట్కాలు/iu.test(question) ||
    /\bexplain\s+how\s+to\s+use\s+(?:this|that|it)\b/iu.test(question);
}

export function shoppingIntent(question: string): ShoppingIntent {
  if (/(?:कार्ट|కార్ట్)/u.test(question)) {
    if (/(?:मत|नहीं|వద్దు|చేయవద్దు)/u.test(question)) return 'GENERAL_CONVERSATION';
    if (/(?:हटाओ|हटा दें|निकाल|తొలగించ)/u.test(question)) return 'REMOVE_FROM_CART';
    if (/(?:जोड़|डाल|జోడించ|చేర్చ)/u.test(question)) return 'ADD_TO_CART';
    if (/(?:दिखाओ|दिखाएं|खोल|చూపించ|తెరవ)/u.test(question)) return 'VIEW_CART';
  }
  if (/\b(don'?t|do not|never|not now)\b/i.test(question)) return 'GENERAL_CONVERSATION';
  if (/\b(?:can|could|may|might|should|would|will)\s+i\s+(?:buy|purchase|order)\b/i.test(question)) {
    return 'GENERAL_CONVERSATION';
  }
  if (/\b(checkout|check out|payment)\b|\bpay\s+(?:now|for the order|for my order)\b/i.test(question)) return 'CHECKOUT';
  if (/\b(remove|delete)\b/i.test(question)) return 'REMOVE_FROM_CART';
  if (/\b(update|set|change|increase|decrease)\b/i.test(question) && /\b(quantity|units?|items?|to)\b/i.test(question)) return 'UPDATE_CART_QUANTITY';
  if (/\b(add|buy)\b/i.test(question)) return 'ADD_TO_CART';
  if (/\b(cart|basket)\b/i.test(question)) return 'VIEW_CART';
  if (isProductInformationRequest(question) && isGeneralInformationRequest(question)) {
    return /\bproducts\b|उत्पादों|उत्पाद|ఉత్పత్తుల|ఉత్పత్తులు/iu.test(question)
      ? 'PRODUCT_SEARCH' : 'GENERAL_CONVERSATION';
  }
  if (localizedDetail.test(question) || localizedExplain.test(question)) {
    return localizedReference.test(question) || !productQuery(question) ? 'PRODUCT_FOLLOW_UP' : 'PRODUCT_DETAILS';
  }
  if (/\b(compare|comparison|cheaper|difference|versus|vs)\b/i.test(question)) return 'PRODUCT_COMPARISON';
  if (/\b(faqs?|frequently asked|common questions|policy|policies|returns?|refunds?|shipping|delivery|contact|website)\b/i.test(question)) {
    return 'GENERAL_CONVERSATION';
  }
  if (/\b(?:tell me about|what are|show me)\b.*\b(?:mczen |your |the )?products\b/i.test(question)) {
    return 'PRODUCT_SEARCH';
  }
  if (isPriceOnlyProductRequest(question)) {
    return /\b(?:it|its|this|that|selected|first|second|third)\b|దాని|దీని|దీన్ని|इसके|इसकी|इस/iu.test(question) ||
      !productQuery(question) ? 'PRODUCT_FOLLOW_UP' : 'PRODUCT_DETAILS';
  }
  if (/\b(?:it|its|this|that)\b.*\b(?:support|help|work|benefit)\w*\b/i.test(question)) {
    return 'PRODUCT_FOLLOW_UP';
  }
  const detail = /\b(details?|explanations?|descriptions?|explain(?:s|ing)?|describe|about|benefits?|ingredients?|composition|specifications?|usage|dosage|directions|warnings?|precautions?|storage|faqs?|reviews?|tabs?|features?|price)\b|side effects|what(?:'s| is) inside|how (?:do i |should i |to )use/i.test(question);
  if (detail || /\btell me more\b/i.test(question)) {
    return /\b(it|its|this|that|selected|first|second|third|more)\b/i.test(question) ||
      !productQuery(question) ? 'PRODUCT_FOLLOW_UP' : 'PRODUCT_DETAILS';
  }
  if (/\b(products?|find|search|show|catalogue|catalog|categories|category|under|below)\b/i.test(question)) return 'PRODUCT_SEARCH';
  return 'GENERAL_CONVERSATION';
}

export function productQuery(question: string): string {
  const input = isPriceOnlyProductRequest(question) ? question
    .replace(/(?<![\p{L}\p{N}])(?:कीमत|दाम|कितनी|कितना|क्या|है|उत्पाद|इस|की|का|ధర|ఖరీదు|ఎంత|ఉత్పత్తి|ఈ|దీన్ని)(?![\p{L}\p{N}])/gu, ' ')
    .replace(/\b(?:prices?|cost|much|does|it|its|this|that|selected)\b/giu, ' ') : question;
  return input.replace(localizedExplain, ' ')
    .replace(/(?:इसके बारे में|के बारे में|बताइए|बताईए|बताएं|बताओ|बोलिये|बोलिए|जानकारी|सामग्री|फ़ायदे|फायदे|इसके|इसकी|इसमें|గురించ[ిే]|వివరాలు|చ[ెే]ప్పండ[ిీే]|చెప్పు|పదార్థాలు|ప్రయోజనాలు|దాని|దీని|ఇందులో|ఏమిటి|ఏంటి|ఏమి|ఎలా పనిచేస్తుంది|ఎలా వాడాలి|ఎలా ఉపయోగించాలి|మోతాదు|నిల్వ|జాగ్రత్తలు|దుష్ప్రభావాలు|హెచ్చరికలు|कैसे (?:लें|लेना|इस्तेमाल|उपयोग|रखें)|खुराक|भंडारण|चेतावनी|सावधान|दुष्प्रभाव)/gu, ' ')
    .replace(/\b(?:gurinchi|chepandi|cheppandi|cheppu|bataiye|bataye|batao|boliye|jaankari|ke bare mein|dani|deeni|indulo|iske|iski|ismein)\b/gi, ' ')
    .replace(/(?:मेरे|मेरी|कार्ट|में|जोड़ दीजिए|जोड़ दें|जोड़ो|जोड़ें|जोड़|डाल दें|डालो|हटाओ|हटा दें|कृपया|నాకు|నా|కార్ట్‌లో|కార్ట్లో|కార్ట్|జోడించండి|జోడించు|చేర్చండి|చేర్చు|దయచేసి|తొలగించండి)/gu, ' ')
    .replace(/\b(what|s|are|is|the|a|an|main|all|full|complete|detailed|everything|need|want|give|me|my|please|show|tell|explain(?:s|ing)?|describe|details?|explanations?|descriptions?|about|of|for|in|inside|and|more|how|do|i|can|should|to|use|take|products?|benefits?|ingredients?|composition|specifications?|usage|dosage|directions|warnings?|precautions?|storage|faqs?|reviews?|tabs?|features?|side|effects|price|add|buy|remove|delete|cart|basket|also|too|one|units?|items?|quantity|update|set|change|increase|decrease)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ').replace(/[?!,।]|(?<![\p{L}\p{N}])\.|\.(?![\p{L}\p{N}])/gu, ' ').replace(/\s+/g, ' ').trim();
}

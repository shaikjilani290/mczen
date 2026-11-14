"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shoppingIntent = shoppingIntent;
exports.productQuery = productQuery;
function shoppingIntent(question) {
    if (/(?:कार्ट|కార్ట్)/u.test(question)) {
        if (/(?:मत|नहीं|వద్దు|చేయవద్దు)/u.test(question))
            return 'GENERAL_CONVERSATION';
        if (/(?:हटाओ|हटा दें|निकाल|తొలగించ)/u.test(question))
            return 'REMOVE_FROM_CART';
        if (/(?:जोड़|डाल|జోడించ|చేర్చ)/u.test(question))
            return 'ADD_TO_CART';
        if (/(?:दिखाओ|दिखाएं|खोल|చూపించ|తెరవ)/u.test(question))
            return 'VIEW_CART';
    }
    if (/\b(don'?t|do not|never|not now)\b/i.test(question))
        return 'GENERAL_CONVERSATION';
    if (/\b(?:can|could|may|might|should|would|will)\s+i\s+(?:buy|purchase|order)\b/i.test(question)) {
        return 'GENERAL_CONVERSATION';
    }
    if (/\b(checkout|check out|payment)\b|\bpay\s+(?:now|for the order|for my order)\b/i.test(question))
        return 'CHECKOUT';
    if (/\b(remove|delete)\b/i.test(question))
        return 'REMOVE_FROM_CART';
    if (/\b(update|set|change|increase|decrease)\b/i.test(question) && /\b(quantity|units?|items?|to)\b/i.test(question))
        return 'UPDATE_CART_QUANTITY';
    if (/\b(add|buy)\b/i.test(question))
        return 'ADD_TO_CART';
    if (/\b(cart|basket)\b/i.test(question))
        return 'VIEW_CART';
    if (/\b(compare|comparison|cheaper|difference|versus|vs)\b/i.test(question))
        return 'PRODUCT_COMPARISON';
    if (/\b(faqs?|frequently asked|common questions|policy|policies|returns?|refunds?|shipping|delivery|contact|website)\b/i.test(question)) {
        return 'GENERAL_CONVERSATION';
    }
    if (/\b(?:tell me about|what are|show me)\b.*\b(?:mczen |your |the )?products\b/i.test(question)) {
        return 'PRODUCT_SEARCH';
    }
    if (/\b(?:it|its|this|that)\b.*\b(?:support|help|work|benefit)\w*\b/i.test(question)) {
        return 'PRODUCT_FOLLOW_UP';
    }
    const detail = /\b(details?|explanations?|descriptions?|explain(?:s|ing)?|describe|about|benefits?|ingredients?|composition|specifications?|usage|dosage|directions|warnings?|precautions?|storage|faqs?|reviews?|tabs?|features?|price)\b|side effects|what(?:'s| is) inside|how (?:do i |should i |to )use/i.test(question);
    if (detail || /\btell me more\b/i.test(question)) {
        return /\b(it|its|this|that|selected|first|second|third|more)\b/i.test(question) ||
            !productQuery(question) ? 'PRODUCT_FOLLOW_UP' : 'PRODUCT_DETAILS';
    }
    if (/\b(products?|find|search|show|catalogue|catalog|categories|category|under|below)\b/i.test(question))
        return 'PRODUCT_SEARCH';
    return 'GENERAL_CONVERSATION';
}
function productQuery(question) {
    return question.replace(/(?:मेरे|मेरी|कार्ट|में|जोड़ दीजिए|जोड़ दें|जोड़ो|जोड़ें|जोड़|डाल दें|डालो|हटाओ|हटा दें|कृपया|నాకు|నా|కార్ట్‌లో|కార్ట్లో|కార్ట్|జోడించండి|జోడించు|చేర్చండి|చేర్చు|దయచేసి|తొలగించండి)/gu, ' ')
        .replace(/\b(what|s|are|is|the|a|an|main|all|full|complete|detailed|everything|need|want|give|me|my|please|show|tell|explain(?:s|ing)?|describe|details?|explanations?|descriptions?|about|of|for|in|inside|and|more|how|do|i|can|should|to|use|take|products?|benefits?|ingredients?|composition|specifications?|usage|dosage|directions|warnings?|precautions?|storage|faqs?|reviews?|tabs?|features?|side|effects|price|add|buy|remove|delete|cart|basket|also|too|one|units?|items?|quantity|update|set|change|increase|decrease)\b/gi, ' ')
        .replace(/\b\d+(?:\.\d+)?\b/g, ' ').replace(/[?!,]|(?<![\p{L}\p{N}])\.|\.(?![\p{L}\p{N}])/gu, ' ').replace(/\s+/g, ' ').trim();
}
//# sourceMappingURL=shopping-intent.js.map
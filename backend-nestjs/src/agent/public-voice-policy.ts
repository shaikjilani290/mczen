import { shoppingIntent } from './shopping-intent';

export const PUBLIC_VOICE_TOOLS: ReadonlySet<string> = new Set([
  'search_products', 'get_product_details', 'compare_products',
  'search_website_content', 'search_website_faqs',
]);

export function publicVoiceNeedsUnlock(question: string): boolean {
  const intent = shoppingIntent(question);
  return ['ADD_TO_CART', 'REMOVE_FROM_CART', 'UPDATE_CART_QUANTITY', 'VIEW_CART', 'CHECKOUT'].includes(intent) ||
    /\b(cart|basket|checkout|check out|buy|purchase|pay|payment|order|orders|account|profile|password|login|log in|sign in|logout|log out|wishlist|history|settings|address|phone number|email)\b|कार्ट|खरीद|भुगतान|ऑर्डर|खाता|पासवर्ड|पता|इतिहास|కార్ట్|కొను|కొనుగోలు|చెల్లిం|ఆర్డర్|ఖాతా|చిరునామా|చరిత్ర/iu.test(question);
}

export function publicVoiceUnlockMessage(language?: string): string {
  return language === 'hi' ? 'इसके लिए फ़ोन अनलॉक करें। कोई कार्रवाई नहीं की गई है। अनलॉक करने के बाद अनुरोध फिर से करें।'
    : language === 'te' ? 'దీని కోసం ఫోన్ అన్‌లాక్ చేయండి. ఏ చర్యా చేయలేదు. అన్‌లాక్ చేసిన తర్వాత మళ్లీ అడగండి.'
      : 'Unlock your phone for that operation. Nothing has been changed. Please ask again after unlocking.';
}

import { productQuery, shoppingIntent } from './shopping-intent';

describe('shopping intent classification', () => {
  it.each([
    ['Show your products.', 'PRODUCT_SEARCH'],
    ['Tell me about McZEN products.', 'PRODUCT_SEARCH'],
    ['How does it support skin health?', 'PRODUCT_FOLLOW_UP'],
    ['Explain the ZENAGE product.', 'PRODUCT_DETAILS'],
    ['What are its ingredients?', 'PRODUCT_FOLLOW_UP'],
    ['I need full description', 'PRODUCT_FOLLOW_UP'],
    ['Compare ZENAGE and LASS HEALTH.', 'PRODUCT_COMPARISON'],
    ['Which is cheaper, ZENAGE or WEIZAP?', 'PRODUCT_COMPARISON'],
    ['Add it to my cart.', 'ADD_TO_CART'],
    ['Add this one also.', 'ADD_TO_CART'],
    ['Remove ZENAGE.', 'REMOVE_FROM_CART'],
    ['Set quantity to 3.', 'UPDATE_CART_QUANTITY'],
    ['Show my cart.', 'VIEW_CART'],
    ['Checkout please.', 'CHECKOUT'],
    ['Pay now.', 'CHECKOUT'],
    ['How much would I pay for Green Tea, and can I buy it now?', 'GENERAL_CONVERSATION'],
    ['Can I buy Green Tea?', 'GENERAL_CONVERSATION'],
    ['What are the frequently asked questions?', 'GENERAL_CONVERSATION'],
    ['Hello.', 'GENERAL_CONVERSATION'],
    ['Do not add this product.', 'GENERAL_CONVERSATION'],
  ])('routes %s as %s', (question, expected) => {
    expect(shoppingIntent(question)).toBe(expected);
  });
  it('keeps internal product punctuation while stripping sentence punctuation', () => {
    expect(productQuery('Explain HALE.O.')).toBe('HALE.O');
    expect(productQuery('What are the ingredients in ZENAGE?')).toBe('ZENAGE');
    expect(productQuery('Tell me about AURA STRESS FREE COFFEE.')).toBe('AURA STRESS FREE COFFEE');
  });
});

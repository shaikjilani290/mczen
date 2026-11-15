import { ProductIdentityService, canonicalizeProductNames, normalizeProductName, productMentions, resolveProduct } from './product-identity.service';
import { WebsiteIntegrationRepository } from './website-integration.repository';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { newUuidv7 } from '../common/ids/uuid';

const vocabulary = [
  { name: 'ZENAGE', externalProductId: 'zenage-id' },
  { name: 'EDGE', externalProductId: 'edge-id' },
  { name: 'WEIZAP', externalProductId: 'weizap-id' },
  { name: 'LASS HEALTH', externalProductId: 'lass-id' },
  { name: 'HALE.O', externalProductId: 'hale-id' },
  { name: 'AURA STRESS FREE COFFEE', externalProductId: 'aura-id' },
];

describe('exact merchant product identity', () => {
  it.each([
    ['जैनेज के बारे में बोलिये', 'ZENAGE के बारे में बोलिये'],
    ['జెనేజ్ గురించి చెప్పండి', 'ZENAGE గురించి చెప్పండి'],
    ['“जेनेज़”, ZENAGE మరియు జెనేజ.', '“ZENAGE”, ZENAGE మరియు ZENAGE.'],
    ['Compare lass health and hale.o.', 'Compare LASS HEALTH and HALE.O.'],
  ])('uses catalogue spellings without translating the rest of %s', (text, expected) => {
    expect(canonicalizeProductNames(text, vocabulary)).toBe(expected);
  });
  it('does not rewrite unknown names, substrings or names absent from the current catalogue', () => {
    const text = 'జెనేస్ जेनेस WEIZAPPER Genedge ZENXXE';
    expect(canonicalizeProductNames(text, vocabulary)).toBe(text);
    expect(canonicalizeProductNames('जैनेज', vocabulary.slice(1))).toBe('जैनेज');
    expect(canonicalizeProductNames('జెనేజ్', [])).toBe('జెనేజ్');
  });
  it('leaves shared aliases untouched rather than selecting a product', () => {
    expect(canonicalizeProductNames('జెనేజ్ గురించి చెప్పండి',
      [...vocabulary, { name: 'Other', externalProductId: 'other', aliases: ['జెనేజ్'] }]))
      .toBe('జెనేజ్ గురించి చెప్పండి');
  });
  it('handles multi-word aliases and longest names in one pass without rewriting replacements', () => {
    const products = [
      { name: 'English Name', externalProductId: 'one', aliases: ['दो शब्द'] },
      { name: 'Other', externalProductId: 'two', aliases: ['English Name Extra'] },
    ];
    expect(canonicalizeProductNames('दो शब्द; English Name Extra!', products)).toBe('English Name; Other!');
  });
  it('resolves the observed screenshot spelling without fuzzy Indic matching', () => {
    expect(resolveProduct('जैनेज के बारे में बोलिये', vocabulary))
      .toMatchObject({ status: 'resolved', score: 1, candidates: [vocabulary[0]] });
  });
  it('includes the alias file in the configured Nest build assets', () => {
    const config: unknown = require('../../nest-cli.json');
    expect(config).toEqual(expect.objectContaining({
      compilerOptions: expect.objectContaining({ assets: expect.arrayContaining(['website-integrations/product-aliases.json']) }),
    }));
  });
  it.each(['जेनेज', 'जेनेज़', 'जीनेज', 'ज़ेनेज', 'జెనేజ్', 'జెనేజ', 'జీనేజ్'])(
    'resolves the configured Indic alias %s to catalogue ZENAGE', name => {
      expect(resolveProduct(name, vocabulary)).toMatchObject({
        status: 'resolved', score: 1, candidates: [vocabulary[0]],
      });
      expect(resolveProduct(name, vocabulary.slice(1)).candidates).not.toContainEqual(vocabulary[0]);
    },
  );
  it('matches a sliding window despite a garbled Hindi verb', () => {
    expect(resolveProduct('जेनेज के बारे में बोल गया?', vocabulary)).toMatchObject({
      status: 'resolved', candidates: [vocabulary[0]],
    });
    expect(resolveProduct('గురించే చేప్పండే', vocabulary).status).toBe('none');
  });
  it.each(['जेनेस के बारे में बताइए', 'జెనేస్ గురించి చెప్పండి'])(
    'does not guess an unconfigured Indic spelling: %s', question => {
      expect(resolveProduct(question, vocabulary)).toMatchObject({ status: 'none', candidates: [] });
    },
  );
  it('keeps Latin fuzzy matching in an Indic sentence', () => {
    expect(resolveProduct('ZENAG के बारे में बताइए', vocabulary)).toMatchObject({
      status: 'resolved', candidates: [vocabulary[0]],
    });
    expect(resolveProduct('ZENXXE గురించి చెప్పండి', vocabulary)).toMatchObject({
      status: 'clarify', candidates: [vocabulary[0]],
    });
  });
  it('requires exact matching for Indic catalogue names and product-data aliases too', () => {
    const product = { name: 'జెనేజ', externalProductId: 'local', aliases: ['जेनेज'] };
    expect(resolveProduct('జెనేజ గురించి చెప్పండి', [product])).toMatchObject({
      status: 'resolved', candidates: [product],
    });
    expect(resolveProduct('जेनेज के बारे में बताइए', [product])).toMatchObject({
      status: 'resolved', candidates: [product],
    });
    expect(resolveProduct('జెనేస్ గురించి చెప్పండి', [product]).status).toBe('none');
    expect(resolveProduct('जेनेस के बारे में बताइए', [product]).status).toBe('none');
  });
  it('keeps vowel signs and normalizes nukta, nasal marks and virama differences', () => {
    expect(normalizeProductName('జెనేజ్')).toBe(normalizeProductName('జెనేజ'));
    expect(normalizeProductName('जेनेज़')).toBe(normalizeProductName('जेनेज'));
    expect(normalizeProductName('हँ')).toBe(normalizeProductName('हं'));
    expect(normalizeProductName('జఁ')).toBe(normalizeProductName('జం'));
    expect(normalizeProductName('జీనేజ')).not.toBe(normalizeProductName('జెనేజ'));
  });
  it.each([['ZENAG', 'resolved', 5 / 6], ['ZENXXE', 'clarify', 4 / 6], ['XXX', 'none', 0]])(
    'uses edit-distance thresholds for %s', (text, status, score) => {
      const result = resolveProduct(String(text), [vocabulary[0]]);
      expect(result.status).toBe(status);
      expect(result.score).toBeCloseTo(Number(score));
    },
  );
  it('requires clarification for duplicate aliases instead of selecting the first product', () => {
    expect(resolveProduct('जेनेज', [...vocabulary, { name: 'Other', externalProductId: 'other', aliases: ['जेनेज'] }]))
      .toMatchObject({ status: 'clarify', score: 1 });
  });
  it.each([['ABCDE', 'resolved', 1], ['ABCDX', 'resolved', 0.8], ['ABCXX', 'clarify', 0.6], ['ABXXX', 'none', 0.4]])(
    'verifies the exact threshold boundary for %s', (text, status, score) => {
      expect(resolveProduct(String(text), [{ name: 'ABCDE', externalProductId: 'boundary' }]))
        .toMatchObject({ status, score });
    },
  );
  it('compares two- and three-word windows instead of the whole leftover sentence', () => {
    expect(resolveProduct('Explain LASS HELTH please', vocabulary)).toMatchObject({
      status: 'resolved', candidates: [vocabulary[3]],
    });
    expect(resolveProduct('Tell me about Red Gren Tea please', [{ name: 'Red Green Tea', externalProductId: 'tea' }]))
      .toMatchObject({ status: 'resolved', candidates: [{ name: 'Red Green Tea', externalProductId: 'tea' }] });
  });
  it.each(['ZENAGE', 'WEIZAP', 'LASS HEALTH', 'HALE.O', 'AURA STRESS FREE COFFEE'])('preserves %s', name => {
    expect(productMentions(`Explain ${name}.`, vocabulary).map(product => product.name)).toEqual([name]);
  });
  it('supports punctuation/case normalization without phonetic or substring substitution', () => {
    expect(normalizeProductName(' HALE.O ')).toBe(normalizeProductName('hale o'));
    expect(productMentions('Tell me about ZENAGE.', vocabulary)).not.toContainEqual(vocabulary[1]);
    expect(productMentions('Explain Genedge or Janet.', vocabulary)).toEqual([]);
    expect(productMentions('Explain WEIZAPPER.', vocabulary)).toEqual([]);
    expect(productMentions('Compare ZENAGE and WEIZAP.', vocabulary)).toHaveLength(2);
  });
  it('loads only the backend-established merchant catalogue with read permission', async () => {
    const repository = new WebsiteIntegrationRepository();
    const read = jest.spyOn(repository, 'productVocabulary').mockResolvedValue(vocabulary);
    const service = new ProductIdentityService(repository);
    const context: AgentExecutionContext = { tenantId: newUuidv7(), assistantId: newUuidv7(),
      requestId: 'voice-turn', permissions: ['products:read'],
      merchant: { integrationId: newUuidv7(), sessionId: 'visitor', origin: 'https://merchant.example' } };
    expect(await service.vocabulary(context)).toEqual(vocabulary);
    expect(read).toHaveBeenCalledWith(context.tenantId, context.assistantId, context.merchant!.integrationId);
    expect(await service.vocabulary({ ...context, permissions: [] })).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

import { productFactTranslations } from './product-fact-translations';
import { createHash } from 'node:crypto';
import { mczenProductTranslations } from './mczen-product-translations';
import { cleanWebsiteText } from '../website-integrations/website-crawler';

type Language = 'en' | 'hi' | 'te';
type Section = 'description' | 'features' | 'composition' | 'dosage' | 'usage' | 'storage' | 'warnings' |
  'contraindications' | 'sideEffects' | 'specifications' | 'faqs' | 'reviews' | 'terms';
const labels: Record<Section, string> = {
  description: 'Description', features: 'Features', composition: 'Composition', dosage: 'Dosage',
  usage: 'How to use', storage: 'Storage instructions', warnings: 'Warnings', contraindications: 'Contraindications',
  sideEffects: 'Side effects', specifications: 'Specifications', faqs: 'FAQs', reviews: 'Reviews', terms: 'Terms and conditions',
};
const localizedLabels: Record<Language, Record<Section, string>> = {
  en: {
    description: 'Introduction', features: 'Formulation objectives', composition: 'Ingredients', dosage: 'Intake guidance',
    usage: 'How to use', storage: 'Storage', warnings: 'Warnings', contraindications: 'Contraindications',
    sideEffects: 'Side effects', specifications: 'Specifications', faqs: 'FAQs', reviews: 'Reviews', terms: 'Terms and conditions',
  },
  hi: {
    description: 'परिचय', features: 'पोषण संबंधी उद्देश्य', composition: 'सामग्री', dosage: 'मात्रा',
    usage: 'उपयोग', storage: 'भंडारण', warnings: 'सावधानियां', contraindications: 'उपयोग न करने की स्थितियां',
    sideEffects: 'दुष्प्रभाव', specifications: 'विशेष विवरण', faqs: 'सामान्य प्रश्न', reviews: 'समीक्षाएं', terms: 'नियम और शर्तें',
  },
  te: {
    description: 'పరిచయం', features: 'పోషక లక్ష్యాలు', composition: 'పదార్థాలు', dosage: 'మోతాదు',
    usage: 'వాడే విధానం', storage: 'నిల్వ', warnings: 'జాగ్రత్తలు', contraindications: 'వాడకూడని పరిస్థితులు',
    sideEffects: 'దుష్ప్రభావాలు', specifications: 'ప్రత్యేక వివరాలు', faqs: 'సాధారణ ప్రశ్నలు', reviews: 'సమీక్షలు', terms: 'నిబంధనలు',
  },
};
const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
const translations = new Map<string, { hi: string; te: string }>(
  productFactTranslations.map(entry => [normalize(entry.source), entry]),
);
const hashedTranslations = new Map<string, { hi: string; te: string }>(
  mczenProductTranslations.flatMap(entry => entry.hashes.map(hash => [hash, entry] as const)),
);
const translation = (source: string) => translations.get(normalize(source)) ??
  hashedTranslations.get(createHash('sha256').update(normalize(source)).digest('hex'));
const englishSummaries = new Map<string, string>([
  [normalize(productFactTranslations[0].source), 'ZENAGE is a nutritional supplement formulated to support skin health. It combines amino acids, peptides, antioxidants, vitamins, minerals and botanical extracts. Its documented objectives include supporting skin hydration, elasticity and collagen formation. It complements, rather than replaces, a balanced diet and skincare routine.'],
  [normalize(productFactTranslations[1].source), 'The merchant describes nutritional support for skin structure, hydration, elasticity, the skin barrier and antioxidant protection. These are ingredient-related formulation objectives, not guarantees of visible results.'],
  [normalize(productFactTranslations[2].source), productFactTranslations[2].hi],
]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function sourceSection(product: Record<string, unknown>, section: Section, pageContext?: unknown): string | undefined {
  const description = typeof product.description === 'string' ? product.description
    .replace(/^Recorded product detail\.\s*Description:\s*/iu, '') : '';
  const parts = description.split(/(?:^|\n\n)(Description|Composition|Features|Ingredients|Dosage|How to use|Storage instructions|Warnings|Side effects|Contraindications|Specifications|FAQs|Reviews|Terms and conditions):\s*\n/gu);
  for (let index = 1; index < parts.length; index += 2) {
    if (parts[index] === labels[section]) return parts[index + 1]?.trim();
  }
  if (section === 'composition') {
    for (let index = 1; index < parts.length; index += 2) {
      if (parts[index] === 'Ingredients') return parts[index + 1]?.trim();
    }
  }
  const attributes = record(product.attributes) ? product.attributes : {};
  const attribute = attributes[section];
  if (typeof attribute === 'string' && attribute.trim()) return attribute;
  if (section === 'composition' && typeof attributes.ingredients === 'string' && attributes.ingredients.trim())
    return attributes.ingredients;
  if (section === 'description' && parts.length === 1 && description.trim()) return description;
  if (record(pageContext) && Array.isArray(pageContext.sections)) {
    const supplied = pageContext.sections.filter(record).find(entry =>
      typeof entry.title === 'string' && (entry.title.toLowerCase() === labels[section].toLowerCase() ||
        (section === 'composition' && /ingredients?|composition|inside/iu.test(entry.title))));
    if (typeof supplied?.content === 'string') return supplied.content;
  }
  return undefined;
}

function requestedSections(question: string): Section[] {
  if (/\b(full|complete|detailed|everything)\b|\ball (?:details|sections)\b|పూర్తి వివరాలు|మొత్తం వివరాలు|पूरी जानकारी|संपूर्ण|विस्तार/iu.test(question)) return Object.keys(labels) as Section[];
  const sections: Section[] = [];
  if (/\bingredients?\b|\bcomposition\b|పదార్థాలు|కూర్పు|सामग्री|घटक/iu.test(question)) sections.push('composition');
  if (/\bbenefits?\b|\bfeatures?\b|\bhow\b.*\b(?:work|help|support)\b|ప్రయోజనాలు|ఎలా పనిచేస్తుంది|లాభాలు|फायदे|फ़ायदे|लाभ/iu.test(question)) sections.push('features');
  if (/\busage\b|\bdosage\b|\bdirections?\b|\bhow\b.*\b(?:use|take)\b|ఎలా వాడాలి|ఎలా ఉపయోగించాలి|మోతాదు|कैसे (?:लें|लेना|इस्तेमाल|उपयोग)|खुराक/iu.test(question)) sections.push('dosage', 'usage');
  if (/\bstorage\b|\bstore\b|నిల్వ|భద్రపర|भंडारण|कैसे रखें/iu.test(question)) sections.push('storage');
  if (/\bwarnings?\b|\bprecautions?\b|\bsafe\b|\bcontraindications?\b|\bpregnan\w*\b|\bbreastfeed\w*\b|\ballerg\w*\b|side effects|జాగ్రత్తలు|దుష్ప్రభావాలు|సురక్షిత|హెచ్చరికలు|గర్భ|పాలివ్వ|అలెర్జీ|चेतावनी|सावधान|दुष्प्रभाव|सुरक्षित|गर्भ|स्तनपान|एलर्जी/iu.test(question)) sections.push('warnings', 'contraindications');
  if (/side effects|దుష్ప్రభావాలు|दुष्प्रभाव/iu.test(question)) sections.push('sideEffects');
  if (/\bspecifications?\b|\bspecs\b|స్పెసిఫికేషన్లు|विनिर्देश/iu.test(question)) sections.push('specifications');
  if (/\bfaqs?\b|ప్రశ్నలు|सवाल/iu.test(question)) sections.push('faqs');
  if (/\breviews?\b|సమీక్షలు|समीक्षा/iu.test(question)) sections.push('reviews');
  if (/\bterms\b|\bconditions\b|నిబంధనలు|शर्तें/iu.test(question)) sections.push('terms');
  return sections.length ? sections : ['description'];
}

export function bilingualProductAnswer(
  question: string, language: Language, product: Record<string, unknown>, pageContext?: unknown,
): { answer: string; missingSections: string[]; untranslatedSections: string[] } {
  const requested = requestedSections(question);
  const missing: Section[] = [];
  const untranslated: Section[] = [];
  const paragraphs: string[] = [];
  const safetyQuestion = /side effects|దుష్ప్రభావాలు|दुष्प्रभाव/iu.test(question);
  for (const section of requested) {
    const source = sourceSection(product, section, pageContext);
    if (!source || /^[.\s]*$/u.test(source)) { missing.push(section); continue; }
    const translated = translation(source);
    if (!translated && language !== 'en') { untranslated.push(section); continue; }
    const text = language === 'en'
      ? englishSummaries.get(normalize(source)) ?? cleanWebsiteText(source).replace(/(?<=[a-z.)])(?=[A-Z])/gu, ' ')
      : translated![language];
    const body = section === 'composition'
      ? (language === 'en'
        ? 'These are the supplied ingredient names and amounts, not recommended daily doses.\n'
        : language === 'hi'
        ? 'विक्रेता की सामग्री सूची नीचे है। वैज्ञानिक नाम और मात्राएं मूल रूप में रखी गई हैं; ये सेवन की खुराक नहीं हैं।\n'
        : 'విక్రేత ఇచ్చిన పదార్థాల జాబితా ఇది. శాస్త్రీయ పేర్లు, పరిమాణాలను మూల సమాచారంలో ఉన్నట్లుగానే ఉంచాం; ఇవి తీసుకోవాల్సిన మోతాదు సూచనలు కావు.\n') + text
      : text;
    paragraphs.push(section === 'description' ? body : `${localizedLabels[language][section]}:\n${body}`);
  }
  if (safetyQuestion) paragraphs.push(language === 'en'
    ? 'The available record does not establish complete side-effect information. Missing information does not mean there are no side effects.'
    : language === 'hi'
    ? 'दुष्प्रभावों की पूरी जानकारी की पुष्टि उपलब्ध विवरण से नहीं होती। इसका मतलब यह नहीं है कि दुष्प्रभाव नहीं होते।'
    : 'అందుబాటులో ఉన్న వివరాలతో దుష్ప్రభావాల పూర్తి సమాచారాన్ని నిర్ధారించలేం. దుష్ప్రభావాలు ఉండవని దీని అర్థం కాదు.');
  if (missing.length) {
    const names = missing.map(section => localizedLabels[language][section]).join(', ');
    paragraphs.push(language === 'en'
      ? (missing.length === 1 && missing[0] === 'composition'
        ? 'The connected product data does not supply an ingredient list. Please check the product label or confirm with the merchant.'
        : `${names}: this information is not supplied in the connected product record. Please check the product label or confirm with the merchant.`)
      : language === 'hi'
      ? `${names}: यह जानकारी जुड़े हुए उत्पाद विवरण में उपलब्ध नहीं है। कृपया उत्पाद का लेबल देखें या विक्रेता से पुष्टि करें।`
      : `${names}: ఈ వివరాలు అనుసంధానించిన ఉత్పత్తి సమాచారంలో లేవు. ప్యాక్‌పై వివరాలు చూడండి లేదా విక్రేతను సంప్రదించండి.`);
  }
  if (untranslated.length) {
    const names = untranslated.map(section => localizedLabels[language][section]).join(', ');
    paragraphs.push(language === 'hi'
      ? `${names}: इस जानकारी का हिंदी अनुवाद अभी उपलब्ध नहीं है। अनुमान लगाने के बजाय कृपया उत्पाद का मूल विवरण देखें।`
      : `${names}: ఈ వివరాలకు తెలుగు అనువాదం ఇంకా అందుబాటులో లేదు. ఊహించి చెప్పకుండా, అసలు ఉత్పత్తి వివరాలు చూడమని సూచిస్తున్నాం.`);
  }
  if (paragraphs.length && requested.some(section => ['description', 'features', 'composition'].includes(section)) &&
      requested.some(section => language === 'en' ? Boolean(sourceSection(product, section, pageContext))
        : Boolean(translation(sourceSection(product, section, pageContext) ?? '')))) {
    paragraphs.push(language === 'en'
      ? 'These are formulation objectives, not independently verified clinical outcomes.'
      : language === 'hi'
      ? 'ये विक्रेता द्वारा बताए गए पोषण संबंधी उद्देश्य हैं, प्रमाणित चिकित्सीय परिणाम या इलाज की गारंटी नहीं।'
      : 'ఇవి విక్రేత పేర్కొన్న పోషక లక్ష్యాలు మాత్రమే; నిర్ధారిత వైద్య ఫలితాలు లేదా చికిత్సకు హామీ కావు.');
  }
  return {
    answer: `${String(product.name)}\n\n${paragraphs.join('\n\n')}`,
    missingSections: missing.map(section => labels[section]),
    untranslatedSections: untranslated.map(section => labels[section]),
  };
}

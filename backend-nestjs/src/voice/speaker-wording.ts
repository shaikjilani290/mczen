import type { VoiceLanguage } from './voice.types';

export type SpeakerGender = 'male' | 'female' | 'neutral';

export function isSpeakerGender(value: unknown): value is SpeakerGender {
  return value === 'male' || value === 'female' || value === 'neutral';
}

export function speakerWording(text: string, language: VoiceLanguage, gender: SpeakerGender): string {
  if (language === 'en') return text;
  // Never rewrite quoted customer/catalogue text or code.
  return text.split(/(```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”|«[^»]*»)/g).map((part, index) => {
    if (index % 2) return part;
    if (language === 'te') {
      return part.replace(/నేను మీ McZEN షాపింగ్ సహాయక(?:ుడిని|ురాలిని)/g,
        gender === 'female' ? 'నేను మీ McZEN షాపింగ్ సహాయకురాలిని'
          : gender === 'male' ? 'నేను మీ McZEN షాపింగ్ సహాయకుడిని' : 'ఇది మీ McZEN షాపింగ్ సహాయ సేవ');
    }
    return part.replace(/मैं[^।!?\n]*?(?:हूँ|हूं)/g, clause => {
      const ending = clause.endsWith('हूं') ? 'हूं' : 'हूँ';
      if (gender === 'neutral') {
        return clause
          .replace(/मैं आपक[ाी] (McZEN शॉपिंग )?(?:सहायक|सहायिका) (?:हूँ|हूं)/g, (_, brand: string | undefined) =>
            `यह आपकी ${brand ?? ''}सहायता सेवा है`)
          .replace(/मैं आपकी कैसे मदद कर सकत[ाी] (?:हूँ|हूं)/g, 'आपकी किस तरह मदद की जाए')
          .replace(/मैं (.*?)कर सकत[ाी] (?:हूँ|हूं)/g, '$1करना संभव है')
          .replace(/मैं (.*?)बता सकत[ाी] (?:हूँ|हूं)/g, '$1बताना संभव है');
      }
      const female = gender === 'female';
      return clause
        .replace(/आपक[ाी] (McZEN शॉपिंग )?(?:सहायक|सहायिका)/g, (_, brand: string | undefined) =>
          `${female ? 'आपकी' : 'आपका'} ${brand ?? ''}${female ? 'सहायिका' : 'सहायक'}`)
        .replace(/(?:सकता|सकती) (?:हूँ|हूं)/g, `${female ? 'सकती' : 'सकता'} ${ending}`)
        .replace(/(?:करता|करती) (?:हूँ|हूं)/g, `${female ? 'करती' : 'करता'} ${ending}`);
    });
  }).join('');
}

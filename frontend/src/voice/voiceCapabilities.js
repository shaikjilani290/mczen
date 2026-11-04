export const LANGUAGE_LABELS = {
  auto: "Automatic",
  en: "English",
  hi: "Hindi",
  te: "Telugu",
};

export function getVoiceOptions(language, settings) {
  if (!settings?.voices) return [];
  const code = language === "auto" ? settings.defaultLanguage : language;
  return Array.isArray(settings.voices[code]) ? settings.voices[code] : [];
}

export function hasSpeechOutput(language, settings) {
  if (!settings || !Array.isArray(settings.ttsLanguages)) return false;
  const code = language === "auto" ? settings.defaultLanguage : language;
  return settings.ttsLanguages.includes(code) && getVoiceOptions(language, settings).length > 0;
}

export function mapTranscript(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    role: item.role === "user" ? "user" : "assistant",
    content: typeof item.content === "string" ? item.content : "",
    language: item.language || null,
    sources: Array.isArray(item.sources) ? item.sources : [],
    createdAt: item.createdAt,
  }));
}

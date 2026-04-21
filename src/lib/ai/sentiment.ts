import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { detect } from "tinyld";

export const SentimentResultSchema = z.object({
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  confidence: z.number().int().min(0).max(100),
  reasoning_native: z.string().min(1),
  reasoning_en: z.string().min(1),
  detected_language: z.enum(["ar", "fr", "en"])
});

export type SentimentResult = z.infer<typeof SentimentResultSchema>;

function normalizeLang(lang?: string | null): "ar" | "fr" | "en" | null {
  if (!lang) return null;
  const l = lang.toLowerCase();
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("fr")) return "fr";
  if (l.startsWith("en")) return "en";
  return null;
}

export async function analyzeSentiment({
  text,
  languageHint
}: {
  text: string;
  languageHint?: string | null;
}): Promise<SentimentResult> {
  const hint = normalizeLang(languageHint);
  const detected = normalizeLang(detect(text)) ?? hint ?? "en";

  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const hasOllama = Boolean(process.env.OLLAMA_BASE_URL);

  const system = `You are PressPulse, a multilingual sentiment classifier for PR/media monitoring.

Analyze the sentiment of the provided text in its native language (Arabic, French, or English). Do not translate the text itself.
Classify the sentiment as exactly one of: POSITIVE, NEUTRAL, NEGATIVE.
Return a confidence score from 0 to 100.

Output STRICT JSON with keys:
{
  "sentiment": "POSITIVE",
  "confidence": 95,
  "reasoning_native": "Brief explanation in the detected language",
  "reasoning_en": "English translation of the reasoning_native (not of the full text)",
  "detected_language": "ar" | "fr" | "en"
}`;

  const user = `Language hint: ${hint ?? "unknown"}.
Detected language (client-side): ${detected}.

Text:
"""${text}"""`;

  if (!hasOpenAiKey && !hasOllama) {
    // Zero-cost fallback (no LLM). This is less accurate than an LLM, but lets the app run fully free.
    const lc = text.toLowerCase();
    const ar = /[\u0600-\u06FF]/.test(text);
    const fr = /\b(ce|cette|pas|plus|moins|très|grève|crise|perturbations|annulations)\b/i.test(
      text
    );

    const posHits = [
      "success",
      "boost",
      "record",
      "growth",
      "improves",
      "wins",
      "praised",
      "نجاح",
      "يعزز",
      "إيجابي",
      "ارتفاع",
      "تحسن",
      "نجاحًا",
      "succès",
      "hausse",
      "améliore",
      "positif",
      "réussite"
    ].filter((w) => lc.includes(w.toLowerCase())).length;

    const negHits = [
      "crisis",
      "collapse",
      "strike",
      "disruption",
      "delays",
      "cancellations",
      "lawsuit",
      "decline",
      "سلبية",
      "أزمة",
      "انهيار",
      "إضراب",
      "تأخير",
      "إلغاء",
      "خسائر",
      "crise",
      "grève",
      "perturbations",
      "annulations",
      "retards",
      "baisse",
      "négatif"
    ].filter((w) => lc.includes(w.toLowerCase())).length;

    const sentiment =
      posHits > negHits ? "POSITIVE" : negHits > posHits ? "NEGATIVE" : "NEUTRAL";
    const confidence = Math.max(55, Math.min(85, 60 + Math.abs(posHits - negHits) * 8));

    const detected_language: "ar" | "fr" | "en" = ar ? "ar" : fr ? "fr" : detected;
    const reasoning_en =
      sentiment === "POSITIVE"
        ? "The text includes multiple positive indicators suggesting a favorable tone."
        : sentiment === "NEGATIVE"
          ? "The text includes multiple negative indicators suggesting an unfavorable tone."
          : "The text appears mostly factual or mixed, suggesting a neutral tone.";

    const reasoning_native =
      detected_language === "ar"
        ? sentiment === "POSITIVE"
          ? "يتضمن النص مؤشرات إيجابية متعددة مما يشير إلى نبرة إيجابية."
          : sentiment === "NEGATIVE"
            ? "يتضمن النص مؤشرات سلبية متعددة مما يشير إلى نبرة سلبية."
            : "النص في الغالب وصفي/معلوماتي أو مختلط، مما يشير إلى نبرة محايدة."
        : detected_language === "fr"
          ? sentiment === "POSITIVE"
            ? "Le texte contient plusieurs indicateurs positifs, suggérant une tonalité favorable."
            : sentiment === "NEGATIVE"
              ? "Le texte contient plusieurs indicateurs négatifs, suggérant une tonalité défavorable."
              : "Le texte est plutôt factuel ou mitigé, suggérant une tonalité neutre."
          : reasoning_en;

    return {
      sentiment,
      confidence,
      reasoning_native,
      reasoning_en,
      detected_language
    };
  }

  const model = hasOpenAiKey
    ? openai("gpt-4o-mini")
    : createOpenAI({
        baseURL: process.env.OLLAMA_BASE_URL!,
        apiKey: "ollama"
      })(process.env.OLLAMA_MODEL ?? "llama3.1:8b");

  const result = await generateObject({
    model,
    system,
    prompt: user,
    schema: SentimentResultSchema,
    temperature: 0
  });

  return result.object;
}


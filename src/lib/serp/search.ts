// SERP search: tries SerpAPI first (rich results), falls back to Google News RSS (free, unlimited).
// When topic language is null (any), runs searches in FR, AR, EN in parallel for max coverage.

import Parser from "rss-parser";

export type SerpHit = {
  url: string;
  title: string;
  snippet: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  provider: "serpapi" | "google_news";
};

const serpApiKey = () => process.env.SERPAPI_KEY;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]
      .forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

function dedupe(hits: SerpHit[]): SerpHit[] {
  const seen = new Set<string>();
  const out: SerpHit[] = [];
  for (const h of hits) {
    const key = normalizeUrl(h.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...h, url: key });
  }
  return out;
}

function tryParseDate(s: string): string | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function serpApiSearch(
  query: string,
  language: "en" | "fr" | "ar"
): Promise<SerpHit[]> {
  const key = serpApiKey();
  if (!key) return [];

  const params = new URLSearchParams({
    engine: "google",
    q: query,
    tbm: "nws",
    num: "30",
    hl: language,
    api_key: key
  });

  // Morocco-focused for AR and FR queries (national media), global for EN
  if (language === "ar" || language === "fr") {
    params.set("gl", "ma");
  }

  const resp = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(30_000)
  }).catch(() => null);

  if (!resp || !resp.ok) {
    if (resp) console.warn("[serp] serpapi non-ok", resp.status, language);
    return [];
  }

  const data = (await resp.json().catch(() => null)) as {
    news_results?: Array<{
      link?: string;
      title?: string;
      snippet?: string;
      source?: string;
      date?: string;
    }>;
  } | null;

  return (data?.news_results ?? [])
    .filter((r) => r.link && r.title)
    .map((r) => ({
      url: r.link!,
      title: r.title!.trim(),
      snippet: r.snippet?.trim() ?? null,
      sourceName: r.source?.trim() ?? null,
      publishedAt: r.date ? tryParseDate(r.date) : null,
      provider: "serpapi" as const
    }));
}

async function googleNewsRssSearch(
  query: string,
  language: "en" | "fr" | "ar"
): Promise<SerpHit[]> {
  const hl = language;
  const gl = language === "fr" ? "FR" : language === "ar" ? "MA" : "US";
  // For Arabic, Moroccan locale (ar-MA) gets better Moroccan media coverage
  const ceid = language === "ar" ? "MA:ar" : `${gl}:${hl}`;

  const url =
    `https://news.google.com/rss/search?` +
    new URLSearchParams({ q: query, hl, gl, ceid }).toString();

  const parser = new Parser({
    timeout: 20_000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PressPulseBot/1.0)"
    }
  });

  const feed = await parser.parseURL(url).catch((err) => {
    console.warn("[serp] google news rss failed", language, err?.message);
    return null;
  });

  if (!feed) return [];

  return (feed.items ?? [])
    .filter((it) => it.link && it.title)
    .map((it) => {
      // Google News titles come as "Actual title - Publisher Name"
      // Extract the publisher from the suffix and clean the title
      let title = (it.title ?? "").trim();
      let sourceName: string | null = null;

      // Prefer explicit source field if present
      const srcField = (it as { source?: string | { _?: string } }).source;
      if (srcField) {
        sourceName =
          typeof srcField === "object" ? (srcField._ ?? null) : (srcField as string);
      }

      // Fall back to parsing " - Publisher" from title
      if (!sourceName) {
        const dashMatch = title.match(/^(.+?)\s+-\s+([^-]+)$/);
        if (dashMatch) {
          title = dashMatch[1].trim();
          sourceName = dashMatch[2].trim();
        }
      } else {
        // If we have a source and title still contains " - SourceName", strip it
        const suffix = ` - ${sourceName}`;
        if (title.endsWith(suffix)) {
          title = title.slice(0, -suffix.length).trim();
        }
      }

      return {
        url: it.link!,
        title,
        snippet: (it.contentSnippet ?? it.content ?? "").toString().slice(0, 500) || null,
        sourceName,
        publishedAt: it.isoDate ?? (it.pubDate ? tryParseDate(it.pubDate) : null),
        provider: "google_news" as const
      };
    });
}

/**
 * Search the web for articles matching the topic query.
 * If language is null, searches in FR, AR, EN in parallel for maximum coverage.
 */
export async function searchSerp(
  query: string,
  language: "en" | "fr" | "ar" | null = null
): Promise<SerpHit[]> {
  const languages: Array<"en" | "fr" | "ar"> =
    language === null ? ["fr", "ar", "en"] : [language];

  // Run all (provider × language) combinations in parallel
  const jobs: Promise<SerpHit[]>[] = [];
  for (const lang of languages) {
    jobs.push(
      serpApiSearch(query, lang).catch((err) => {
        console.warn("[serp] serpapi error", lang, err?.message);
        return [] as SerpHit[];
      })
    );
    jobs.push(
      googleNewsRssSearch(query, lang).catch((err) => {
        console.warn("[serp] google news error", lang, err?.message);
        return [] as SerpHit[];
      })
    );
  }

  const allResults = (await Promise.all(jobs)).flat();
  return dedupe(allResults);
}

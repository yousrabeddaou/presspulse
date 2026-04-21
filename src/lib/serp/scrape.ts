// Content scraping: uses Jina Reader (https://jina.ai/reader) — free, no key required,
// returns clean markdown-ish text. Falls back to raw HTML fetch + basic extraction on failure.
//
// Also handles Google News URL unwrapping: news.google.com URLs are redirects to
// the actual publisher. We resolve the redirect once, then scrape the real URL.

export type ScrapeResult = {
  text: string;
  title: string | null;
  /** The final URL after any redirects (e.g. hespress.com, not news.google.com) */
  resolvedUrl: string;
};

/**
 * Google News wraps publisher URLs in its own redirect. Unwrap to get the real URL.
 * Works for both /articles/ and /rss/articles/ variants.
 */
export async function unwrapGoogleNewsUrl(url: string): Promise<string> {
  if (!/news\.google\.com/.test(url)) return url;

  try {
    // Follow redirects via HEAD first (faster, no body)
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (resp.url && !resp.url.includes("news.google.com")) {
      return resp.url;
    }
  } catch {
    // HEAD failed, fall through to GET
  }

  try {
    // Some servers don't support HEAD — try GET
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(12_000)
    });

    if (resp.url && !resp.url.includes("news.google.com")) {
      return resp.url;
    }

    // Last resort: parse HTML for meta refresh or canonical link
    const html = await resp.text();
    const canonical = html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    );
    if (canonical?.[1] && !canonical[1].includes("news.google.com")) {
      return canonical[1];
    }
    const metaRefresh = html.match(
      /<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"'>\s]+)/i
    );
    if (metaRefresh?.[1] && !metaRefresh[1].includes("news.google.com")) {
      return metaRefresh[1];
    }
  } catch (err) {
    console.warn("[scrape] unwrap failed", (err as Error)?.message);
  }

  return url;
}

/**
 * Fetch clean article text via Jina Reader.
 * Prefix URL with https://r.jina.ai/ and it returns parsed content.
 */
async function scrapeViaJina(url: string): Promise<{ text: string; title: string | null } | null> {
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/plain",
        "User-Agent": "Mozilla/5.0 (compatible; PressPulseBot/1.0)"
      },
      signal: AbortSignal.timeout(25_000)
    });

    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || text.length < 50) return null;

    const titleMatch = text.match(/^Title:\s*(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? null;

    const contentStart = text.indexOf("Markdown Content:");
    const cleaned =
      contentStart >= 0 ? text.slice(contentStart + "Markdown Content:".length).trim() : text;

    return { text: cleaned.slice(0, 20_000), title };
  } catch (err) {
    console.warn("[scrape] jina failed", (err as Error)?.message);
    return null;
  }
}

async function scrapeViaRawHtml(
  url: string
): Promise<{ text: string; title: string | null } | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow"
    });

    if (!resp.ok) return null;
    const html = await resp.text();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? null;

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20_000);

    if (text.length < 100) return null;
    return { text, title };
  } catch (err) {
    console.warn("[scrape] raw html failed", (err as Error)?.message);
    return null;
  }
}

export async function scrapeUrl(url: string): Promise<ScrapeResult | null> {
  // 1. Resolve Google News redirects to the real publisher URL
  const resolvedUrl = await unwrapGoogleNewsUrl(url);

  // 2. Try Jina Reader on the resolved URL
  const jina = await scrapeViaJina(resolvedUrl);
  if (jina) return { ...jina, resolvedUrl };

  // 3. Fall back to raw HTML
  const raw = await scrapeViaRawHtml(resolvedUrl);
  if (raw) return { ...raw, resolvedUrl };

  return null;
}

export function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

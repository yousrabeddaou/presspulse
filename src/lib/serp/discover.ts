// Discovery orchestrator: given a topic, search the web, scrape pages,
// run sentiment, score authority, upsert articles, tag to topic, log the run.

import type { SupabaseClient } from "@supabase/supabase-js";
import { detect } from "tinyld";
import { searchSerp, type SerpHit } from "./search";
import { scrapeUrl, extractDomain, unwrapGoogleNewsUrl } from "./scrape";
import { getDomainAuthorities } from "./authority";
import { analyzeSentiment } from "@/lib/ai/sentiment";
import { withRetry } from "@/lib/ai/retry";

const MAX_HITS_PER_RUN = 30;
const MAX_SCRAPES_PER_RUN = 20;
const MAX_SENTIMENT_PER_RUN = 20;
const SCRAPE_CONCURRENCY = 4;

type Topic = {
  id: string;
  workspace_id: string;
  name: string;
  query: string;
  language: "en" | "fr" | "ar" | null;
};

type RunStats = {
  results_found: number;
  articles_created: number;
  articles_updated: number;
  errors: string[];
};

function normLang(lang?: string | null): "ar" | "fr" | "en" {
  const l = (lang ?? "").toLowerCase();
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("fr")) return "fr";
  return "en";
}

async function pMapConcurrent<T, U>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        results[idx] = undefined as unknown as U;
        console.warn("[discover] worker error", (err as Error)?.message);
      }
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, runner);
  await Promise.all(runners);
  return results;
}

export async function discoverTopic(
  supabase: SupabaseClient,
  topic: Topic,
  trigger: "manual" | "cron" | "auto" = "manual"
): Promise<RunStats & { run_id: string }> {
  const stats: RunStats = {
    results_found: 0,
    articles_created: 0,
    articles_updated: 0,
    errors: []
  };

  const { data: runRow } = await supabase
    .from("topic_runs")
    .insert({
      topic_id: topic.id,
      workspace_id: topic.workspace_id,
      status: "running",
      trigger
    })
    .select("id")
    .single();

  const runId = runRow?.id as string;

  try {
    // 1. SERP search (multi-language if topic.language is null)
    const hits = await searchSerp(topic.query, topic.language);
    stats.results_found = hits.length;

    const limited = hits.slice(0, MAX_HITS_PER_RUN);

    // 2. Pre-resolve Google News URLs BEFORE checking existing — critical for dedup
    //    Otherwise we'd think news.google.com/xyz and hespress.com/article are different.
    const preResolvedHits: Array<SerpHit & { finalUrl: string }> = await pMapConcurrent(
      limited,
      8,
      async (hit) => ({
        ...hit,
        finalUrl: await unwrapGoogleNewsUrl(hit.url)
      })
    );

    // 3. Check which final URLs we already have
    const finalUrls = preResolvedHits.map((h) => h.finalUrl);
    const { data: existing } = await supabase
      .from("articles")
      .select("id, url, sentiment")
      .eq("workspace_id", topic.workspace_id)
      .in("url", finalUrls);

    const existingMap = new Map(
      (existing ?? []).map((a) => [a.url as string, a])
    );

    // Hits we need to scrape (new OR old-but-no-sentiment)
    const toScrape = preResolvedHits.filter((h) => {
      const ex = existingMap.get(h.finalUrl);
      return !ex || !ex.sentiment;
    });
    const scrapeBudget = toScrape.slice(0, MAX_SCRAPES_PER_RUN);

    // 4. Parallel scrape
    type Enriched = {
      hit: SerpHit & { finalUrl: string };
      scraped: { text: string; title: string | null; resolvedUrl: string } | null;
      domain: string | null;
    };

    const enriched: Enriched[] = await pMapConcurrent(
      scrapeBudget,
      SCRAPE_CONCURRENCY,
      async (hit) => {
        const scraped = await scrapeUrl(hit.finalUrl);
        // scraped.resolvedUrl may differ from finalUrl if there are further redirects
        const effectiveUrl = scraped?.resolvedUrl ?? hit.finalUrl;
        return {
          hit,
          scraped,
          domain: extractDomain(effectiveUrl)
        };
      }
    );

    // 5. Batch-fetch domain authorities
    const domains = Array.from(
      new Set(enriched.map((e) => e.domain).filter((d): d is string => !!d))
    );
    const authorities = await getDomainAuthorities(supabase, domains);

    // 6. Sentiment + upsert + tag
    let sentimentBudget = MAX_SENTIMENT_PER_RUN;

    for (const { hit, scraped, domain } of enriched) {
      try {
        const effectiveUrl = scraped?.resolvedUrl ?? hit.finalUrl;
        const rawText = scraped?.text ?? hit.snippet ?? hit.title;
        const titleFinal = scraped?.title ?? hit.title;

        const detected = normLang(
          topic.language ?? detect(`${titleFinal}\n${rawText}`)
        );

        let sentimentRow: {
          sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
          confidence: number;
          reasoning_native: string;
          reasoning_en: string;
          language: "ar" | "fr" | "en";
        } | null = null;

        if (sentimentBudget > 0) {
          sentimentBudget--;
          const s = await withRetry(
            () => analyzeSentiment({ text: rawText, languageHint: detected }),
            { maxAttempts: 3 }
          ).catch((err) => {
            stats.errors.push(`sentiment: ${(err as Error).message}`);
            return null;
          });
          if (s) {
            sentimentRow = {
              sentiment: s.sentiment,
              confidence: s.confidence,
              reasoning_native: s.reasoning_native,
              reasoning_en: s.reasoning_en,
              language: s.detected_language
            };
          }
        }

        const authority = domain ? authorities.get(domain) ?? null : null;
        const existed = existingMap.has(effectiveUrl);

        const row = {
          workspace_id: topic.workspace_id,
          url: effectiveUrl,
          source_name: hit.sourceName ?? domain ?? "Unknown",
          title: titleFinal.slice(0, 400),
          language: sentimentRow?.language ?? detected,
          snippet: (hit.snippet ?? rawText).slice(0, 300),
          published_at: hit.publishedAt,
          raw_text: rawText.slice(0, 20_000),
          domain,
          domain_authority: authority,
          discovered_via: hit.provider === "serpapi" ? "serp" : "news",
          ...(sentimentRow
            ? {
                sentiment: sentimentRow.sentiment,
                confidence: sentimentRow.confidence,
                reasoning_native: sentimentRow.reasoning_native,
                reasoning_en: sentimentRow.reasoning_en
              }
            : {})
        };

        const { data: upserted, error: upErr } = await supabase
          .from("articles")
          .upsert(row, {
            onConflict: "workspace_id,url",
            ignoreDuplicates: false
          })
          .select("id")
          .single();

        if (upErr) {
          stats.errors.push(`upsert: ${upErr.message}`);
          continue;
        }

        if (existed) stats.articles_updated++;
        else stats.articles_created++;

        await supabase.from("article_topics").upsert(
          {
            article_id: upserted.id,
            topic_id: topic.id,
            match_method: "discover"
          },
          { onConflict: "article_id,topic_id", ignoreDuplicates: false }
        );
      } catch (err) {
        stats.errors.push(`hit ${hit.url}: ${(err as Error).message}`);
      }
    }

    // 7. Tag already-analyzed articles we skipped scraping
    for (const hit of preResolvedHits) {
      const ex = existingMap.get(hit.finalUrl);
      if (!ex || !ex.sentiment) continue;
      await supabase.from("article_topics").upsert(
        { article_id: ex.id, topic_id: topic.id, match_method: "discover" },
        { onConflict: "article_id,topic_id", ignoreDuplicates: false }
      );
    }

    await supabase
      .from("topics")
      .update({ last_discovered_at: new Date().toISOString() })
      .eq("id", topic.id);

    await supabase
      .from("topic_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: stats.errors.length > 0 ? "partial" : "success",
        results_found: stats.results_found,
        articles_created: stats.articles_created,
        articles_updated: stats.articles_updated,
        error_message: stats.errors.length ? stats.errors.slice(0, 5).join(" | ") : null
      })
      .eq("id", runId);

    return { ...stats, run_id: runId };
  } catch (err) {
    const msg = (err as Error).message;
    await supabase
      .from("topic_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: msg
      })
      .eq("id", runId);
    throw err;
  }
}

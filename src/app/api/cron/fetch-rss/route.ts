import { NextResponse } from "next/server";
import Parser from "rss-parser";
import { detect } from "tinyld";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { analyzeSentiment } from "@/lib/ai/sentiment";
import { withRetry } from "@/lib/ai/retry";
import { matchesTopicQuery } from "@/lib/topics/match";

export const runtime = "nodejs";

const parser = new Parser();

function normLang(lang?: string | null): "ar" | "fr" | "en" {
  const l = (lang ?? "").toLowerCase();
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("fr")) return "fr";
  return "en";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();

  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("id, workspace_id, url, title")
    .eq("kind", "rss");

  if (sourcesError) {
    return NextResponse.json(
      { error: sourcesError.message },
      { status: 500 }
    );
  }

  const maxItemsPerSource = 20;
  const maxAnalysesPerRun = 30;
  let analysesUsed = 0;
  let upserts = 0;
  let fetched = 0;

  for (const source of sources ?? []) {
    const { data: topics } = await supabase
      .from("topics")
      .select("id,query,language,is_active")
      .eq("workspace_id", source.workspace_id)
      .eq("is_active", true);

    const feed = await withRetry(async () => {
      const f = await parser.parseURL(source.url);
      return f;
    });

    fetched++;

    const items = (feed.items ?? []).slice(0, maxItemsPerSource);
    for (const item of items) {
      const link = item.link ?? (item.guid as string | undefined) ?? null;
      if (!link) continue;

      const title = (item.title ?? "").trim();
      if (!title) continue;

      const snippet =
        (item.contentSnippet ?? item.content ?? item.summary ?? "")
          .toString()
          .slice(0, 2000) || null;

      const publishedAt = item.isoDate
        ? new Date(item.isoDate).toISOString()
        : item.pubDate
          ? new Date(item.pubDate).toISOString()
          : null;

      const guess = detect(`${title}\n${snippet ?? ""}`);
      const language = normLang(guess);

      const rawText = `${title}\n\n${snippet ?? ""}`.trim();

      const baseRow = {
        workspace_id: source.workspace_id,
        source_id: source.id,
        url: link,
        source_name: feed.title ?? source.title ?? null,
        title,
        language,
        snippet,
        published_at: publishedAt,
        raw_text: rawText
      };

      // Upsert by (workspace_id, url) unique constraint.
      const { data: upserted, error: upsertErr } = await supabase
        .from("articles")
        .upsert(baseRow, {
          onConflict: "workspace_id,url",
          ignoreDuplicates: false
        })
        .select("id, sentiment, confidence, reasoning_native, reasoning_en")
        .single();

      if (upsertErr) continue;
      upserts++;

      // Auto-tag topics
      for (const topic of topics ?? []) {
        if (topic.language && topic.language !== language) continue;
        if (!matchesTopicQuery({ title, snippet, rawText }, topic.query)) continue;
        await supabase.from("article_topics").upsert(
          { article_id: upserted.id, topic_id: topic.id, match_method: "rss" },
          { onConflict: "article_id,topic_id", ignoreDuplicates: false }
        );
      }

      const needsAnalysis = !upserted?.sentiment;
      if (!needsAnalysis) continue;
      if (analysesUsed >= maxAnalysesPerRun) continue;

      analysesUsed++;
      const sentiment = await withRetry(
        async () => analyzeSentiment({ text: rawText, languageHint: language }),
        { maxAttempts: 4 }
      );

      await supabase
        .from("articles")
        .update({
          sentiment: sentiment.sentiment,
          confidence: sentiment.confidence,
          reasoning_native: sentiment.reasoning_native,
          reasoning_en: sentiment.reasoning_en,
          language: sentiment.detected_language
        })
        .eq("id", upserted.id);
    }

    await supabase
      .from("sources")
      .update({ last_polled_at: new Date().toISOString() })
      .eq("id", source.id);
  }

  return NextResponse.json({
    ok: true,
    sources: sources?.length ?? 0,
    feedsFetched: fetched,
    articleUpserts: upserts,
    analysesUsed
  });
}


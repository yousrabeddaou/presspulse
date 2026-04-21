import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";
import { analyzeSentiment } from "@/lib/ai/sentiment";
import { withRetry } from "@/lib/ai/retry";
import { matchesTopicQuery } from "@/lib/topics/match";

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ articles: [] });

  const url = new URL(req.url);
  const language = url.searchParams.get("language");
  const sentiment = url.searchParams.get("sentiment");

  let query = supabase
    .from("articles")
    .select(
      "id,created_at,source_name,url,title,language,snippet,published_at,sentiment,confidence,reasoning_native,reasoning_en"
    )
    .eq("workspace_id", workspaceId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (language && ["en", "fr", "ar"].includes(language)) query = query.eq("language", language);
  if (sentiment && ["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(sentiment))
    query = query.eq("sentiment", sentiment);

  const { data: articles, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ articles: articles ?? [] });
}

const ManualSchema = z.object({
  url: z.string().url().optional(),
  text: z.string().min(1).max(50_000).optional(),
  title: z.string().min(1).max(400).optional(),
  sourceName: z.string().min(1).max(200).optional(),
  languageHint: z.string().optional().nullable()
});

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const json = await req.json().catch(() => null);
  const parsed = ManualSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { url, text, title, sourceName, languageHint } = parsed.data;
  const rawText = (text ?? url ?? "").trim();
  if (!rawText) return NextResponse.json({ error: "text or url required" }, { status: 400 });

  const analysis = await withRetry(
    async () => analyzeSentiment({ text: rawText, languageHint }),
    { maxAttempts: 4 }
  );

  const articleTitle = title ?? (url ? `Manual: ${new URL(url).hostname}` : "Manual paste");

  const { data: inserted, error } = await supabase
    .from("articles")
    .upsert(
      {
        workspace_id: workspaceId,
        url: url ?? null,
        source_name: sourceName ?? (url ? new URL(url).hostname : "Manual"),
        title: articleTitle,
        language: analysis.detected_language,
        snippet: rawText.slice(0, 300),
        published_at: new Date().toISOString(),
        sentiment: analysis.sentiment,
        confidence: analysis.confidence,
        reasoning_native: analysis.reasoning_native,
        reasoning_en: analysis.reasoning_en,
        raw_text: rawText
      },
      { onConflict: "workspace_id,url", ignoreDuplicates: false }
    )
    .select(
      "id,created_at,source_name,url,title,language,snippet,published_at,sentiment,confidence,reasoning_native,reasoning_en"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-tag against active topics (simple AND-token matcher)
  const { data: topics } = await supabase
    .from("topics")
    .select("id,query,language,is_active")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  const articleText = {
    title: inserted.title,
    snippet: inserted.snippet,
    rawText
  };

  for (const topic of topics ?? []) {
    if (topic.language && topic.language !== inserted.language) continue;
    if (!matchesTopicQuery(articleText, topic.query)) continue;
    await supabase.from("article_topics").upsert(
      { article_id: inserted.id, topic_id: topic.id, match_method: "manual" },
      { onConflict: "article_id,topic_id", ignoreDuplicates: false }
    );
  }

  return NextResponse.json({ article: inserted });
}


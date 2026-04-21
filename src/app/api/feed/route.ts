import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";
import { analyzeSentiment } from "@/lib/ai/sentiment";
import { withRetry } from "@/lib/ai/retry";
import { matchesTopicQuery } from "@/lib/topics/match";
import { extractDomain } from "@/lib/serp/scrape";

const ARTICLE_COLUMNS =
  "id,created_at,source_name,url,title,language,snippet,published_at,sentiment,confidence,reasoning_native,reasoning_en,domain,domain_authority,discovered_via";

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ articles: [], total: 0 });

  const url = new URL(req.url);
  const language = url.searchParams.get("language");
  const sentiment = url.searchParams.get("sentiment");
  const sort = url.searchParams.get("sort");
  const topicId = url.searchParams.get("topicId");
  const projectId = url.searchParams.get("projectId");
  const dateFrom = url.searchParams.get("dateFrom"); // ISO date
  const dateTo = url.searchParams.get("dateTo");
  const page = Math.max(0, parseInt(url.searchParams.get("page") ?? "0", 10));
  const pageSize = Math.min(
    200,
    Math.max(10, parseInt(url.searchParams.get("pageSize") ?? "20", 10))
  );

  // If topicId given → filter via article_topics; if projectId given → get its topics first
  let restrictToArticleIds: string[] | null = null;

  if (topicId) {
    const { data: joins } = await supabase
      .from("article_topics")
      .select("article_id")
      .eq("topic_id", topicId);
    restrictToArticleIds = (joins ?? []).map((j) => j.article_id);
    if (!restrictToArticleIds.length) {
      return NextResponse.json({ articles: [], total: 0 });
    }
  } else if (projectId) {
    const { data: projectTopics } = await supabase
      .from("topics")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId);
    const topicIds = (projectTopics ?? []).map((t) => t.id);
    if (!topicIds.length) {
      return NextResponse.json({ articles: [], total: 0 });
    }
    const { data: joins } = await supabase
      .from("article_topics")
      .select("article_id")
      .in("topic_id", topicIds);
    const uniq = new Set<string>();
    for (const j of joins ?? []) uniq.add(j.article_id);
    restrictToArticleIds = Array.from(uniq);
    if (!restrictToArticleIds.length) {
      return NextResponse.json({ articles: [], total: 0 });
    }
  }

  let query = supabase
    .from("articles")
    .select(ARTICLE_COLUMNS, { count: "exact" })
    .eq("workspace_id", workspaceId);

  if (restrictToArticleIds) query = query.in("id", restrictToArticleIds);
  if (language && ["en", "fr", "ar"].includes(language)) query = query.eq("language", language);
  if (sentiment && ["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(sentiment))
    query = query.eq("sentiment", sentiment);
  if (dateFrom) query = query.gte("published_at", dateFrom);
  if (dateTo) query = query.lte("published_at", dateTo);

  if (sort === "authority") {
    query = query
      .order("domain_authority", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false });
  } else {
    query = query
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
  }

  const from = page * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data: articles, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    articles: articles ?? [],
    total: count ?? 0,
    page,
    pageSize
  });
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
  const domain = url ? extractDomain(url) : null;

  const { data: inserted, error } = await supabase
    .from("articles")
    .upsert(
      {
        workspace_id: workspaceId,
        url: url ?? null,
        source_name: sourceName ?? domain ?? "Manual",
        title: articleTitle,
        language: analysis.detected_language,
        snippet: rawText.slice(0, 300),
        published_at: new Date().toISOString(),
        sentiment: analysis.sentiment,
        confidence: analysis.confidence,
        reasoning_native: analysis.reasoning_native,
        reasoning_en: analysis.reasoning_en,
        raw_text: rawText,
        domain,
        discovered_via: "manual"
      },
      { onConflict: "workspace_id,url", ignoreDuplicates: false }
    )
    .select(ARTICLE_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: topics } = await supabase
    .from("topics")
    .select("id,query,language,is_active")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  const articleText = { title: inserted.title, snippet: inserted.snippet, rawText };

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

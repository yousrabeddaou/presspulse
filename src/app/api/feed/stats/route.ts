import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";

// Returns aggregated stats for the dashboard graphs,
// respecting the same filters as /api/feed so graphs match the article list.
export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ sentiment: {}, timeline: [], topDomains: [], total: 0 });

  const url = new URL(req.url);
  const language = url.searchParams.get("language");
  const sentimentFilter = url.searchParams.get("sentiment");
  const topicId = url.searchParams.get("topicId");
  const projectId = url.searchParams.get("projectId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  let restrictToArticleIds: string[] | null = null;

  if (topicId) {
    const { data: joins } = await supabase
      .from("article_topics")
      .select("article_id")
      .eq("topic_id", topicId);
    restrictToArticleIds = (joins ?? []).map((j) => j.article_id);
    if (!restrictToArticleIds.length) {
      return NextResponse.json({ sentiment: {}, timeline: [], topDomains: [], total: 0 });
    }
  } else if (projectId) {
    const { data: projectTopics } = await supabase
      .from("topics")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId);
    const topicIds = (projectTopics ?? []).map((t) => t.id);
    if (!topicIds.length) {
      return NextResponse.json({ sentiment: {}, timeline: [], topDomains: [], total: 0 });
    }
    const { data: joins } = await supabase
      .from("article_topics")
      .select("article_id")
      .in("topic_id", topicIds);
    const uniq = new Set<string>();
    for (const j of joins ?? []) uniq.add(j.article_id);
    restrictToArticleIds = Array.from(uniq);
    if (!restrictToArticleIds.length) {
      return NextResponse.json({ sentiment: {}, timeline: [], topDomains: [], total: 0 });
    }
  }

  let q = supabase
    .from("articles")
    .select("sentiment, domain, domain_authority, published_at, created_at, language")
    .eq("workspace_id", workspaceId)
    .limit(5000);

  if (restrictToArticleIds) q = q.in("id", restrictToArticleIds);
  if (language && ["en", "fr", "ar"].includes(language)) q = q.eq("language", language);
  if (sentimentFilter && ["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(sentimentFilter))
    q = q.eq("sentiment", sentimentFilter);
  if (dateFrom) q = q.gte("published_at", dateFrom);
  if (dateTo) q = q.lte("published_at", dateTo);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sentiment breakdown
  const sentiment = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0, UNKNOWN: 0 };
  // Timeline: articles per day, grouped by sentiment
  const timelineMap = new Map<
    string,
    { date: string; positive: number; neutral: number; negative: number }
  >();
  // Top domains (by article count)
  const domainMap = new Map<string, { domain: string; count: number; authority: number | null }>();
  // Language breakdown
  const languageMap = { en: 0, fr: 0, ar: 0 };

  for (const r of rows ?? []) {
    const s = (r.sentiment ?? "UNKNOWN") as keyof typeof sentiment;
    sentiment[s] = (sentiment[s] ?? 0) + 1;

    if (r.language && r.language in languageMap) {
      languageMap[r.language as keyof typeof languageMap]++;
    }

    const dateKey = (r.published_at ?? r.created_at ?? "").slice(0, 10); // YYYY-MM-DD
    if (dateKey) {
      const existing = timelineMap.get(dateKey) ?? {
        date: dateKey,
        positive: 0,
        neutral: 0,
        negative: 0
      };
      if (r.sentiment === "POSITIVE") existing.positive++;
      else if (r.sentiment === "NEGATIVE") existing.negative++;
      else if (r.sentiment === "NEUTRAL") existing.neutral++;
      timelineMap.set(dateKey, existing);
    }

    if (r.domain) {
      const existing = domainMap.get(r.domain) ?? {
        domain: r.domain,
        count: 0,
        authority: r.domain_authority ?? null
      };
      existing.count++;
      if (r.domain_authority != null) existing.authority = r.domain_authority;
      domainMap.set(r.domain, existing);
    }
  }

  const timeline = Array.from(timelineMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  const topDomains = Array.from(domainMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return NextResponse.json({
    sentiment,
    language: languageMap,
    timeline,
    topDomains,
    total: rows?.length ?? 0
  });
}

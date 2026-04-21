import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";

// Naive server-side matcher: require all whitespace tokens to exist somewhere.
function matches(articleText: string, query: string): boolean {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return false;
  const hay = articleText.toLowerCase();
  return tokens.every((t) => hay.includes(t.toLowerCase()));
}

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: topics, error: tErr } = await supabase
    .from("topics")
    .select("id,query,language,is_active")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const { data: articles, error: aErr } = await supabase
    .from("articles")
    .select("id,title,snippet,raw_text,language")
    .eq("workspace_id", workspaceId)
    .limit(2000);

  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  let created = 0;
  for (const topic of topics ?? []) {
    for (const a of articles ?? []) {
      if (topic.language && topic.language !== a.language) continue;
      const text = `${a.title}\n${a.snippet ?? ""}\n${a.raw_text ?? ""}`;
      if (!matches(text, topic.query)) continue;

      const { error } = await supabase.from("article_topics").upsert(
        {
          article_id: a.id,
          topic_id: topic.id,
          match_method: "backfill"
        },
        { onConflict: "article_id,topic_id", ignoreDuplicates: false }
      );
      if (!error) created++;
    }
  }

  return NextResponse.json({ ok: true, created });
}


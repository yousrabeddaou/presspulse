import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { discoverTopic } from "@/lib/serp/discover";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron handler: finds topics with auto_discover=true whose last_discovered_at
 * is older than discover_interval_hours, and runs discovery for each.
 * Rate-limits to N topics per invocation to stay within Vercel cron budget.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();

  const MAX_TOPICS_PER_RUN = 10;

  // Fetch active auto-discover topics, oldest-refreshed first
  const { data: topics, error } = await supabase
    .from("topics")
    .select("id, workspace_id, name, query, language, last_discovered_at, discover_interval_hours")
    .eq("is_active", true)
    .eq("auto_discover", true)
    .order("last_discovered_at", { ascending: true, nullsFirst: true })
    .limit(MAX_TOPICS_PER_RUN);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const due = (topics ?? []).filter((t) => {
    if (!t.last_discovered_at) return true;
    const last = new Date(t.last_discovered_at).getTime();
    const intervalMs = (t.discover_interval_hours ?? 6) * 60 * 60 * 1000;
    return now - last >= intervalMs;
  });

  const summary = {
    topics_checked: topics?.length ?? 0,
    topics_run: 0,
    total_created: 0,
    total_updated: 0,
    errors: [] as string[]
  };

  // Run sequentially — each topic can be slow (scraping, LLM) and we
  // don't want to blow a free-tier budget in parallel.
  for (const t of due) {
    try {
      const stats = await discoverTopic(
        supabase,
        {
          id: t.id,
          workspace_id: t.workspace_id,
          name: t.name,
          query: t.query,
          language: t.language
        },
        "cron"
      );
      summary.topics_run++;
      summary.total_created += stats.articles_created;
      summary.total_updated += stats.articles_updated;
    } catch (err) {
      summary.errors.push(`${t.name}: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}

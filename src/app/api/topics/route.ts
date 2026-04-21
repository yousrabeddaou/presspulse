import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  query: z.string().min(1).max(300),
  language: z.enum(["en", "fr", "ar"]).optional().nullable(),
  isActive: z.boolean().optional(),
  autoDiscover: z.boolean().optional(),
  discoverIntervalHours: z.number().int().min(1).max(168).optional(),
  projectId: z.string().uuid().optional().nullable()
});

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ topics: [] });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");

  let q = supabase
    .from("topics")
    .select(
      "id,created_at,name,query,language,is_active,auto_discover,last_discovered_at,discover_interval_hours,project_id"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (projectId === "none") {
    q = q.is("project_id", null);
  } else if (projectId) {
    q = q.eq("project_id", projectId);
  }

  const { data: topics, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch article counts per topic (via article_topics join)
  const topicIds = (topics ?? []).map((t) => t.id);
  const counts = new Map<string, number>();
  if (topicIds.length) {
    const { data: joins } = await supabase
      .from("article_topics")
      .select("topic_id")
      .in("topic_id", topicIds);
    for (const row of joins ?? []) {
      counts.set(row.topic_id, (counts.get(row.topic_id) ?? 0) + 1);
    }
  }

  const enriched = (topics ?? []).map((t) => ({
    ...t,
    articles_count: counts.get(t.id) ?? 0
  }));

  return NextResponse.json({ topics: enriched });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, query, language, isActive, autoDiscover, discoverIntervalHours, projectId } =
    parsed.data;

  const { data: inserted, error } = await supabase
    .from("topics")
    .insert({
      workspace_id: workspaceId,
      name,
      query,
      language: language ?? null,
      is_active: isActive ?? true,
      auto_discover: autoDiscover ?? true,
      discover_interval_hours: discoverIntervalHours ?? 6,
      project_id: projectId ?? null
    })
    .select(
      "id,created_at,name,query,language,is_active,auto_discover,last_discovered_at,discover_interval_hours,project_id"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ topic: inserted });
}

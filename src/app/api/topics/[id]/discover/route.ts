import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";
import { discoverTopic } from "@/lib/serp/discover";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel: give it 5 minutes

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  const { id: topicId } = await params;

  // Verify topic belongs to current workspace (RLS also enforces this)
  const { data: topic, error } = await supabase
    .from("topics")
    .select("id, workspace_id, name, query, language")
    .eq("id", topicId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  try {
    const stats = await discoverTopic(supabase, topic, "manual");
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

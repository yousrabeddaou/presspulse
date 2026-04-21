import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";

const CreateSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(200).optional()
});

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ sources: [] });

  const { data: sources, error } = await supabase
    .from("sources")
    .select("id,created_at,title,url,last_polled_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: sources ?? [] });
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

  const { url, title } = parsed.data;
  const { data: inserted, error } = await supabase
    .from("sources")
    .upsert(
      { workspace_id: workspaceId, url, title: title ?? null, kind: "rss" },
      { onConflict: "workspace_id,url", ignoreDuplicates: false }
    )
    .select("id,created_at,title,url,last_polled_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ source: inserted });
}


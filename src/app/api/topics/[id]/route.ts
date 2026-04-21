import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";

const PatchSchema = z.object({
  isActive: z.boolean().optional(),
  autoDiscover: z.boolean().optional(),
  name: z.string().min(1).max(80).optional(),
  query: z.string().min(1).max(300).optional(),
  discoverIntervalHours: z.number().int().min(1).max(168).optional(),
  projectId: z.string().uuid().nullable().optional()
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.isActive !== undefined) updates.is_active = parsed.data.isActive;
  if (parsed.data.autoDiscover !== undefined) updates.auto_discover = parsed.data.autoDiscover;
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.query !== undefined) updates.query = parsed.data.query;
  if (parsed.data.discoverIntervalHours !== undefined) {
    updates.discover_interval_hours = parsed.data.discoverIntervalHours;
  }
  if (parsed.data.projectId !== undefined) updates.project_id = parsed.data.projectId;

  const { data: updated, error } = await supabase
    .from("topics")
    .update(updates)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select(
      "id,created_at,name,query,language,is_active,auto_discover,last_discovered_at,discover_interval_hours,project_id"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ topic: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { id } = await params;

  const { error } = await supabase
    .from("topics")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

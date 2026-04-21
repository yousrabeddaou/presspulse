import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ workspaces: [], current: null });

  const current = await getCurrentWorkspaceId();

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id,name,created_at")
    .order("created_at", { ascending: true });

  return NextResponse.json({ workspaces: workspaces ?? [], current });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const workspaceId = body?.workspaceId as string | undefined;
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set("pp_workspace", workspaceId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax"
  });

  return NextResponse.json({ ok: true });
}


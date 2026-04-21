import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const userRes = await supabase.auth.getUser();
  const user = userRes.data.user;
  if (!user) return null;

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get("pp_workspace")?.value ?? null;

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id);

  const workspaceIds = (memberships ?? []).map((m) => m.workspace_id);
  if (!workspaceIds.length) return null;

  if (fromCookie && workspaceIds.includes(fromCookie)) return fromCookie;
  return workspaceIds[0] ?? null;
}


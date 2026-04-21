import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";

const QuerySchema = z.object({
  q: z.string().min(1).max(200),
  language: z.enum(["en", "fr", "ar"]).optional()
});

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ results: [] });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const language = url.searchParams.get("language") ?? undefined;

  const parsed = QuerySchema.safeParse({ q, language });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const term = parsed.data.q.trim();

  // Cross-language friendly: trigram ILIKE on title/snippet/raw_text (indexed).
  let query = supabase
    .from("articles")
    .select(
      "id,created_at,source_name,url,title,language,snippet,published_at,sentiment,confidence,reasoning_native,reasoning_en"
    )
    .eq("workspace_id", workspaceId)
    .or(`title.ilike.%${term}%,snippet.ilike.%${term}%,raw_text.ilike.%${term}%`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (parsed.data.language) query = query.eq("language", parsed.data.language);

  const { data: results, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ results: results ?? [] });
}


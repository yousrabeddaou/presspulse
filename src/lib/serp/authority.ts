// Domain authority lookup: Open PageRank (free, requires free API key).
// Results cached in Supabase for 30 days to save API calls.
// Falls back to a simple heuristic if no key is set.

import type { SupabaseClient } from "@supabase/supabase-js";

const CACHE_TTL_DAYS = 30;

type CacheRow = { domain: string; authority: number; fetched_at: string };

async function getCached(
  supabase: SupabaseClient,
  domains: string[]
): Promise<Map<string, number>> {
  if (!domains.length) return new Map();

  const { data } = await supabase
    .from("domain_authority_cache")
    .select("domain, authority, fetched_at")
    .in("domain", domains);

  const map = new Map<string, number>();
  const cutoff = Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

  for (const row of (data ?? []) as CacheRow[]) {
    const fetchedAt = new Date(row.fetched_at).getTime();
    if (fetchedAt >= cutoff) {
      map.set(row.domain, row.authority);
    }
  }
  return map;
}

async function saveCache(
  supabase: SupabaseClient,
  entries: Array<{ domain: string; authority: number }>
): Promise<void> {
  if (!entries.length) return;
  await supabase.from("domain_authority_cache").upsert(
    entries.map((e) => ({
      domain: e.domain,
      authority: e.authority,
      fetched_at: new Date().toISOString()
    })),
    { onConflict: "domain" }
  );
}

/**
 * Heuristic fallback when no Open PageRank key is available.
 * Rough approximation based on TLD + well-known Moroccan/French/international media.
 */
function heuristicAuthority(domain: string): number {
  const d = domain.toLowerCase();

  // High-authority known outlets (curated, extend as needed)
  const highTier = [
    "lemonde.fr", "lefigaro.fr", "lesechos.fr", "liberation.fr",
    "bbc.com", "bbc.co.uk", "reuters.com", "bloomberg.com", "ft.com",
    "nytimes.com", "theguardian.com", "wsj.com", "economist.com",
    "aljazeera.com", "aljazeera.net", "france24.com", "rfi.fr",
    "leseco.ma", "medias24.com", "lematin.ma", "lavieeco.com",
    "hespress.com", "le360.ma", "yabiladi.com", "telquel.ma", "2m.ma"
  ];
  if (highTier.some((h) => d === h || d.endsWith("." + h))) return 75;

  // Moderate tier: .ma, .fr, .gov, .org institutional domains
  if (d.endsWith(".gov") || d.endsWith(".gov.ma") || d.endsWith(".edu")) return 65;
  if (d.endsWith(".ma") || d.endsWith(".fr")) return 45;
  if (d.endsWith(".com") || d.endsWith(".org") || d.endsWith(".net")) return 35;

  return 25;
}

/**
 * Fetch Open PageRank scores for a batch of domains.
 * API: https://www.domcop.com/openpagerank/documentation
 * Returns normalized 0-100 score (OPR native is 0-10, we scale ×10).
 */
async function fetchOpenPageRank(
  domains: string[]
): Promise<Map<string, number>> {
  const key = process.env.OPENPAGERANK_KEY;
  if (!key || !domains.length) return new Map();

  const map = new Map<string, number>();

  // OPR accepts up to 100 domains per request via repeated ?domains[]=
  const chunks: string[][] = [];
  for (let i = 0; i < domains.length; i += 100) {
    chunks.push(domains.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const params = new URLSearchParams();
    for (const d of chunk) params.append("domains[]", d);

    try {
      const resp = await fetch(
        `https://openpagerank.com/api/v1.0/getPageRank?${params}`,
        {
          headers: { "API-OPR": key },
          signal: AbortSignal.timeout(15_000)
        }
      );

      if (!resp.ok) {
        console.warn("[authority] OPR non-ok", resp.status);
        continue;
      }

      const data = (await resp.json()) as {
        response?: Array<{
          domain: string;
          page_rank_decimal: number | string;
          status_code: number;
        }>;
      };

      for (const r of data.response ?? []) {
        if (r.status_code !== 200) continue;
        const opr = typeof r.page_rank_decimal === "string"
          ? parseFloat(r.page_rank_decimal)
          : r.page_rank_decimal;
        if (isNaN(opr)) continue;
        // OPR 0-10 → 0-100
        map.set(r.domain, Math.round(Math.max(0, Math.min(10, opr)) * 10));
      }
    } catch (err) {
      console.warn("[authority] OPR fetch failed", (err as Error)?.message);
    }
  }

  return map;
}

/**
 * Get authority scores for a batch of domains.
 * Uses cache, then OPR API, then heuristic fallback.
 */
export async function getDomainAuthorities(
  supabase: SupabaseClient,
  domains: string[]
): Promise<Map<string, number>> {
  const unique = Array.from(new Set(domains.filter(Boolean)));
  if (!unique.length) return new Map();

  const result = await getCached(supabase, unique);

  const missing = unique.filter((d) => !result.has(d));
  if (!missing.length) return result;

  const fresh = await fetchOpenPageRank(missing);

  // For anything OPR didn't return, use heuristic
  const toCache: Array<{ domain: string; authority: number }> = [];
  for (const d of missing) {
    const score = fresh.get(d) ?? heuristicAuthority(d);
    result.set(d, score);
    toCache.push({ domain: d, authority: score });
  }

  // Fire-and-forget cache write
  saveCache(supabase, toCache).catch((err) =>
    console.warn("[authority] cache write failed", err?.message)
  );

  return result;
}

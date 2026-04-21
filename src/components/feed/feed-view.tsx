"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { detect } from "tinyld";
import { cn } from "@/lib/utils";
import { Toast } from "@/components/ui/toast";
import { DashboardGraphs } from "@/components/feed/dashboard-graphs";

type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
type Lang = "en" | "fr" | "ar";
type SortMode = "recent" | "authority";
type DiscoveredVia = "manual" | "rss" | "serp" | "news" | null;

type Article = {
  id: string;
  created_at: string;
  source_name: string | null;
  url: string | null;
  title: string;
  language: Lang;
  snippet: string | null;
  published_at: string | null;
  sentiment: Sentiment;
  confidence: number | null;
  reasoning_native: string | null;
  reasoning_en: string | null;
  domain?: string | null;
  domain_authority?: number | null;
  discovered_via?: DiscoveredVia;
};

type Project = { id: string; name: string; color: string | null };
type Topic = { id: string; name: string; project_id: string | null };

function sentimentBorder(sentiment: Sentiment) {
  if (sentiment === "POSITIVE") return "border-emerald-500/40";
  if (sentiment === "NEGATIVE") return "border-red-500/40";
  if (sentiment === "NEUTRAL") return "border-zinc-400/30";
  return "border-white/10";
}

function sentimentBg(sentiment: Sentiment) {
  if (sentiment === "POSITIVE") return "bg-emerald-500/[0.04]";
  if (sentiment === "NEGATIVE") return "bg-red-500/[0.04]";
  return "";
}

function sentimentPill(sentiment: Sentiment) {
  if (sentiment === "POSITIVE")
    return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/20";
  if (sentiment === "NEGATIVE") return "bg-red-500/15 text-red-300 ring-red-500/20";
  if (sentiment === "NEUTRAL") return "bg-zinc-500/15 text-zinc-300 ring-zinc-500/20";
  return "bg-white/5 text-muted-foreground ring-white/10";
}

function authorityColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground bg-white/5";
  if (score >= 70) return "text-emerald-300 bg-emerald-500/15 ring-emerald-500/20";
  if (score >= 45) return "text-amber-300 bg-amber-500/15 ring-amber-500/20";
  return "text-zinc-400 bg-white/5 ring-white/10";
}

function sourceLabel(via: DiscoveredVia) {
  switch (via) {
    case "serp":
      return { text: "SERP", color: "text-blue-300 bg-blue-500/15 ring-blue-500/20" };
    case "news":
      return { text: "NEWS", color: "text-violet-300 bg-violet-500/15 ring-violet-500/20" };
    case "rss":
      return { text: "RSS", color: "text-teal-300 bg-teal-500/15 ring-teal-500/20" };
    case "manual":
      return { text: "MANUAL", color: "text-zinc-400 bg-white/5 ring-white/10" };
    default:
      return null;
  }
}

const LANG_LABELS: Record<Lang | "all", string> = {
  all: "All",
  fr: "🇫🇷 FR",
  en: "🇬🇧 EN",
  ar: "🇲🇦 AR"
};

export function FeedView() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  const [filterLang, setFilterLang] = useState<Lang | "all">("all");
  const [filterSentiment, setFilterSentiment] = useState<
    "all" | "POSITIVE" | "NEUTRAL" | "NEGATIVE"
  >("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterTopic, setFilterTopic] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<10 | 20 | 50 | 100>(20);

  const [manual, setManual] = useState("");

  const [toastOpen, setToastOpen] = useState(false);
  const [toastTitle, setToastTitle] = useState("");
  const [toastDesc, setToastDesc] = useState<string | undefined>();

  // Load projects and topics once
  useEffect(() => {
    void (async () => {
      const [pRes, tRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }).catch(() => null),
        fetch("/api/topics", { cache: "no-store" }).catch(() => null)
      ]);
      if (pRes?.ok) {
        const data = await pRes.json();
        setProjects(data.projects ?? []);
      }
      if (tRes?.ok) {
        const data = await tRes.json();
        setTopics(
          (data.topics ?? []).map((t: { id: string; name: string; project_id: string | null }) => ({
            id: t.id,
            name: t.name,
            project_id: t.project_id
          }))
        );
      }
    })();
  }, []);

  // Topics filtered by selected project
  const availableTopics = useMemo(() => {
    if (filterProject === "all") return topics;
    return topics.filter((t) => t.project_id === filterProject);
  }, [topics, filterProject]);

  // Build the query-param set we use for both /api/feed and /api/feed/stats
  const queryParams = useMemo(() => {
    const qs = new URLSearchParams();
    if (filterLang !== "all") qs.set("language", filterLang);
    if (filterSentiment !== "all") qs.set("sentiment", filterSentiment);
    if (filterTopic !== "all") qs.set("topicId", filterTopic);
    else if (filterProject !== "all") qs.set("projectId", filterProject);
    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo) qs.set("dateTo", `${dateTo}T23:59:59Z`);
    if (sortMode === "authority") qs.set("sort", "authority");
    return qs;
  }, [filterLang, filterSentiment, filterTopic, filterProject, dateFrom, dateTo, sortMode]);

  async function refresh() {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams(queryParams);
    qs.set("page", String(page));
    qs.set("pageSize", String(pageSize));
    const res = await fetch(`/api/feed?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      setLoading(false);
      setError("Please sign in first (magic link).");
      return;
    }
    const data = (await res.json()) as { articles: Article[]; total: number };
    setArticles(data.articles ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParams, page, pageSize]);

  // Reset page when any filter changes
  useEffect(() => {
    setPage(0);
  }, [queryParams]);

  // Reset topic filter when project changes
  useEffect(() => {
    setFilterTopic("all");
  }, [filterProject]);

  // Crisis alert
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      const recentNeg = articles.filter((a) => {
        if (a.sentiment !== "NEGATIVE") return false;
        const t = a.published_at
          ? new Date(a.published_at).getTime()
          : new Date(a.created_at).getTime();
        return t >= cutoff;
      });
      if (recentNeg.length >= 3) {
        setToastTitle("🚨 Crisis Alert: Negative sentiment spike");
        setToastDesc(
          `Detected ${recentNeg.length} negative articles in the last 2 hours.`
        );
        setToastOpen(true);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [articles]);

  const manualLanguageHint = useMemo(() => {
    const guess = detect(manual);
    return guess || null;
  }, [manual]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPageEnd = Math.min((page + 1) * pageSize, total);

  function exportTopicPdf() {
    if (filterTopic === "all") {
      setToastTitle("Select a topic first");
      setToastDesc("PDF export needs a single topic. Pick one from the filter.");
      setToastOpen(true);
      return;
    }
    const qs = new URLSearchParams();
    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo) qs.set("dateTo", `${dateTo}T23:59:59Z`);
    const url = `/api/topics/${filterTopic}/export${qs.toString() ? `?${qs}` : ""}`;
    window.open(url, "_blank");
  }

  return (
    <div className="space-y-6">
      <Toast
        open={toastOpen}
        onOpenChange={setToastOpen}
        title={toastTitle}
        description={toastDesc}
        kind="danger"
      />

      {/* Dashboard graphs */}
      <DashboardGraphs params={queryParams} />

      {/* Filters card */}
      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 outline-none"
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            className="h-9 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 outline-none"
            value={filterTopic}
            onChange={(e) => setFilterTopic(e.target.value)}
          >
            <option value="all">All topics</option>
            {availableTopics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
            {(["all", "fr", "ar", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setFilterLang(l)}
                className={cn(
                  "h-7 rounded-lg px-2.5 text-xs transition",
                  filterLang === l ? "bg-white/10 ring-1 ring-white/10" : "hover:bg-white/8"
                )}
              >
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
            {(["all", "POSITIVE", "NEUTRAL", "NEGATIVE"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterSentiment(s)}
                className={cn(
                  "h-7 rounded-lg px-2.5 text-xs transition",
                  filterSentiment === s
                    ? s === "POSITIVE"
                      ? "bg-emerald-500/20 ring-1 ring-emerald-500/30"
                      : s === "NEGATIVE"
                      ? "bg-red-500/20 ring-1 ring-red-500/30"
                      : s === "NEUTRAL"
                      ? "bg-zinc-500/20 ring-1 ring-zinc-500/30"
                      : "bg-white/10 ring-1 ring-white/10"
                    : "hover:bg-white/8"
                )}
              >
                {s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
            {(["recent", "authority"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSortMode(s)}
                className={cn(
                  "h-7 rounded-lg px-2.5 text-xs transition",
                  sortMode === s ? "bg-white/10 ring-1 ring-white/10" : "hover:bg-white/8"
                )}
              >
                {s === "recent" ? "📅 Recent" : "🏆 Authority"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-muted-foreground">Date range</div>
          <input
            type="date"
            className="h-9 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 outline-none"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            className="h-9 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 outline-none"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          {dateFrom || dateTo ? (
            <button
              type="button"
              className="h-7 rounded-lg bg-white/5 px-2.5 text-xs ring-1 ring-white/10 transition hover:bg-white/8"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear
            </button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="h-8 rounded-xl bg-white/10 px-3 text-xs font-medium ring-1 ring-white/10 transition hover:bg-white/15 disabled:opacity-50"
              disabled={filterTopic === "all"}
              onClick={exportTopicPdf}
              title={filterTopic === "all" ? "Select a topic to enable PDF export" : "Export topic report as PDF"}
            >
              📄 Export PDF
            </button>
            <button
              type="button"
              className="h-8 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 transition hover:bg-white/8"
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Manual paste card (collapsed-ish) */}
      <details className="glass rounded-2xl p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Manual paste <span className="text-xs text-muted-foreground">(optional)</span>
        </summary>
        <div className="mt-3">
          <textarea
            className="h-24 w-full resize-none rounded-xl bg-white/5 px-4 py-3 text-sm outline-none ring-1 ring-white/10 placeholder:text-muted-foreground focus:ring-2 focus:ring-white/20"
            placeholder="Paste article URL or text…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              Language hint: {manualLanguageHint ?? "—"}
            </div>
            <button
              className="h-9 rounded-xl bg-white/10 px-4 text-sm font-medium ring-1 ring-white/10 transition hover:bg-white/15 disabled:opacity-60"
              disabled={!manual.trim()}
              onClick={async () => {
                const value = manual.trim();
                const isUrl = /^https?:\/\//i.test(value);
                const res = await fetch("/api/feed", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(
                    isUrl
                      ? { url: value, languageHint: manualLanguageHint }
                      : { text: value, languageHint: manualLanguageHint }
                  )
                });
                if (!res.ok) {
                  setToastTitle("Analyze failed");
                  setToastOpen(true);
                  return;
                }
                setManual("");
                await refresh();
              }}
            >
              Analyze
            </button>
          </div>
        </div>
      </details>

      {error ? (
        <div className="rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
          {error} Go to <a className="underline" href="/login">/login</a>.
        </div>
      ) : null}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          {total > 0
            ? `Showing ${page * pageSize + 1}–${currentPageEnd} of ${total}`
            : "No articles"}
        </div>
        <div className="flex items-center gap-2">
          <span>Per page:</span>
          {([10, 20, 50, 100] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setPageSize(n);
                setPage(0);
              }}
              className={cn(
                "h-7 rounded-lg px-2.5 text-xs ring-1 ring-white/10 transition",
                pageSize === n ? "bg-white/10" : "bg-white/5 hover:bg-white/8"
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

        {!loading && !articles.length ? (
          <div className="rounded-2xl bg-white/5 p-5 text-sm text-muted-foreground ring-1 ring-white/10">
            No articles match these filters. Try widening the date range or clearing filters.
          </div>
        ) : null}

        {articles.map((a) => {
          const isRtl = a.language === "ar";
          const source = sourceLabel(a.discovered_via ?? null);
          return (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "glass rounded-2xl border-l-4 p-4",
                sentimentBorder(a.sentiment),
                sentimentBg(a.sentiment)
              )}
            >
              <div
                className={cn(
                  "flex items-start justify-between gap-3",
                  isRtl && "flex-row-reverse"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
                      isRtl && "flex-row-reverse justify-end"
                    )}
                  >
                    <span className="font-medium text-foreground/80">
                      {a.source_name ?? a.domain ?? "Source"}
                    </span>
                    <span>·</span>
                    <span>{a.language === "ar" ? "🇲🇦" : a.language === "fr" ? "🇫🇷" : "🇬🇧"}</span>
                    {source ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1",
                          source.color
                        )}
                      >
                        {source.text}
                      </span>
                    ) : null}
                    {a.domain_authority != null ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1",
                          authorityColor(a.domain_authority)
                        )}
                        title={`Domain authority: ${a.domain_authority}/100`}
                      >
                        DA {a.domain_authority}
                      </span>
                    ) : null}
                    {a.published_at ? (
                      <span className="text-[11px]">
                        {new Date(a.published_at).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                  <div className={cn("mt-1.5 text-sm font-semibold", isRtl && "text-right")}>
                    {a.url ? (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {a.title}
                      </a>
                    ) : (
                      a.title
                    )}
                  </div>
                </div>
                <div
                  className={cn(
                    "flex flex-shrink-0 items-center",
                    isRtl && "flex-row-reverse"
                  )}
                >
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                      sentimentPill(a.sentiment)
                    )}
                  >
                    {a.sentiment ?? "—"}
                    {a.confidence != null ? ` · ${a.confidence}%` : ""}
                  </span>
                </div>
              </div>

              <div className={cn("mt-2.5 text-sm text-muted-foreground", isRtl && "text-right")}>
                {a.reasoning_en ?? a.reasoning_native ?? a.snippet ?? ""}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Pagination */}
      {total > pageSize ? (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="h-8 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 transition hover:bg-white/8 disabled:opacity-40"
          >
            ← Prev
          </button>
          <div className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </div>
          <button
            type="button"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="h-8 rounded-xl bg-white/5 px-3 text-xs ring-1 ring-white/10 transition hover:bg-white/8 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}

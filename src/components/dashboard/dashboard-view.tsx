"use client";

import { useEffect, useMemo, useState } from "react";

type Article = {
  id: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  language: "en" | "fr" | "ar";
};

export function DashboardView() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/articles", { cache: "no-store" });
      if (!res.ok) {
        setError("Please sign in first to view dashboard.");
        return;
      }
      const data = (await res.json()) as { articles: Article[] };
      setArticles(data.articles ?? []);
    })();
  }, []);

  const stats = useMemo(() => {
    const out = {
      total: articles.length,
      pos: 0,
      neu: 0,
      neg: 0,
      en: 0,
      fr: 0,
      ar: 0
    };
    for (const a of articles) {
      if (a.sentiment === "POSITIVE") out.pos++;
      if (a.sentiment === "NEUTRAL") out.neu++;
      if (a.sentiment === "NEGATIVE") out.neg++;
      out[a.language]++;
    }
    return out;
  }, [articles]);

  if (error) {
    return (
      <div className="rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
        {error} Go to <a className="underline" href="/login">/login</a>.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold">Dashboard</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Quick pulse across your current workspace.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total articles" value={stats.total} />
        <StatCard label="Positive" value={stats.pos} />
        <StatCard label="Neutral" value={stats.neu} />
        <StatCard label="Negative" value={stats.neg} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard label="English" value={stats.en} />
        <StatCard label="Français" value={stats.fr} />
        <StatCard label="عربي" value={stats.ar} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-2xl p-4 ring-1 ring-white/10">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}


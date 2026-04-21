"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import ReactWordcloud from "react-wordcloud";
import { shapeArabicForCanvas } from "@/lib/rtl/arabic-wordcloud";

type Article = {
  id: string;
  title: string;
  language: "en" | "fr" | "ar";
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  published_at: string | null;
  created_at: string;
};

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function ReportsView() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/articles", { cache: "no-store" });
      if (!res.ok) {
        setError("Please sign in first to view reports.");
        return;
      }
      const data = (await res.json()) as { articles: Article[] };
      setArticles(data.articles ?? []);
    })();
  }, []);

  const sentimentSeries = useMemo(() => {
    const byDay = new Map<
      string,
      { day: string; total: number; pos: number; neg: number }
    >();
    for (const a of articles) {
      const d = a.published_at ? new Date(a.published_at) : new Date(a.created_at);
      const key = dayKey(d);
      const row = byDay.get(key) ?? { day: key, total: 0, pos: 0, neg: 0 };
      row.total += 1;
      if (a.sentiment === "POSITIVE") row.pos += 1;
      if (a.sentiment === "NEGATIVE") row.neg += 1;
      byDay.set(key, row);
    }
    return Array.from(byDay.values())
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .map((r) => ({
        day: r.day,
        positivePct: r.total ? Math.round((r.pos / r.total) * 100) : 0,
        negativePct: r.total ? Math.round((r.neg / r.total) * 100) : 0
      }));
  }, [articles]);

  const langDistribution = useMemo(() => {
    const counts = { en: 0, fr: 0, ar: 0 };
    for (const a of articles) counts[a.language] += 1;
    return [
      { name: "English", value: counts.en, key: "en" },
      { name: "Français", value: counts.fr, key: "fr" },
      { name: "عربي", value: counts.ar, key: "ar" }
    ];
  }, [articles]);

  const wordCloudWords = useMemo(() => {
    const freq = new Map<string, number>();
    for (const a of articles) {
      const words = a.title
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 20);
      for (const w of words) {
        const k = w.length > 1 ? w : "";
        if (!k) continue;
        freq.set(k, (freq.get(k) ?? 0) + 1);
      }
    }
    const out = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 80)
      .map(([text, value]) => {
        const hasArabic = /[\u0600-\u06FF]/.test(text);
        return { text: hasArabic ? shapeArabicForCanvas(text) : text, value };
      });
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
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="glass rounded-2xl p-4">
          <div className="text-sm font-semibold">Sentiment over time</div>
          <div className="mt-1 text-sm text-muted-foreground">
            % Positive vs % Negative mentions per day.
          </div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sentimentSeries}>
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#A1A1AA" }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 12, fill: "#A1A1AA" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(24,24,27,0.92)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 14
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="positivePct"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="negativePct"
                  stroke="#f87171"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="text-sm font-semibold">Language distribution</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Volume of coverage per language.
          </div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={langDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={4}
                >
                  <Cell fill="#60a5fa" />
                  <Cell fill="#a78bfa" />
                  <Cell fill="#f59e0b" />
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "rgba(24,24,27,0.92)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 14
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <div className="text-sm font-semibold">Word cloud</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Headlines keywords (Arabic shaping enabled for proper RTL ligatures).
        </div>
        <div className="mt-4 h-[420px]">
          <ReactWordcloud
            words={wordCloudWords}
            options={{
              rotations: 1,
              rotationAngles: [0, 0],
              fontFamily: "ui-sans-serif, system-ui, -apple-system",
              fontSizes: [14, 58],
              padding: 2,
              deterministic: true,
              scale: "sqrt"
            }}
          />
        </div>
      </div>
    </div>
  );
}


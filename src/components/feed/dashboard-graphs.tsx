"use client";

import { useEffect, useState } from "react";

type Stats = {
  sentiment: { POSITIVE: number; NEUTRAL: number; NEGATIVE: number; UNKNOWN?: number };
  language: { en: number; fr: number; ar: number };
  timeline: Array<{ date: string; positive: number; neutral: number; negative: number }>;
  topDomains: Array<{ domain: string; count: number; authority: number | null }>;
  total: number;
};

type Props = {
  params: URLSearchParams;
};

export function DashboardGraphs({ params }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/feed/stats?${params.toString()}`, { cache: "no-store" });
      if (cancelled) return;
      if (!res.ok) {
        setStats(null);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as Stats;
      if (cancelled) return;
      setStats(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  if (loading) {
    return (
      <div className="glass rounded-2xl p-4 text-sm text-muted-foreground">Loading stats…</div>
    );
  }

  if (!stats || stats.total === 0) {
    return null;
  }

  const { sentiment, timeline, topDomains, total, language } = stats;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  // Donut math
  const R = 54;
  const C = 2 * Math.PI * R;
  const posF = sentiment.POSITIVE / total;
  const neuF = sentiment.NEUTRAL / total;
  const negF = sentiment.NEGATIVE / total;

  // Timeline max
  const maxDay = Math.max(
    1,
    ...timeline.map((t) => t.positive + t.neutral + t.negative)
  );
  const barW = 14;
  const barGap = 3;
  const tlH = 100;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Sentiment donut + totals */}
      <div className="glass rounded-2xl p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Sentiment breakdown
        </div>
        <div className="mt-3 flex items-center gap-4">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="20" />
            <circle
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke="#10B981"
              strokeWidth="20"
              strokeDasharray={`${posF * C} ${C}`}
              transform="rotate(-90 70 70)"
              strokeLinecap="butt"
            />
            <circle
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke="#9CA3AF"
              strokeWidth="20"
              strokeDasharray={`${neuF * C} ${C}`}
              strokeDashoffset={-posF * C}
              transform="rotate(-90 70 70)"
            />
            <circle
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke="#EF4444"
              strokeWidth="20"
              strokeDasharray={`${negF * C} ${C}`}
              strokeDashoffset={-(posF + neuF) * C}
              transform="rotate(-90 70 70)"
            />
            <text
              x="70"
              y="73"
              textAnchor="middle"
              fontSize="22"
              fontWeight="600"
              fill="currentColor"
            >
              {total}
            </text>
          </svg>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              <span>Positive</span>
              <span className="text-muted-foreground">
                {sentiment.POSITIVE} · {pct(sentiment.POSITIVE)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-zinc-400" />
              <span>Neutral</span>
              <span className="text-muted-foreground">
                {sentiment.NEUTRAL} · {pct(sentiment.NEUTRAL)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
              <span>Negative</span>
              <span className="text-muted-foreground">
                {sentiment.NEGATIVE} · {pct(sentiment.NEGATIVE)}%
              </span>
            </div>
            <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-muted-foreground">
              FR {language.fr} · AR {language.ar} · EN {language.en}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="glass rounded-2xl p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Publication timeline
        </div>
        <div className="mt-4 overflow-x-auto">
          {timeline.length ? (
            <svg
              width={Math.max(280, timeline.length * (barW + barGap))}
              height={tlH + 24}
              viewBox={`0 0 ${Math.max(280, timeline.length * (barW + barGap))} ${tlH + 24}`}
            >
              {timeline.map((t, i) => {
                const x = i * (barW + barGap);
                const dayTotal = t.positive + t.neutral + t.negative;
                const h = (dayTotal / maxDay) * tlH;
                const posH = (t.positive / maxDay) * tlH;
                const neuH = (t.neutral / maxDay) * tlH;
                const negH = (t.negative / maxDay) * tlH;
                const y0 = tlH - h;
                const showLabel =
                  i % Math.max(1, Math.ceil(timeline.length / 6)) === 0 ||
                  i === timeline.length - 1;
                return (
                  <g key={t.date}>
                    <rect x={x} y={y0} width={barW} height={posH} fill="#10B981" rx="1" />
                    <rect
                      x={x}
                      y={y0 + posH}
                      width={barW}
                      height={neuH}
                      fill="#9CA3AF"
                      rx="1"
                    />
                    <rect
                      x={x}
                      y={y0 + posH + neuH}
                      width={barW}
                      height={negH}
                      fill="#EF4444"
                      rx="1"
                    />
                    {showLabel ? (
                      <text
                        x={x + barW / 2}
                        y={tlH + 16}
                        textAnchor="middle"
                        fontSize="9"
                        fill="currentColor"
                        opacity="0.5"
                      >
                        {t.date.slice(5)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="text-xs italic text-muted-foreground">No timeline data.</div>
          )}
        </div>
      </div>

      {/* Top domains */}
      <div className="glass rounded-2xl p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Top media outlets
        </div>
        <div className="mt-3 space-y-2">
          {topDomains.slice(0, 6).map((d) => {
            const maxCount = topDomains[0]?.count ?? 1;
            const widthPct = Math.max(5, (d.count / maxCount) * 100);
            return (
              <div key={d.domain} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate font-medium">{d.domain}</span>
                  <span className="flex-shrink-0 text-muted-foreground">
                    {d.count}
                    {d.authority != null ? ` · DA ${d.authority}` : ""}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-white/40"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {!topDomains.length ? (
            <div className="text-xs italic text-muted-foreground">No domain data yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

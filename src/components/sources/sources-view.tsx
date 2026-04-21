"use client";

import { useEffect, useState } from "react";

type Source = {
  id: string;
  created_at: string;
  title: string | null;
  url: string;
  last_polled_at: string | null;
};

export function SourcesView() {
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/sources", { cache: "no-store" });
      if (!res.ok) {
        setError("Please sign in first to manage sources.");
        return;
      }
      const data = (await res.json()) as { sources: Source[] };
      setSources(data.sources ?? []);
    })();
  }, []);

  if (error) {
    return (
      <div className="rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
        {error} Go to <a className="underline" href="/login">/login</a>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold">Sources</div>
        <div className="mt-1 text-sm text-muted-foreground">
          RSS sources are polled hourly by Vercel Cron.
        </div>
      </div>
      <div className="space-y-2">
        {sources.map((s) => (
          <div
            key={s.id}
            className="glass rounded-2xl p-4 ring-1 ring-white/10"
          >
            <div className="text-sm font-medium">
              {s.title ?? new URL(s.url).hostname}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{s.url}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              Last polled: {s.last_polled_at ? new Date(s.last_polled_at).toLocaleString() : "—"}
            </div>
          </div>
        ))}
        {!sources.length ? (
          <div className="rounded-2xl bg-white/5 p-5 text-sm text-muted-foreground ring-1 ring-white/10">
            No sources yet. Add one from the Feed page.
          </div>
        ) : null}
      </div>
    </div>
  );
}


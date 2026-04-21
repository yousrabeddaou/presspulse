"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Workspace = { id: string; name: string };

export function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me/workspaces", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { workspaces: Workspace[]; current: string | null };
      setWorkspaces(data.workspaces ?? []);
      setCurrent(data.current ?? null);
    })();
  }, []);

  const currentWs = workspaces.find((w) => w.id === current) ?? workspaces[0];

  if (!workspaces.length) return null;

  return (
    <div className="relative mt-3">
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between rounded-xl bg-white/5 px-3 text-sm ring-1 ring-white/10 transition hover:bg-white/8"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{currentWs?.name ?? "Workspace"}</span>
        <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 rounded-2xl bg-zinc-950/90 p-1 ring-1 ring-white/10 backdrop-blur">
          {workspaces.map((w) => {
            const active = w.id === currentWs?.id;
            return (
              <button
                key={w.id}
                type="button"
                className={cn(
                  "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition",
                  active ? "bg-white/10" : "hover:bg-white/8"
                )}
                onClick={async () => {
                  setOpen(false);
                  setCurrent(w.id);
                  await fetch("/api/me/workspaces", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ workspaceId: w.id })
                  });
                  window.location.reload();
                }}
              >
                {w.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}


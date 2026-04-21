"use client";

import { useMemo, useState } from "react";
import type { UiLang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ranges = ["today", "thisWeek", "thisMonth"] as const;
type Range = (typeof ranges)[number];

export function TopBar({ uiLang }: { uiLang: UiLang }) {
  const [range, setRange] = useState<Range>("thisWeek");
  const isRtl = uiLang === "ar";
  const rangeLabel = useMemo(() => t(uiLang, range), [uiLang, range]);

  return (
    <div className="glass flex flex-col gap-3 rounded-2xl p-3 md:flex-row md:items-center md:justify-between md:p-4">
      <div className={cn("flex items-center gap-2", isRtl && "flex-row-reverse")}>
        <input
          className="h-10 w-full max-w-[620px] rounded-xl bg-white/5 px-4 text-sm outline-none ring-1 ring-white/10 placeholder:text-muted-foreground focus:ring-2 focus:ring-white/20 md:w-[520px]"
          placeholder={t(uiLang, "searchPlaceholder")}
          defaultValue={
            typeof window !== "undefined"
              ? new URLSearchParams(window.location.search).get("q") ?? ""
              : ""
          }
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const value = (e.currentTarget.value ?? "").trim();
            const url = new URL(window.location.href);
            if (value) url.searchParams.set("q", value);
            else url.searchParams.delete("q");
            window.location.href = url.toString();
          }}
        />
      </div>

      <div className={cn("flex items-center gap-2", isRtl && "flex-row-reverse")}>
        <div className="text-xs text-muted-foreground">{t(uiLang, "dateRange")}</div>
        <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
          {ranges.map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  "h-8 rounded-lg px-3 text-xs transition",
                  active
                    ? "bg-white/10 ring-1 ring-white/10"
                    : "hover:bg-white/8"
                )}
              >
                {active ? rangeLabel : t(uiLang, r)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}


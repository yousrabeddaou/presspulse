"use client";

import { useMemo } from "react";
import type { UiLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const options: Array<{ id: UiLang; label: string }> = [
  { id: "en", label: "🇬🇧" },
  { id: "fr", label: "🇫🇷" },
  { id: "ar", label: "🇲🇦" }
];

export function LanguageSwitcher({ uiLang }: { uiLang: UiLang }) {
  const current = useMemo(
    () => options.find((o) => o.id === uiLang) ?? options[0],
    [uiLang]
  );

  return (
    <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
      {options.map((opt) => {
        const active = opt.id === current.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              document.cookie = `pp_lang=${opt.id}; path=/; max-age=31536000; samesite=lax`;
              window.location.reload();
            }}
            className={cn(
              "h-8 w-9 rounded-lg text-sm transition",
              active
                ? "bg-white/10 ring-1 ring-white/10"
                : "hover:bg-white/8"
            )}
            aria-label={`UI language ${opt.id}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}


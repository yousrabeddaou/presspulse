"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LayoutGrid, Newspaper, BarChart3, Rss, FolderOpen, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UiLang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { TopBar } from "@/components/shell/top-bar";
import { ToastProvider } from "@/components/ui/toast";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";

export function AppShell({
  children,
  uiLang
}: {
  children: React.ReactNode;
  uiLang: UiLang;
}) {
  const pathname = usePathname();
  const isRtl = uiLang === "ar";

  const nav = [
    { href: "/dashboard", label: t(uiLang, "dashboard"), icon: LayoutGrid },
    { href: "/feed", label: t(uiLang, "feed"), icon: Newspaper },
    { href: "/reports", label: t(uiLang, "reports"), icon: BarChart3 },
    { href: "/sources", label: t(uiLang, "sources"), icon: Rss },
    { href: "/topics", label: "Topics", icon: Tag },
    { href: "/projects", label: "Projects", icon: FolderOpen },
  ];

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-[radial-gradient(60rem_60rem_at_20%_0%,rgba(99,102,241,0.14),transparent_50%),radial-gradient(50rem_50rem_at_80%_20%,rgba(16,185,129,0.10),transparent_55%),radial-gradient(40rem_40rem_at_50%_70%,rgba(236,72,153,0.08),transparent_55%)]">
        <div className="mx-auto max-w-[1400px] p-4 md:p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr] md:gap-6">
            <aside className="glass sticky top-4 h-fit rounded-2xl p-3 md:p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-white/10 ring-1 ring-white/10" />
                  <div className="leading-tight">
                    <div className="text-sm font-semibold tracking-wide">
                      PressPulse
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Media monitoring
                    </div>
                  </div>
                </div>
                <LanguageSwitcher uiLang={uiLang} />
              </div>

              <WorkspaceSwitcher />

              <nav className="mt-4 space-y-1">
                {nav.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href + "/"));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                        "hover:bg-white/6 hover:ring-1 hover:ring-white/10",
                        active && "bg-white/10 ring-1 ring-white/10"
                      )}
                    >
                      {active ? (
                        <motion.div
                          layoutId="nav-pill"
                          className={cn(
                            "absolute inset-0 rounded-xl bg-white/6 ring-1 ring-white/10",
                            isRtl ? "-scale-x-100" : ""
                          )}
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30
                          }}
                        />
                      ) : null}
                      <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                        <Icon className="h-4 w-4 text-foreground/90" />
                      </span>
                      <span className="relative">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </aside>

            <main className="space-y-4 md:space-y-6">
              <TopBar uiLang={uiLang} />
              <div className="glass rounded-2xl p-4 md:p-6">{children}</div>
            </main>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}

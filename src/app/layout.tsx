import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { getUiLang, type UiLang } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "PressPulse",
  description: "Media monitoring & multilingual sentiment dashboard for PR teams."
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get("pp_lang")?.value;
  const uiLang: UiLang = getUiLang(langCookie);
  const dir = uiLang === "ar" ? "rtl" : "ltr";

  return (
    <html lang={uiLang} dir={dir} className="dark">
      <body>
        <AppShell uiLang={uiLang}>{children}</AppShell>
      </body>
    </html>
  );
}


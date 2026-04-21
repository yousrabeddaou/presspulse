export type UiLang = "en" | "fr" | "ar";

export function getUiLang(input?: string | null): UiLang {
  if (input === "fr" || input === "ar" || input === "en") return input;
  return "en";
}

type Dict = Record<string, { en: string; fr: string; ar: string }>;

const dict: Dict = {
  dashboard: { en: "Dashboard", fr: "Tableau de bord", ar: "لوحة التحكم" },
  feed: { en: "Feed", fr: "Fil", ar: "الخلاصة" },
  reports: { en: "Reports", fr: "Rapports", ar: "التقارير" },
  sources: { en: "Sources", fr: "Sources", ar: "المصادر" },
  searchPlaceholder: {
    en: "Search articles in Arabic, French or English...",
    fr: "Rechercher des articles en arabe, français ou anglais...",
    ar: "ابحث عن مقالات بالعربية أو الفرنسية أو الإنجليزية..."
  },
  dateRange: { en: "Date range", fr: "Période", ar: "النطاق الزمني" },
  today: { en: "Today", fr: "Aujourd’hui", ar: "اليوم" },
  thisWeek: { en: "This week", fr: "Cette semaine", ar: "هذا الأسبوع" },
  thisMonth: { en: "This month", fr: "Ce mois-ci", ar: "هذا الشهر" },
  addRss: { en: "Add RSS feed", fr: "Ajouter un flux RSS", ar: "إضافة RSS" },
  manualPaste: { en: "Manual paste", fr: "Coller manuellement", ar: "لصق يدوي" },
  analyzeNow: { en: "Analyze now", fr: "Analyser", ar: "حلّل الآن" },
  language: { en: "Language", fr: "Langue", ar: "اللغة" },
  sentiment: { en: "Sentiment", fr: "Ton", ar: "النبرة" },
  all: { en: "All", fr: "Tout", ar: "الكل" },
  positive: { en: "Positive", fr: "Positif", ar: "إيجابي" },
  neutral: { en: "Neutral", fr: "Neutre", ar: "محايد" },
  negative: { en: "Negative", fr: "Négatif", ar: "سلبي" }
};

export function t(uiLang: UiLang, key: keyof typeof dict): string {
  return dict[key][uiLang];
}


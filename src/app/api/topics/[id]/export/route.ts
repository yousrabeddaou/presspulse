import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspaces";

export const runtime = "nodejs";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sentimentBg(s: string | null): string {
  if (s === "POSITIVE") return "#D1FAE5";
  if (s === "NEGATIVE") return "#FEE2E2";
  if (s === "NEUTRAL") return "#E5E7EB";
  return "#F3F4F6";
}

function sentimentText(s: string | null): string {
  if (s === "POSITIVE") return "#065F46";
  if (s === "NEGATIVE") return "#991B1B";
  if (s === "NEUTRAL") return "#374151";
  return "#6B7280";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { id: topicId } = await params;
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  const { data: topic, error: topicErr } = await supabase
    .from("topics")
    .select("id, name, query, language, project_id")
    .eq("id", topicId)
    .eq("workspace_id", workspaceId)
    .single();

  if (topicErr || !topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  const { data: project } = topic.project_id
    ? await supabase
        .from("projects")
        .select("name, color")
        .eq("id", topic.project_id)
        .single()
    : { data: null };

  const { data: joins } = await supabase
    .from("article_topics")
    .select("article_id")
    .eq("topic_id", topicId);
  const articleIds = (joins ?? []).map((j) => j.article_id);

  let articles: Array<{
    id: string;
    title: string;
    url: string | null;
    source_name: string | null;
    language: string;
    sentiment: string | null;
    confidence: number | null;
    reasoning_en: string | null;
    reasoning_native: string | null;
    published_at: string | null;
    domain: string | null;
    domain_authority: number | null;
  }> = [];
  if (articleIds.length) {
    let q = supabase
      .from("articles")
      .select(
        "id,title,url,source_name,language,sentiment,confidence,reasoning_en,reasoning_native,published_at,domain,domain_authority"
      )
      .in("id", articleIds)
      .order("domain_authority", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false });
    if (dateFrom) q = q.gte("published_at", dateFrom);
    if (dateTo) q = q.lte("published_at", dateTo);
    const { data } = await q;
    articles = data ?? [];
  }

  // Aggregate stats
  const sentCount = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0, UNKNOWN: 0 };
  const langCount = { en: 0, fr: 0, ar: 0 };
  const domainMap = new Map<string, number>();
  const timelineMap = new Map<string, { date: string; pos: number; neu: number; neg: number }>();

  for (const a of articles) {
    const s = (a.sentiment ?? "UNKNOWN") as keyof typeof sentCount;
    sentCount[s]++;
    if (a.language in langCount) langCount[a.language as keyof typeof langCount]++;
    if (a.domain) domainMap.set(a.domain, (domainMap.get(a.domain) ?? 0) + 1);
    const d = (a.published_at ?? "").slice(0, 10);
    if (d) {
      const ex = timelineMap.get(d) ?? { date: d, pos: 0, neu: 0, neg: 0 };
      if (a.sentiment === "POSITIVE") ex.pos++;
      else if (a.sentiment === "NEGATIVE") ex.neg++;
      else if (a.sentiment === "NEUTRAL") ex.neu++;
      timelineMap.set(d, ex);
    }
  }

  const topDomains = Array.from(domainMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const timeline = Array.from(timelineMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const total = articles.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  // Build SVG charts inline (no JS deps, prints perfectly)
  // Sentiment donut
  const donutR = 70;
  const donutC = 2 * Math.PI * donutR;
  const posFrac = total ? sentCount.POSITIVE / total : 0;
  const neuFrac = total ? sentCount.NEUTRAL / total : 0;
  const negFrac = total ? sentCount.NEGATIVE / total : 0;
  const donutSvg = `
    <svg width="180" height="180" viewBox="0 0 180 180">
      <circle cx="90" cy="90" r="${donutR}" fill="none" stroke="#E5E7EB" stroke-width="28"/>
      <circle cx="90" cy="90" r="${donutR}" fill="none" stroke="#10B981"
        stroke-width="28"
        stroke-dasharray="${posFrac * donutC} ${donutC}"
        transform="rotate(-90 90 90)"/>
      <circle cx="90" cy="90" r="${donutR}" fill="none" stroke="#9CA3AF"
        stroke-width="28"
        stroke-dasharray="${neuFrac * donutC} ${donutC}"
        stroke-dashoffset="${-posFrac * donutC}"
        transform="rotate(-90 90 90)"/>
      <circle cx="90" cy="90" r="${donutR}" fill="none" stroke="#EF4444"
        stroke-width="28"
        stroke-dasharray="${negFrac * donutC} ${donutC}"
        stroke-dashoffset="${-(posFrac + neuFrac) * donutC}"
        transform="rotate(-90 90 90)"/>
      <text x="90" y="95" text-anchor="middle" font-size="24" font-weight="600" fill="#111827">${total}</text>
    </svg>
  `;

  // Timeline bar chart
  const maxDay = Math.max(1, ...timeline.map((t) => t.pos + t.neu + t.neg));
  const barW = 18;
  const barGap = 4;
  const timelineW = Math.max(400, timeline.length * (barW + barGap));
  const timelineH = 180;
  const timelineSvg = timeline.length
    ? `
    <svg width="100%" height="${timelineH + 30}" viewBox="0 0 ${timelineW} ${timelineH + 30}">
      ${timeline
        .map((t, i) => {
          const x = i * (barW + barGap);
          const totalDay = t.pos + t.neu + t.neg;
          const h = (totalDay / maxDay) * timelineH;
          const posH = (t.pos / maxDay) * timelineH;
          const neuH = (t.neu / maxDay) * timelineH;
          const negH = (t.neg / maxDay) * timelineH;
          const y0 = timelineH - h;
          return `
            <rect x="${x}" y="${y0}" width="${barW}" height="${posH}" fill="#10B981"/>
            <rect x="${x}" y="${y0 + posH}" width="${barW}" height="${neuH}" fill="#9CA3AF"/>
            <rect x="${x}" y="${y0 + posH + neuH}" width="${barW}" height="${negH}" fill="#EF4444"/>
            ${i % Math.max(1, Math.ceil(timeline.length / 8)) === 0 ? `<text x="${x}" y="${timelineH + 20}" font-size="9" fill="#6B7280">${t.date.slice(5)}</text>` : ""}
          `;
        })
        .join("")}
    </svg>
  `
    : '<div style="color:#9CA3AF;font-style:italic;padding:20px">No timeline data</div>';

  const generatedAt = new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>PressPulse Report — ${escapeHtml(topic.name)}</title>
  <style>
    @page { size: A4; margin: 18mm 15mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111827;
      line-height: 1.5;
      margin: 0;
      padding: 24px;
      background: white;
    }
    .header {
      border-bottom: 2px solid #111827;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header h1 { margin: 0 0 4px; font-size: 26px; }
    .header .sub { color: #6B7280; font-size: 13px; }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin: 20px 0;
    }
    .stat {
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      padding: 14px;
    }
    .stat .label { font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
    .section { margin: 28px 0; page-break-inside: avoid; }
    .section h2 { font-size: 16px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid #E5E7EB; }
    .charts-row { display: grid; grid-template-columns: 200px 1fr; gap: 24px; align-items: center; }
    .legend { font-size: 12px; margin-top: 8px; }
    .legend span { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
    .domain-row {
      display: grid;
      grid-template-columns: 1fr 60px 80px;
      padding: 6px 0;
      border-bottom: 1px solid #F3F4F6;
      font-size: 12px;
    }
    .article {
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 10px;
      page-break-inside: avoid;
    }
    .article .meta { font-size: 11px; color: #6B7280; margin-bottom: 4px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .article .title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    .article .title a { color: #111827; text-decoration: none; }
    .article .reasoning { font-size: 11px; color: #4B5563; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    .da-pill { background: #F3F4F6; color: #374151; padding: 2px 6px; border-radius: 4px; font-size: 10px; }
    .rtl { direction: rtl; text-align: right; }
    .print-button {
      position: fixed;
      top: 16px;
      right: 16px;
      padding: 10px 18px;
      background: #111827;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 1000;
    }
    @media print {
      .print-button { display: none; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <button class="print-button" onclick="window.print()">🖨️ Save as PDF</button>

  <div class="header">
    <h1>${escapeHtml(topic.name)}</h1>
    <div class="sub">
      PressPulse coverage report ·
      ${project ? `Project: ${escapeHtml(project.name)} · ` : ""}
      Query: "${escapeHtml(topic.query)}" ·
      Generated ${generatedAt}
      ${dateFrom || dateTo ? ` · Range: ${dateFrom ?? "—"} → ${dateTo ?? "—"}` : ""}
    </div>
  </div>

  <div class="meta-grid">
    <div class="stat">
      <div class="label">Total articles</div>
      <div class="value">${total}</div>
    </div>
    <div class="stat">
      <div class="label">Positive</div>
      <div class="value" style="color:#10B981">${sentCount.POSITIVE} <span style="font-size:13px;color:#6B7280">(${pct(sentCount.POSITIVE)}%)</span></div>
    </div>
    <div class="stat">
      <div class="label">Neutral</div>
      <div class="value" style="color:#6B7280">${sentCount.NEUTRAL} <span style="font-size:13px;color:#9CA3AF">(${pct(sentCount.NEUTRAL)}%)</span></div>
    </div>
    <div class="stat">
      <div class="label">Negative</div>
      <div class="value" style="color:#EF4444">${sentCount.NEGATIVE} <span style="font-size:13px;color:#6B7280">(${pct(sentCount.NEGATIVE)}%)</span></div>
    </div>
  </div>

  <div class="section">
    <h2>Sentiment breakdown</h2>
    <div class="charts-row">
      ${donutSvg}
      <div>
        <div class="legend"><span style="background:#10B981"></span>Positive — ${sentCount.POSITIVE} (${pct(sentCount.POSITIVE)}%)</div>
        <div class="legend"><span style="background:#9CA3AF"></span>Neutral — ${sentCount.NEUTRAL} (${pct(sentCount.NEUTRAL)}%)</div>
        <div class="legend"><span style="background:#EF4444"></span>Negative — ${sentCount.NEGATIVE} (${pct(sentCount.NEGATIVE)}%)</div>
        <div style="margin-top:14px;font-size:12px;color:#6B7280">
          Languages: FR ${langCount.fr} · AR ${langCount.ar} · EN ${langCount.en}
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Publication timeline</h2>
    ${timelineSvg}
  </div>

  <div class="section">
    <h2>Top media outlets</h2>
    ${topDomains.length
      ? topDomains
          .map(
            ([d, c]) => `
      <div class="domain-row">
        <div>${escapeHtml(d)}</div>
        <div style="color:#6B7280">${c} article${c > 1 ? "s" : ""}</div>
        <div style="color:#6B7280">${pct(c)}%</div>
      </div>
    `
          )
          .join("")
      : '<div style="color:#9CA3AF;font-style:italic">No domain data</div>'}
  </div>

  <div class="section">
    <h2>Articles (${total})</h2>
    ${articles
      .map((a) => {
        const isRtl = a.language === "ar";
        return `
      <div class="article ${isRtl ? "rtl" : ""}">
        <div class="meta">
          <span>${escapeHtml(a.source_name ?? a.domain ?? "Unknown")}</span>
          ${a.domain_authority != null ? `<span class="da-pill">DA ${a.domain_authority}</span>` : ""}
          <span class="pill" style="background:${sentimentBg(a.sentiment)};color:${sentimentText(a.sentiment)}">
            ${a.sentiment ?? "—"}${a.confidence != null ? ` ${a.confidence}%` : ""}
          </span>
          <span>${a.language.toUpperCase()}</span>
          ${a.published_at ? `<span>${a.published_at.slice(0, 10)}</span>` : ""}
        </div>
        <div class="title">
          ${a.url ? `<a href="${escapeHtml(a.url)}">${escapeHtml(a.title)}</a>` : escapeHtml(a.title)}
        </div>
        ${a.reasoning_en ? `<div class="reasoning">${escapeHtml(a.reasoning_en)}</div>` : ""}
      </div>
    `;
      })
      .join("")}
  </div>

  <script>
    // Auto-trigger print dialog on load (user can cancel or save)
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 500);
    });
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

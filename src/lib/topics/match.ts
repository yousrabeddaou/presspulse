export function matchesTopicQuery(
  {
    title,
    snippet,
    rawText
  }: { title: string; snippet?: string | null; rawText?: string | null },
  query: string
): boolean {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return false;

  const hay = `${title}\n${snippet ?? ""}\n${rawText ?? ""}`.toLowerCase();
  return tokens.every((t) => hay.includes(t.toLowerCase()));
}


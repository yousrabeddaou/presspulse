import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeSentiment } from "@/lib/ai/sentiment";
import { withRetry } from "@/lib/ai/retry";

const BodySchema = z.object({
  text: z.string().min(1).max(50_000),
  languageHint: z.string().optional().nullable()
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { text, languageHint } = parsed.data;

  const result = await withRetry(
    async () => analyzeSentiment({ text, languageHint }),
    { maxAttempts: 4 }
  );

  return NextResponse.json(result);
}


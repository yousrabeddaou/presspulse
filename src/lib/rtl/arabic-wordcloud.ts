// Arabic text shaping for canvas-based rendering (word clouds, charts).
// The arabic-persian-reshaper package has inconsistent exports across versions —
// we defensively look for the function regardless of how it's exported.

import * as reshaperModule from "arabic-persian-reshaper";
import { default as bidi } from "bidi-js";

// Find the reshape function no matter how the package exports it
type ReshapeFn = (text: string) => string;

function resolveReshape(): ReshapeFn {
  const m = reshaperModule as unknown as Record<string, unknown>;

  // Common export patterns across versions
  const candidates: unknown[] = [
    m.default,
    m.reshape,
    (m.default as Record<string, unknown> | undefined)?.reshape,
    (m.ArabicShaper as Record<string, unknown> | undefined)?.convertArabic,
    m.ArabicShaper,
    m
  ];

  for (const c of candidates) {
    if (typeof c === "function") return c as ReshapeFn;
  }

  // If the package truly doesn't expose a function, return identity
  // (word cloud will look less pretty but won't crash).
  return (text: string) => text;
}

const reshape = resolveReshape();

export function shapeArabicForCanvas(word: string): string {
  try {
    const reshaped = reshape(word);
    const bidiText = bidi.from_string(reshaped);
    return bidiText;
  } catch {
    // Never crash the UI on shaping errors
    return word;
  }
}

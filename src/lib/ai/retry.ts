export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 4,
    baseDelayMs = 600,
    maxDelayMs = 6000
  }: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const jitter = 0.3 + Math.random() * 0.7;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * jitter;
      if (attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}


import { ApiFailure } from "./failures";

/**
 * ponytail: single-process in-memory limiter. Good enough for the local demo;
 * replace with a shared store (Redis/Upstash) before multi-instance deployment.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 5_000;

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw new ApiFailure("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
  }
  bucket.count += 1;
}

export function requestKey(request: Request, suffix: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "local";
  return `${suffix}:${ip}`;
}

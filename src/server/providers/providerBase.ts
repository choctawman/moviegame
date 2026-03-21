import Bottleneck from "bottleneck";

import { env } from "@/lib/env";
import { redis } from "@/lib/redis";

const limiter = new Bottleneck({
  minTime: env.PROVIDER_RATE_LIMIT_MIN_TIME_MS,
  maxConcurrent: 1,
});

async function connectRedisBestEffort(timeoutMs = 3_000): Promise<void> {
  try {
    await Promise.race([
      redis.connect().catch(() => undefined),
      new Promise<void>((resolve) => {
        setTimeout(() => resolve(), timeoutMs);
      }),
    ]);
  } catch {
    // Best effort only.
  }
}

export async function cachedJson<T>(cacheKey: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
  await connectRedisBestEffort();
  const cacheUsable = redis.status === "ready";

  if (cacheUsable) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch {
      // Cache read failure should not block provider execution.
    }
  }

  const value = await limiter.schedule(producer);

  if (cacheUsable) {
    try {
      await redis.set(cacheKey, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // Cache write failure is non-fatal.
    }
  }

  return value;
}

export function normalizeUsdNumber(input: string): number {
  const digits = input.replace(/[^\d.]/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
}

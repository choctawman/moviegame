import IORedis from "ioredis";

import { env } from "@/lib/env";

declare global {
  var redisGlobal: IORedis | undefined;
}

export const redis =
  global.redisGlobal ??
  new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

if (process.env.NODE_ENV !== "production") {
  global.redisGlobal = redis;
}

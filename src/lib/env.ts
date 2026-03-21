import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().default("movie_game_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TMDB_API_KEY: z.string().optional().default(""),
  TMDB_BASE_URL: z.string().url().default("https://api.themoviedb.org/3"),
  TMDB_DISCOVER_MAX_PAGES: z.coerce.number().int().positive().default(100),
  TMDB_REQUEST_DELAY_MS: z.coerce.number().int().nonnegative().default(120),
  TMDB_REGION: z.string().min(2).default("US"),
  TMDB_ORIGIN_COUNTRY: z.string().default("US"),
  TMDB_MIN_RUNTIME_MINUTES: z.coerce.number().int().positive().default(70),
  TMDB_ORIGINAL_LANGUAGE: z.string().default("en"),
  TMDB_RELEASE_TYPES: z.string().default("2|3"),
  RT_SCRAPE_BASE_URL: z.string().url().default("https://www.rottentomatoes.com"),
  BOXOFFICE_BASE_URL: z.string().url().default("https://www.the-numbers.com"),
  PROVIDER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(21600),
  PROVIDER_RATE_LIMIT_MIN_TIME_MS: z.coerce.number().int().positive().default(500),
});

export const env = envSchema.parse(process.env);

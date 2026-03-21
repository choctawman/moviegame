import * as cheerio from "cheerio";

import { env } from "@/lib/env";
import { cachedJson } from "@/server/providers/providerBase";
import type { ProviderMovieInput, RatingsProvider, RatingsResult } from "@/server/providers/types";

function titleToRtSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function queryToSearchTerm(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleTokens(value: string): string[] {
  return normalizeTitle(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function titleSimilarity(a: string, b: string): number {
  const aTokens = new Set(titleTokens(a));
  const bTokens = new Set(titleTokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function parsePercent(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/[^\d]/g, "");
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function scoreFromObjectPath(input: Record<string, unknown> | null, path: string[]): number | null {
  if (!input) {
    return null;
  }

  let current: unknown = input;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in (current as Record<string, unknown>))) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (typeof current === "number" && Number.isFinite(current)) {
    return Math.round(current);
  }
  if (typeof current === "string") {
    return parsePercent(current);
  }
  return null;
}

function parseRtSlugFromHref(href: string | undefined): string | null {
  if (!href) {
    return null;
  }

  const match = /(?:^|https?:\/\/www\.rottentomatoes\.com)\/m\/([^/?#]+)/i.exec(href.trim());
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function parseRtPage(html: string): {
  critics: number | null;
  audience: number | null;
  scoreBoardAttrs: Record<string, string> | undefined;
  parseSource: string;
} {
  const $ = cheerio.load(html);
  const scoreBoard = $("score-board").first();
  let critics = parsePercent(scoreBoard.attr("tomatometerscore"));
  let audience = parsePercent(scoreBoard.attr("audiencescore"));
  let parseSource = "score-board";

  if (critics == null || audience == null) {
    const fallbackCritics = parsePercent($("[data-qa='tomatometer'] .percentage").first().text());
    const fallbackAudience = parsePercent($("[data-qa='audience-score'] .percentage").first().text());
    critics = critics ?? fallbackCritics;
    audience = audience ?? fallbackAudience;
    if (fallbackCritics != null || fallbackAudience != null) {
      parseSource = "legacy-data-qa";
    }
  }

  if (critics == null || audience == null) {
    const mediaScorecard = parseJsonObject($("script[data-json='mediaScorecard']").first().text());
    const mediaCritics =
      scoreFromObjectPath(mediaScorecard, ["criticsScore", "score"]) ??
      scoreFromObjectPath(mediaScorecard, ["overlay", "criticsAll", "score"]);
    const mediaAudience =
      scoreFromObjectPath(mediaScorecard, ["audienceScore", "score"]) ??
      scoreFromObjectPath(mediaScorecard, ["overlay", "audienceVerified", "score"]) ??
      scoreFromObjectPath(mediaScorecard, ["overlay", "audienceAll", "score"]);
    critics = critics ?? mediaCritics;
    audience = audience ?? mediaAudience;
    if (mediaCritics != null || mediaAudience != null) {
      parseSource = "mediaScorecard-json";
    }
  }

  if (critics == null || audience == null) {
    const reviewsData = parseJsonObject($("script[data-json='reviewsData']").first().text());
    const reviewsCritics = scoreFromObjectPath(reviewsData, ["criticsScore", "score"]);
    const reviewsAudience = scoreFromObjectPath(reviewsData, ["audienceScore", "score"]);
    critics = critics ?? reviewsCritics;
    audience = audience ?? reviewsAudience;
    if (reviewsCritics != null || reviewsAudience != null) {
      parseSource = "reviewsData-json";
    }
  }

  return {
    critics,
    audience,
    scoreBoardAttrs: scoreBoard.attr(),
    parseSource,
  };
}

export class RtScraperProvider implements RatingsProvider {
  name = "rt-scraper";

  async getRtScores(movie: ProviderMovieInput): Promise<RatingsResult> {
    const directSlug = titleToRtSlug(movie.title);
    const cacheKey = `provider:rt:v5:${directSlug}`;

    return cachedJson(cacheKey, env.PROVIDER_CACHE_TTL_SECONDS, async () => {
      const slugsToTry: string[] = [];
      const searchUrl = `${env.RT_SCRAPE_BASE_URL}/search?search=${encodeURIComponent(queryToSearchTerm(movie.title))}`;

      try {
        const searchResponse = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (MovieGameBot/1.0)",
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (searchResponse.ok) {
          const searchHtml = await searchResponse.text();
          const search$ = cheerio.load(searchHtml);
          const movieReleaseYear = movie.releaseDate?.getUTCFullYear() ?? null;
          const normalizedMovieTitle = normalizeTitle(movie.title);

          const rowCandidates = search$("search-page-media-row")
            .toArray()
            .map((element) => {
              const row = search$(element);
              const href =
                row.find("a[data-qa='info-name']").first().attr("href") ??
                row.find("a[data-qa='thumbnail-link']").first().attr("href");
              const slug = parseRtSlugFromHref(href);
              if (!slug) {
                return null;
              }

              const releaseYearRaw = row.attr("release-year");
              const releaseYear = releaseYearRaw ? Number.parseInt(releaseYearRaw, 10) : null;
              const resultTitle = normalizeTitle(row.find("a[data-qa='info-name']").first().text());
              const similarity = titleSimilarity(resultTitle, normalizedMovieTitle);

              const hasStrongTitleMatch =
                resultTitle === normalizedMovieTitle ||
                resultTitle.includes(normalizedMovieTitle) ||
                normalizedMovieTitle.includes(resultTitle) ||
                similarity >= 0.6;
              if (!hasStrongTitleMatch) {
                return null;
              }

              if (movieReleaseYear != null && releaseYear != null && Math.abs(movieReleaseYear - releaseYear) > 1) {
                return null;
              }

              let score = 0;
              if (resultTitle === normalizedMovieTitle) {
                score += 4;
              } else if (resultTitle.includes(normalizedMovieTitle) || normalizedMovieTitle.includes(resultTitle)) {
                score += 2;
              }
              score += Math.round(similarity * 3);
              if (movieReleaseYear != null && releaseYear != null && movieReleaseYear === releaseYear) {
                score += 2;
              }
              if (parsePercent(row.attr("tomatometer-score") ?? undefined) != null) {
                score += 1;
              }

              return { slug, score };
            })
            .filter((item): item is { slug: string; score: number } => item != null);

          rowCandidates.sort((a, b) => b.score - a.score);
          const searchSlugs = rowCandidates.map((candidate) => candidate.slug);

          for (const slug of searchSlugs.slice(0, 10)) {
            if (!slugsToTry.includes(slug)) {
              slugsToTry.push(slug);
            }
          }
        }
      } catch {
        // Search fallback is best-effort only.
      }

      if (slugsToTry.length === 0) {
        slugsToTry.push(directSlug);
      }

      let lastTriedUrl = `${env.RT_SCRAPE_BASE_URL}/m/${slugsToTry[0]}`;
      for (const slug of slugsToTry) {
        const targetUrl = `${env.RT_SCRAPE_BASE_URL}/m/${slug}`;
        lastTriedUrl = targetUrl;

        const response = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (MovieGameBot/1.0)",
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          continue;
        }

        const html = await response.text();
        const parsed = parseRtPage(html);
        if (parsed.critics != null || parsed.audience != null) {
          return {
            critics: parsed.critics,
            audience: parsed.audience,
            sourceUrl: targetUrl,
            raw: {
              slugTried: slug,
              slugsTried: slugsToTry,
              scoreBoardAttrs: parsed.scoreBoardAttrs,
              parseSource: parsed.parseSource,
            },
          };
        }
      }

      return {
        critics: null,
        audience: null,
        sourceUrl: lastTriedUrl,
        raw: {
          warning: "No RT scores found across tried slugs",
          slugsTried: slugsToTry,
        },
      };
    });
  }
}

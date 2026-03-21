import * as cheerio from "cheerio";

import { env } from "@/lib/env";
import { cachedJson, normalizeUsdNumber } from "@/server/providers/providerBase";
import { getBoxOfficeMojoTitleUrlForMovie } from "@/server/services/movieExternalLinkService";
import type { BoxOfficeProvider, BoxOfficeResult, ProviderMovieInput } from "@/server/providers/types";

export function extractWorldwideGrossFromHtml(html: string): { gross: number; parsedFrom: string } {
  const normalized = html.replace(/\s+/g, " ");
  const regex = /WORLDWIDE(?!\s+OPENING)[^$]{0,80}\$([0-9][0-9,]*)/i;
  const match = regex.exec(normalized);

  if (match?.[0] && match[1]) {
    const gross = normalizeUsdNumber(match[1]);
    if (gross > 0 || match[1] === "0") {
      return {
        gross,
        parsedFrom: match[0],
      };
    }
  }

  const dashRegex = /WORLDWIDE[^$]{0,80}[–—-]/i;
  const dashMatch = dashRegex.exec(normalized);
  if (dashMatch?.[0]) {
    return {
      gross: 0,
      parsedFrom: dashMatch[0],
    };
  }

  const $ = cheerio.load(html);
  const worldwideNodeText =
    $("*")
      .toArray()
      .map((node) => $(node).text().replace(/\s+/g, " ").trim())
      .find((text) => /^WORLDWIDE\b/i.test(text) && /\$[0-9]/.test(text)) ?? null;

  if (worldwideNodeText) {
    const amountMatch = /\$([0-9][0-9,]*)/.exec(worldwideNodeText);
    if (amountMatch?.[1]) {
      return {
        gross: normalizeUsdNumber(amountMatch[1]),
        parsedFrom: worldwideNodeText,
      };
    }

    if (/[–—-]/.test(worldwideNodeText)) {
      return {
        gross: 0,
        parsedFrom: worldwideNodeText,
      };
    }
  }

  throw new Error("Could not parse WORLDWIDE gross from BoxOfficeMojo page");
}

export class BoxOfficeScraperProvider implements BoxOfficeProvider {
  name = "boxoffice-scraper";

  async getCumulativeWorldwideGross(movie: ProviderMovieInput, asOfDate: Date): Promise<BoxOfficeResult> {
    const day = asOfDate.toISOString().slice(0, 10);
    const cacheKey = `provider:boxoffice:${movie.movieId}:${day}`;

    return cachedJson(cacheKey, env.PROVIDER_CACHE_TTL_SECONDS, async () => {
      const movieUrl = await getBoxOfficeMojoTitleUrlForMovie({
        tmdbMovieId: movie.externalTmdbMovieId,
        title: movie.title,
        releaseDate: movie.releaseDate,
      });
      if (!movieUrl) {
        throw new Error(`Could not resolve BoxOfficeMojo title URL for movie ${movie.movieId} (${movie.title})`);
      }

      const movieResponse = await fetch(movieUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (MovieGameBot/1.0)",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!movieResponse.ok) {
        throw new Error(`BoxOfficeMojo title fetch failed (${movieUrl}): HTTP ${movieResponse.status}`);
      }

      const movieHtml = await movieResponse.text();
      const parsed = extractWorldwideGrossFromHtml(movieHtml);

      return {
        cumulativeWorldwideGrossUsd: parsed.gross,
        estimated: true,
        sourceUrl: movieUrl,
        raw: {
          parsedFrom: parsed.parsedFrom,
        },
        asOfDate: asOfDate.toISOString(),
      };
    });
  }
}

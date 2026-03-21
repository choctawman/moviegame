import * as cheerio from "cheerio";

import { env } from "@/lib/env";

interface TmdbExternalIdsResponse {
  imdb_id?: string | null;
}

function normalizeImdbTitleId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!/^tt\d+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export async function getImdbTitleIdForTmdbMovie(tmdbMovieId: number | null | undefined): Promise<string | null> {
  if (!tmdbMovieId || !env.TMDB_API_KEY) {
    return null;
  }
  const url = new URL(`${env.TMDB_BASE_URL}/movie/${tmdbMovieId}/external_ids`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.TMDB_API_KEY}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`TMDB external ids failed for ${tmdbMovieId}: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as TmdbExternalIdsResponse;

  return normalizeImdbTitleId(payload.imdb_id);
}

export async function getBoxOfficeMojoTitleUrlForTmdbMovie(
  tmdbMovieId: number | null | undefined,
): Promise<string | null> {
  const imdbTitleId = await getImdbTitleIdForTmdbMovie(tmdbMovieId);
  if (!imdbTitleId) {
    return null;
  }

  return `https://www.boxofficemojo.com/title/${imdbTitleId}/`;
}

function normalizeTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseYearFromText(input: string): number | null {
  const match = /\((\d{4})\)/.exec(input);
  if (!match?.[1]) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

async function searchBoxOfficeMojoTitleUrl(title: string, releaseDate: Date | null): Promise<string | null> {
  const searchUrl = new URL("https://www.boxofficemojo.com/search/");
  searchUrl.searchParams.set("q", title);

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (MovieGameBot/1.0)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const desiredTitle = normalizeTitleForMatch(title);
  const desiredYear = releaseDate ? releaseDate.getUTCFullYear() : null;

  const candidates = $("a.a-size-medium.a-link-normal.a-text-bold[href^='/title/tt']")
    .toArray()
    .map((node) => {
      const anchor = $(node);
      const href = anchor.attr("href") ?? "";
      const candidateTitle = normalizeTitleForMatch(anchor.text());
      const yearText = anchor.parent().find("span.a-color-secondary").first().text();
      const candidateYear = parseYearFromText(yearText);

      let score = 0;
      if (candidateTitle === desiredTitle) {
        score += 10;
      }
      if (desiredYear != null && candidateYear != null && desiredYear === candidateYear) {
        score += 5;
      }

      return {
        href,
        score,
        candidateTitle,
      };
    })
    .filter((row) => row.href.startsWith("/title/tt") && row.candidateTitle === desiredTitle)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 10) {
    return null;
  }

  const cleanPath = best.href.split("?")[0] ?? best.href;
  return `https://www.boxofficemojo.com${cleanPath.endsWith("/") ? cleanPath : `${cleanPath}/`}`;
}

export async function getBoxOfficeMojoTitleUrlForMovie(input: {
  tmdbMovieId: number | null | undefined;
  title: string;
  releaseDate: Date | null;
}): Promise<string | null> {
  const byTmdb = await getBoxOfficeMojoTitleUrlForTmdbMovie(input.tmdbMovieId);
  if (byTmdb) {
    return byTmdb;
  }

  return searchBoxOfficeMojoTitleUrl(input.title, input.releaseDate);
}

function titleToRtSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

export function getRottenTomatoesUrlForMovieTitle(title: string): string | null {
  const slug = titleToRtSlug(title);
  if (!slug) {
    return null;
  }
  const base = env.RT_SCRAPE_BASE_URL.replace(/\/+$/, "");
  return `${base}/m/${slug}`;
}

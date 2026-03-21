import { DateTime } from "luxon";
import type { FantasyRole, Prisma } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getActiveTheatricalWindowForSeason } from "@/server/utils/activeMovies";

const TMDB_PROVIDER_NAME = "TMDB_METADATA";

interface TmdbMovie {
  id: number;
  title: string;
  release_date: string | null;
}

interface TmdbCastCredit {
  id: number;
  name: string;
  gender: number | null;
  popularity: number | null;
  order: number | null;
  profile_path: string | null;
}

interface TmdbCrewCredit {
  id: number;
  name: string;
  gender: number | null;
  popularity: number | null;
  job: string;
  department: string;
  profile_path: string | null;
}

interface TmdbCreditsResponse {
  cast: TmdbCastCredit[];
  crew: TmdbCrewCredit[];
}

interface TmdbDiscoverResponse {
  results: TmdbMovie[];
  total_pages: number;
}

interface TmdbReleaseDate {
  release_date: string;
  type: number;
}

interface TmdbReleaseDateResult {
  iso_3166_1: string;
  release_dates: TmdbReleaseDate[];
}

interface TmdbMovieDetailsResponse {
  id: number;
  title: string;
  runtime: number | null;
  original_language: string | null;
  poster_path: string | null;
  production_countries: Array<{ iso_3166_1: string; name: string }>;
  credits?: TmdbCreditsResponse;
  release_dates?: { results: TmdbReleaseDateResult[] };
}

interface SeasonWindow {
  start: DateTime;
  end: DateTime;
  startIso: string;
  endIso: string;
}

interface DiscoverRange {
  startIso: string;
  endIso: string;
}

function tmdbHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${env.TMDB_API_KEY}`,
    accept: "application/json",
  };
}

function parseSeasonWindow(seasonYear: number): SeasonWindow {
  const window = getActiveTheatricalWindowForSeason(seasonYear);
  const start = DateTime.fromJSDate(window.startAt).toUTC().startOf("day");
  const end = DateTime.fromJSDate(window.endAt).toUTC().endOf("day");

  return {
    start,
    end,
    startIso: start.toISODate() ?? "",
    endIso: end.toISODate() ?? "",
  };
}

function parseReleaseTypes(): Set<number> {
  return new Set(
    env.TMDB_RELEASE_TYPES.split("|")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value)),
  );
}

function normalizeCountryCode(value: string): string {
  return value.trim().toUpperCase();
}

function buildDiscoverRanges(window: SeasonWindow): DiscoverRange[] {
  const ranges: DiscoverRange[] = [];
  let cursor = window.start.startOf("month");

  while (cursor.toMillis() <= window.end.toMillis()) {
    const monthStart = cursor.toMillis() < window.start.toMillis() ? window.start : cursor;
    const monthEndRaw = cursor.endOf("month");
    const monthEnd = monthEndRaw.toMillis() > window.end.toMillis() ? window.end : monthEndRaw;

    ranges.push({
      startIso: monthStart.toISODate() ?? "",
      endIso: monthEnd.toISODate() ?? "",
    });

    cursor = cursor.plus({ months: 1 }).startOf("month");
  }

  return ranges;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveLeadingRole(gender: number): FantasyRole {
  if (gender === 1) {
    return "LEADING_ACTRESS";
  }
  return "LEADING_ACTOR";
}

function extractUsTheatricalReleaseDate(
  details: TmdbMovieDetailsResponse,
  regionCode: string,
  allowedReleaseTypes: Set<number>,
  seasonWindow: SeasonWindow,
): Date | null {
  const regionReleaseDates = details.release_dates?.results.find(
    (entry) => normalizeCountryCode(entry.iso_3166_1) === regionCode,
  );

  if (!regionReleaseDates) {
    return null;
  }

  const validDates = regionReleaseDates.release_dates
    .filter((releaseDate) => allowedReleaseTypes.has(releaseDate.type))
    .map((releaseDate) => DateTime.fromISO(releaseDate.release_date, { zone: "utc" }))
    .filter((releaseDate) => releaseDate.isValid)
    .sort((a, b) => a.toMillis() - b.toMillis());

  for (const releaseDate of validDates) {
    if (
      releaseDate.toMillis() >= seasonWindow.start.toMillis() &&
      releaseDate.toMillis() <= seasonWindow.end.toMillis()
    ) {
      return releaseDate.startOf("day").toUTC().toJSDate();
    }
  }

  return null;
}

function passesMetadataFilters(details: TmdbMovieDetailsResponse, requiredOriginCountry: string): boolean {
  const runtime = details.runtime;
  if (typeof runtime === "number" && runtime > 0 && runtime < env.TMDB_MIN_RUNTIME_MINUTES) {
    return false;
  }

  const requiredLanguage = env.TMDB_ORIGINAL_LANGUAGE.trim().toLowerCase();
  if (requiredLanguage) {
    const movieLanguage = (details.original_language ?? "").trim().toLowerCase();
    if (movieLanguage !== requiredLanguage) {
      return false;
    }
  }

  if (requiredOriginCountry) {
    const hasRequiredOrigin = details.production_countries.some(
      (country) => normalizeCountryCode(country.iso_3166_1) === requiredOriginCountry,
    );
    if (!hasRequiredOrigin) {
      return false;
    }
  }

  return true;
}

async function fetchMoviesForSeason(seasonYear: number): Promise<TmdbMovie[]> {
  if (!env.TMDB_API_KEY) {
    return [];
  }

  const seasonWindow = parseSeasonWindow(seasonYear);
  const discoverRanges = buildDiscoverRanges(seasonWindow);
  const allMovies: TmdbMovie[] = [];

  for (const range of discoverRanges) {
    let totalPagesForRange = 1;

    for (let page = 1; page <= env.TMDB_DISCOVER_MAX_PAGES; page += 1) {
      const url = new URL(`${env.TMDB_BASE_URL}/discover/movie`);
      url.searchParams.set("language", "en-US");
      url.searchParams.set("region", env.TMDB_REGION);
      url.searchParams.set("sort_by", "primary_release_date.asc");
      url.searchParams.set("with_release_type", env.TMDB_RELEASE_TYPES);
      url.searchParams.set("primary_release_date.gte", range.startIso);
      url.searchParams.set("primary_release_date.lte", range.endIso);

      const originCountry = normalizeCountryCode(env.TMDB_ORIGIN_COUNTRY);
      if (originCountry) {
        url.searchParams.set("with_origin_country", originCountry);
      }

      const originalLanguage = env.TMDB_ORIGINAL_LANGUAGE.trim();
      if (originalLanguage) {
        url.searchParams.set("with_original_language", originalLanguage);
      }

      url.searchParams.set("include_adult", "false");
      url.searchParams.set("include_video", "false");
      url.searchParams.set("page", String(page));

      const response = await fetch(url, { headers: tmdbHeaders() });
      if (!response.ok) {
        throw new Error(`TMDB discover failed: ${response.status}`);
      }

      const payload = (await response.json()) as TmdbDiscoverResponse;
      totalPagesForRange = payload.total_pages;
      allMovies.push(...payload.results);

      if (page >= payload.total_pages) {
        break;
      }
    }

    if (totalPagesForRange > env.TMDB_DISCOVER_MAX_PAGES) {
      console.warn(
        `[ingest] TMDB discover truncated for ${range.startIso}..${range.endIso}; total pages ${totalPagesForRange}, cap ${env.TMDB_DISCOVER_MAX_PAGES}`,
      );
    }
  }

  const deduped = new Map<number, TmdbMovie>();
  for (const movie of allMovies) {
    deduped.set(movie.id, movie);
  }

  return Array.from(deduped.values());
}

async function fetchMovieDetails(tmdbMovieId: number): Promise<TmdbMovieDetailsResponse> {
  const url = new URL(`${env.TMDB_BASE_URL}/movie/${tmdbMovieId}`);
  url.searchParams.set("language", "en-US");
  url.searchParams.set("append_to_response", "credits,release_dates");

  const response = await fetch(url, { headers: tmdbHeaders() });
  if (!response.ok) {
    throw new Error(`TMDB movie details failed for movie ${tmdbMovieId}: ${response.status}`);
  }

  return (await response.json()) as TmdbMovieDetailsResponse;
}

async function upsertPerson(
  tx: Prisma.TransactionClient,
  person: { id: number; name: string; gender: number | null; profile_path: string | null; popularity?: number | null },
): Promise<{ id: string; gender: number }> {
  const created = await tx.person.upsert({
    where: { externalTmdbPersonId: person.id },
    update: {
      name: person.name,
      gender: person.gender,
      ...(typeof person.popularity === "number" ? { tmdbPopularity: person.popularity } : {}),
      ...(person.profile_path
        ? {
            profilePath: person.profile_path,
          }
        : {}),
    },
    create: {
      name: person.name,
      gender: person.gender,
      externalTmdbPersonId: person.id,
      profilePath: person.profile_path,
      tmdbPopularity: typeof person.popularity === "number" ? person.popularity : null,
    },
  });

  return { id: created.id, gender: created.gender ?? 0 };
}

async function markTmdbProviderSuccess(leagueId: string): Promise<void> {
  await prisma.providerStatus.upsert({
    where: {
      leagueId_providerName: {
        leagueId,
        providerName: TMDB_PROVIDER_NAME,
      },
    },
    update: {
      lastSuccessAt: new Date(),
      lastErrorMessage: null,
    },
    create: {
      leagueId,
      providerName: TMDB_PROVIDER_NAME,
      lastSuccessAt: new Date(),
    },
  });
}

async function markTmdbProviderError(leagueId: string, message: string): Promise<void> {
  await prisma.providerStatus.upsert({
    where: {
      leagueId_providerName: {
        leagueId,
        providerName: TMDB_PROVIDER_NAME,
      },
    },
    update: {
      lastErrorAt: new Date(),
      lastErrorMessage: message,
    },
    create: {
      leagueId,
      providerName: TMDB_PROVIDER_NAME,
      lastErrorAt: new Date(),
      lastErrorMessage: message,
    },
  });
}

async function ensureFantasyPlayer(tx: Prisma.TransactionClient, personId: string, role: FantasyRole): Promise<void> {
  await tx.fantasyPlayer.upsert({
    where: {
      personId_role: {
        personId,
        role,
      },
    },
    update: {},
    create: {
      personId,
      role,
    },
  });
}

export async function ingestSeasonMoviesForLeague(
  leagueId: string,
): Promise<{ moviesProcessed: number; moviesFailed: number; totalDiscovered: number }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    throw new Error("League not found");
  }

  if (!env.TMDB_API_KEY) {
    await markTmdbProviderError(leagueId, "TMDB_API_KEY missing");
    return { moviesProcessed: 0, moviesFailed: 0, totalDiscovered: 0 };
  }

  try {
    const movies = await fetchMoviesForSeason(league.seasonYear);
    const seasonWindow = parseSeasonWindow(league.seasonYear);
    const regionCode = normalizeCountryCode(env.TMDB_REGION);
    const originCountry = normalizeCountryCode(env.TMDB_ORIGIN_COUNTRY);
    const releaseTypes = parseReleaseTypes();

    const eligibleMovieIds: string[] = [];
    let moviesProcessed = 0;
    let moviesFailed = 0;

    for (const movie of movies) {
      try {
        const details = await fetchMovieDetails(movie.id);

        if (!passesMetadataFilters(details, originCountry)) {
          continue;
        }

        const usTheatricalReleaseDate = extractUsTheatricalReleaseDate(details, regionCode, releaseTypes, seasonWindow);
        if (!usTheatricalReleaseDate) {
          continue;
        }

        const credits = details.credits ?? { cast: [], crew: [] };

        const movieRecordId = await prisma.$transaction(async (tx) => {
          const resolvedSeasonYear = usTheatricalReleaseDate.getUTCFullYear();

          const movieRecord = await tx.movie.upsert({
            where: { externalTmdbMovieId: movie.id },
            update: {
              title: details.title || movie.title,
              ...(details.poster_path
                ? {
                    posterPath: details.poster_path,
                  }
                : {}),
              theatricalReleaseDate: usTheatricalReleaseDate,
              seasonYear: resolvedSeasonYear,
            },
            create: {
              externalTmdbMovieId: movie.id,
              title: details.title || movie.title,
              posterPath: details.poster_path,
              theatricalReleaseDate: usTheatricalReleaseDate,
              seasonYear: resolvedSeasonYear,
            },
          });

          await tx.credit.deleteMany({ where: { movieId: movieRecord.id } });

          for (const cast of credits.cast) {
            const person = await upsertPerson(tx, cast);
            const billingOrder = Number.isInteger(cast.order) ? cast.order : null;
            const isLeading = billingOrder === 0 || billingOrder === 1;
            const role: FantasyRole = isLeading ? resolveLeadingRole(person.gender) : "SUPPORTING";
            const needsReview = (!person.gender && isLeading) || billingOrder == null;

            await tx.credit.create({
              data: {
                movieId: movieRecord.id,
                personId: person.id,
                creditType: "CAST",
                billingOrder,
                needsReview,
              },
            });

            await ensureFantasyPlayer(tx, person.id, role);
          }

          for (const crew of credits.crew) {
            const person = await upsertPerson(tx, crew);

            await tx.credit.create({
              data: {
                movieId: movieRecord.id,
                personId: person.id,
                creditType: "CREW",
                job: crew.job,
                department: crew.department,
              },
            });

            if (crew.job === "Director") {
              await ensureFantasyPlayer(tx, person.id, "DIRECTOR");
            }
          }

          return movieRecord.id;
        });

        eligibleMovieIds.push(movieRecordId);
        moviesProcessed += 1;
      } catch (error) {
        moviesFailed += 1;
        console.error(`[ingest] failed movie ${movie.id} (${movie.title})`, error);
      }

      if (env.TMDB_REQUEST_DELAY_MS > 0) {
        await sleep(env.TMDB_REQUEST_DELAY_MS);
      }
    }

    await prisma.$transaction(async (tx) => {
      if (eligibleMovieIds.length === 0) {
        await tx.leagueEligibleMovie.deleteMany({
          where: { leagueId },
        });
      } else {
        await tx.leagueEligibleMovie.deleteMany({
          where: {
            leagueId,
            movieId: { notIn: eligibleMovieIds },
          },
        });

        await tx.leagueEligibleMovie.createMany({
          data: eligibleMovieIds.map((movieId) => ({ leagueId, movieId })),
          skipDuplicates: true,
        });
      }
    });

    await markTmdbProviderSuccess(leagueId);
    return { moviesProcessed, moviesFailed, totalDiscovered: movies.length };
  } catch (error) {
    await markTmdbProviderError(leagueId, (error as Error).message);
    throw error;
  }
}

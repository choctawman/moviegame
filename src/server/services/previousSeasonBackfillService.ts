import { DateTime } from "luxon";
import type { CreditType } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { ensureFantasyPlayerSeasonStats } from "@/server/services/fantasyPlayerSeasonStatsService";
import { ensureMovieSeasonStats } from "@/server/services/historicalScoringService";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { getPreviousSeasonPointsWindow } from "@/server/utils/previousSeasonWindow";

interface TmdbPersonMovieCredit {
  id: number;
  title: string;
  release_date: string | null;
  order?: number | null;
  job?: string | null;
  department?: string | null;
}

interface TmdbPersonMovieCreditsResponse {
  cast: TmdbPersonMovieCredit[];
  crew: TmdbPersonMovieCredit[];
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
  release_dates?: { results: TmdbReleaseDateResult[] };
}

interface CandidateCredit {
  personId: string;
  creditType: CreditType;
  billingOrder: number | null;
  job: string | null;
  department: string | null;
}

interface CandidateMovie {
  tmdbMovieId: number;
  title: string;
  creditsByKey: Map<string, CandidateCredit>;
}

interface BackfillFailure {
  kind: "person-credits" | "movie-details";
  id: string;
  title: string;
  message: string;
}

export interface PreviousSeasonBackfillSummary {
  leagueId: string;
  seasonYear: number;
  previousSeasonYear: number;
  personCount: number;
  peopleMissingTmdbId: number;
  candidateMovieCount: number;
  moviesUpserted: number;
  moviesSkippedOutsideFilters: number;
  movieIdsEnsuredForSeasonStats: number;
  fantasyPlayerSeasonStatsEnsured: number;
  failures: BackfillFailure[];
}

function tmdbHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${env.TMDB_API_KEY}`,
    accept: "application/json",
  };
}

function normalizeCountryCode(value: string): string {
  return value.trim().toUpperCase();
}

function parseReleaseTypes(): Set<number> {
  return new Set(
    env.TMDB_RELEASE_TYPES.split("|")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value)),
  );
}

function parseIsoDate(value: string | null): DateTime | null {
  if (!value) {
    return null;
  }
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  if (!parsed.isValid) {
    return null;
  }
  return parsed.startOf("day");
}

function isDateInWindow(date: DateTime | null, startAt: Date, cutoffAt: Date): boolean {
  if (!date) {
    return false;
  }
  const millis = date.toMillis();
  return millis >= startAt.getTime() && millis <= cutoffAt.getTime();
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

function extractUsTheatricalReleaseDate(
  details: TmdbMovieDetailsResponse,
  regionCode: string,
  allowedReleaseTypes: Set<number>,
  startAt: Date,
  cutoffAt: Date,
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
    const millis = releaseDate.toMillis();
    if (millis >= startAt.getTime() && millis <= cutoffAt.getTime()) {
      return releaseDate.startOf("day").toUTC().toJSDate();
    }
  }

  return null;
}

function creditKey(credit: CandidateCredit): string {
  return [
    credit.personId,
    credit.creditType,
    credit.creditType === "CAST" ? `order:${credit.billingOrder ?? "null"}` : `job:${credit.job ?? ""}`,
  ].join("|");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPersonMovieCredits(tmdbPersonId: number): Promise<TmdbPersonMovieCreditsResponse> {
  const url = new URL(`${env.TMDB_BASE_URL}/person/${tmdbPersonId}/movie_credits`);
  url.searchParams.set("language", "en-US");

  const response = await fetch(url, { headers: tmdbHeaders(), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`TMDB person credits failed: HTTP ${response.status}`);
  }
  return (await response.json()) as TmdbPersonMovieCreditsResponse;
}

async function fetchMovieDetails(tmdbMovieId: number): Promise<TmdbMovieDetailsResponse> {
  const url = new URL(`${env.TMDB_BASE_URL}/movie/${tmdbMovieId}`);
  url.searchParams.set("language", "en-US");
  url.searchParams.set("append_to_response", "release_dates");

  const response = await fetch(url, { headers: tmdbHeaders(), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`TMDB movie details failed: HTTP ${response.status}`);
  }
  return (await response.json()) as TmdbMovieDetailsResponse;
}

export async function syncPreviousSeasonMoviesForLeague(leagueId: string): Promise<PreviousSeasonBackfillSummary> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, seasonYear: true },
  });
  if (!league) {
    throw new Error("League not found");
  }
  if (!env.TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY missing");
  }

  const window = getPreviousSeasonPointsWindow(league.seasonYear);
  const previousSeasonYear = window.previousSeasonYear;
  const regionCode = normalizeCountryCode(env.TMDB_REGION);
  const originCountry = normalizeCountryCode(env.TMDB_ORIGIN_COUNTRY);
  const allowedReleaseTypes = parseReleaseTypes();

  const players = await prisma.fantasyPlayer.findMany({
    where: {
      role: { in: ACTIVE_FANTASY_ROLES_LIST },
      person: {
        credits: {
          some: {
            movie: {
              eligibleLeagues: {
                some: { leagueId },
              },
            },
          },
        },
      },
    },
    select: {
      personId: true,
      person: {
        select: {
          id: true,
          name: true,
          gender: true,
          externalTmdbPersonId: true,
        },
      },
    },
  });

  const peopleById = new Map(players.map((row) => [row.person.id, row.person]));
  const people = Array.from(peopleById.values());
  const failures: BackfillFailure[] = [];
  const candidateMovies = new Map<number, CandidateMovie>();
  let processedPeople = 0;

  for (const person of people) {
    processedPeople += 1;
    if (!person.externalTmdbPersonId) {
      if (processedPeople % 250 === 0 || processedPeople === people.length) {
        console.log(`[backfill][${league.id}] people scanned ${processedPeople}/${people.length}`);
      }
      continue;
    }

    try {
      const credits = await fetchPersonMovieCredits(person.externalTmdbPersonId);

      for (const castCredit of credits.cast) {
        const releaseDate = parseIsoDate(castCredit.release_date);
        if (!isDateInWindow(releaseDate, window.startAt, window.cutoffAt)) {
          continue;
        }

        const candidate =
          candidateMovies.get(castCredit.id) ??
          ({
            tmdbMovieId: castCredit.id,
            title: castCredit.title,
            creditsByKey: new Map<string, CandidateCredit>(),
          } satisfies CandidateMovie);

        const credit: CandidateCredit = {
          personId: person.id,
          creditType: "CAST",
          billingOrder: Number.isInteger(castCredit.order) ? Number(castCredit.order) : null,
          job: null,
          department: null,
        };

        candidate.creditsByKey.set(creditKey(credit), credit);
        candidateMovies.set(castCredit.id, candidate);
      }

      for (const crewCredit of credits.crew) {
        const isDirector = (crewCredit.job ?? "").trim().toLowerCase() === "director";
        if (!isDirector) {
          continue;
        }

        const releaseDate = parseIsoDate(crewCredit.release_date);
        if (!isDateInWindow(releaseDate, window.startAt, window.cutoffAt)) {
          continue;
        }

        const candidate =
          candidateMovies.get(crewCredit.id) ??
          ({
            tmdbMovieId: crewCredit.id,
            title: crewCredit.title,
            creditsByKey: new Map<string, CandidateCredit>(),
          } satisfies CandidateMovie);

        const credit: CandidateCredit = {
          personId: person.id,
          creditType: "CREW",
          billingOrder: null,
          job: "Director",
          department: crewCredit.department ?? null,
        };

        candidate.creditsByKey.set(creditKey(credit), credit);
        candidateMovies.set(crewCredit.id, candidate);
      }
    } catch (error) {
      failures.push({
        kind: "person-credits",
        id: String(person.externalTmdbPersonId),
        title: person.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (env.TMDB_REQUEST_DELAY_MS > 0) {
      await sleep(env.TMDB_REQUEST_DELAY_MS);
    }

    if (processedPeople % 250 === 0 || processedPeople === people.length) {
      console.log(`[backfill][${league.id}] people scanned ${processedPeople}/${people.length}`);
    }
  }

  let moviesUpserted = 0;
  let moviesSkippedOutsideFilters = 0;
  let processedCandidateMovies = 0;

  for (const candidate of candidateMovies.values()) {
    processedCandidateMovies += 1;
    try {
      const details = await fetchMovieDetails(candidate.tmdbMovieId);
      if (!passesMetadataFilters(details, originCountry)) {
        moviesSkippedOutsideFilters += 1;
        continue;
      }

      const releaseDate = extractUsTheatricalReleaseDate(
        details,
        regionCode,
        allowedReleaseTypes,
        window.startAt,
        window.cutoffAt,
      );

      if (!releaseDate) {
        moviesSkippedOutsideFilters += 1;
        continue;
      }

      const movieRecord = await prisma.movie.upsert({
        where: { externalTmdbMovieId: candidate.tmdbMovieId },
        update: {
          title: details.title || candidate.title,
          posterPath: details.poster_path,
          theatricalReleaseDate: releaseDate,
          seasonYear: releaseDate.getUTCFullYear(),
        },
        create: {
          externalTmdbMovieId: candidate.tmdbMovieId,
          title: details.title || candidate.title,
          posterPath: details.poster_path,
          theatricalReleaseDate: releaseDate,
          seasonYear: releaseDate.getUTCFullYear(),
        },
      });

      const candidateCredits = Array.from(candidate.creditsByKey.values());
      await prisma.$transaction(async (tx) => {
        for (const credit of candidateCredits) {
          const person = peopleById.get(credit.personId);
          if (!person) {
            continue;
          }

          if (credit.creditType === "CAST") {
            await tx.credit.deleteMany({
              where: {
                movieId: movieRecord.id,
                personId: credit.personId,
                creditType: "CAST",
              },
            });

            const isLeading = credit.billingOrder != null && credit.billingOrder <= 1;
            const needsReview = (person.gender == null && isLeading) || credit.billingOrder == null;

            await tx.credit.create({
              data: {
                movieId: movieRecord.id,
                personId: credit.personId,
                creditType: "CAST",
                billingOrder: credit.billingOrder,
                needsReview,
              },
            });
            continue;
          }

          await tx.credit.deleteMany({
            where: {
              movieId: movieRecord.id,
              personId: credit.personId,
              creditType: "CREW",
              job: "Director",
            },
          });

          await tx.credit.create({
            data: {
              movieId: movieRecord.id,
              personId: credit.personId,
              creditType: "CREW",
              job: "Director",
              department: credit.department,
            },
          });
        }
      });

      moviesUpserted += 1;
    } catch (error) {
      failures.push({
        kind: "movie-details",
        id: String(candidate.tmdbMovieId),
        title: candidate.title,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (env.TMDB_REQUEST_DELAY_MS > 0) {
      await sleep(env.TMDB_REQUEST_DELAY_MS);
    }

    if (processedCandidateMovies % 50 === 0 || processedCandidateMovies === candidateMovies.size) {
      console.log(`[backfill][${league.id}] movies scanned ${processedCandidateMovies}/${candidateMovies.size}`);
    }
  }

  const movieIdsForStats = (
    await prisma.credit.findMany({
      where: {
        personId: { in: people.map((person) => person.id) },
        movie: {
          theatricalReleaseDate: {
            gte: window.startAt,
            lte: window.cutoffAt,
          },
        },
      },
      select: { movieId: true },
      distinct: ["movieId"],
    })
  ).map((row) => row.movieId);

  let lastLoggedCompleted = 0;
  await ensureMovieSeasonStats(league.id, previousSeasonYear, movieIdsForStats, {
    concurrency: 6,
    onProgress: ({ completed, total }) => {
      if (completed === total || completed - lastLoggedCompleted >= 25) {
        console.log(`[backfill][${league.id}] season stats ${completed}/${total}`);
        lastLoggedCompleted = completed;
      }
    },
  });

  const fantasyPlayers = await prisma.fantasyPlayer.findMany({
    where: {
      role: { in: ACTIVE_FANTASY_ROLES_LIST },
      personId: { in: people.map((person) => person.id) },
    },
    select: {
      id: true,
      personId: true,
      role: true,
    },
  });

  const playerSeasonStats = await ensureFantasyPlayerSeasonStats({
    seasonYear: previousSeasonYear,
    startAt: window.startAt,
    cutoffAt: window.cutoffAt,
    fantasyPlayers,
  });

  return {
    leagueId: league.id,
    seasonYear: league.seasonYear,
    previousSeasonYear,
    personCount: people.length,
    peopleMissingTmdbId: people.filter((person) => !person.externalTmdbPersonId).length,
    candidateMovieCount: candidateMovies.size,
    moviesUpserted,
    moviesSkippedOutsideFilters,
    movieIdsEnsuredForSeasonStats: movieIdsForStats.length,
    fantasyPlayerSeasonStatsEnsured: playerSeasonStats.size,
    failures,
  };
}

export async function syncPreviousSeasonMoviesForSeason(targetSeasonYear: number): Promise<PreviousSeasonBackfillSummary[]> {
  const leagues = await prisma.league.findMany({
    where: { seasonYear: targetSeasonYear },
    select: { id: true },
  });

  const summaries: PreviousSeasonBackfillSummary[] = [];
  for (const league of leagues) {
    summaries.push(await syncPreviousSeasonMoviesForLeague(league.id));
  }
  return summaries;
}

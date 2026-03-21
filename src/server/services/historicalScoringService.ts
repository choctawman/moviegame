import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveCumulativeGross, resolveRatings } from "@/server/providers";
import { roundHalfUp } from "@/server/utils/math";

export interface HistoricalMovieScore {
  movieId: string;
  boxPoints: number;
  rtPoints: number;
  totalPoints: number;
}

export interface EnsureMovieSeasonStatsProgress {
  completed: number;
  total: number;
  movieId: string;
  movieTitle: string;
}

interface EnsureMovieSeasonStatsOptions {
  concurrency?: number;
  onProgress?: (progress: EnsureMovieSeasonStatsProgress) => void | Promise<void>;
}

interface RefreshMovieSeasonStatsOptions extends EnsureMovieSeasonStatsOptions {
  asOfDate?: Date;
}

interface MinimalMovieRecord {
  id: string;
  title: string;
  externalTmdbMovieId: number | null;
  theatricalReleaseDate: Date | null;
}

function getSeasonAsOfDateUtc(seasonYear: number): Date {
  return new Date(Date.UTC(seasonYear, 11, 31, 23, 59, 59, 999));
}

async function loadMoviesForSeasonStats(movieIds: string[]): Promise<MinimalMovieRecord[]> {
  if (movieIds.length === 0) {
    return [];
  }

  return prisma.movie.findMany({
    where: { id: { in: movieIds } },
    select: {
      id: true,
      title: true,
      externalTmdbMovieId: true,
      theatricalReleaseDate: true,
    },
  });
}

async function upsertMovieSeasonStat(
  leagueId: string,
  seasonYear: number,
  asOfDate: Date,
  movie: MinimalMovieRecord,
) {
  if (movie.theatricalReleaseDate && movie.theatricalReleaseDate.getTime() > asOfDate.getTime()) {
    return prisma.movieSeasonStat.upsert({
      where: {
        movieId_seasonYear: {
          movieId: movie.id,
          seasonYear,
        },
      },
      update: {
        worldwideGrossUsd: BigInt(0),
        rtCriticsScore: null,
        rtAudienceScore: null,
        dataStatus: "SUCCESS",
        errorMessage: null,
        rawSource: {
          notReleasedInSeason: true,
          releaseDate: movie.theatricalReleaseDate.toISOString(),
          seasonYear,
          asOfDate: asOfDate.toISOString(),
        } as Prisma.InputJsonValue,
        snapshotAt: new Date(),
      },
      create: {
        movieId: movie.id,
        seasonYear,
        worldwideGrossUsd: BigInt(0),
        rtCriticsScore: null,
        rtAudienceScore: null,
        dataStatus: "SUCCESS",
        errorMessage: null,
        rawSource: {
          notReleasedInSeason: true,
          releaseDate: movie.theatricalReleaseDate.toISOString(),
          seasonYear,
          asOfDate: asOfDate.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  let grossUsd = 0;
  let critics: number | null = null;
  let audience: number | null = null;
  let dataStatus: "SUCCESS" | "FAILED" = "SUCCESS";
  let errorMessage: string | null = null;
  let rawSource: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined = undefined;

  const [grossResult, ratingsResult] = await Promise.allSettled([
    resolveCumulativeGross(
      {
        movieId: movie.id,
        title: movie.title,
        externalTmdbMovieId: movie.externalTmdbMovieId,
        releaseDate: movie.theatricalReleaseDate,
      },
      asOfDate,
      leagueId,
    ),
    resolveRatings(
      {
        movieId: movie.id,
        title: movie.title,
        externalTmdbMovieId: movie.externalTmdbMovieId,
        releaseDate: movie.theatricalReleaseDate,
      },
      leagueId,
    ),
  ]);

  const errors: string[] = [];
  const raw: Record<string, unknown> = {};

  if (grossResult.status === "fulfilled") {
    grossUsd = Math.max(0, Math.round(grossResult.value.cumulativeWorldwideGrossUsd));
    raw.boxOffice = grossResult.value;
  } else {
    errors.push(`boxOffice: ${grossResult.reason instanceof Error ? grossResult.reason.message : String(grossResult.reason)}`);
  }

  if (ratingsResult.status === "fulfilled") {
    critics = ratingsResult.value.critics;
    audience = ratingsResult.value.audience;
    raw.ratings = ratingsResult.value;
  } else {
    errors.push(`ratings: ${ratingsResult.reason instanceof Error ? ratingsResult.reason.message : String(ratingsResult.reason)}`);
  }

  if (errors.length > 0) {
    dataStatus = "FAILED";
    errorMessage = errors.join(" | ");
    raw.errors = errors;
  }

  rawSource = raw as Prisma.InputJsonValue;

  return prisma.movieSeasonStat.upsert({
    where: {
      movieId_seasonYear: {
        movieId: movie.id,
        seasonYear,
      },
    },
    update: {
      worldwideGrossUsd: BigInt(grossUsd),
      rtCriticsScore: critics,
      rtAudienceScore: audience,
      dataStatus,
      errorMessage,
      rawSource,
      snapshotAt: new Date(),
    },
    create: {
      movieId: movie.id,
      seasonYear,
      worldwideGrossUsd: BigInt(grossUsd),
      rtCriticsScore: critics,
      rtAudienceScore: audience,
      dataStatus,
      errorMessage,
      rawSource,
    },
  });
}

async function upsertMovieSeasonStatsBatch(
  leagueId: string,
  seasonYear: number,
  movies: MinimalMovieRecord[],
  asOfDate: Date,
  options?: EnsureMovieSeasonStatsOptions,
): Promise<Map<string, Awaited<ReturnType<typeof upsertMovieSeasonStat>>>> {
  const total = movies.length;
  const desiredConcurrency = Math.max(1, Math.floor(options?.concurrency ?? 4));
  const workerCount = Math.min(desiredConcurrency, total);
  let cursor = 0;
  let completed = 0;

  const upsertedByMovieId = new Map<string, Awaited<ReturnType<typeof upsertMovieSeasonStat>>>();
  const workers = Array.from({ length: workerCount }, () =>
    (async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= total) {
          return;
        }

        const movie = movies[index];
        if (!movie) {
          return;
        }

        const upserted = await upsertMovieSeasonStat(leagueId, seasonYear, asOfDate, movie);
        upsertedByMovieId.set(movie.id, upserted);
        completed += 1;

        if (options?.onProgress) {
          await options.onProgress({
            completed,
            total,
            movieId: movie.id,
            movieTitle: movie.title,
          });
        }
      }
    })(),
  );

  await Promise.all(workers);

  return upsertedByMovieId;
}

export async function ensureMovieSeasonStats(
  leagueId: string,
  seasonYear: number,
  movieIds: string[],
  options?: EnsureMovieSeasonStatsOptions,
): Promise<Map<string, HistoricalMovieScore>> {
  if (movieIds.length === 0) {
    return new Map();
  }

  const uniqueMovieIds = Array.from(new Set(movieIds));

  const existing = await prisma.movieSeasonStat.findMany({
    where: {
      seasonYear,
      movieId: { in: uniqueMovieIds },
    },
  });

  const existingByMovieId = new Map(existing.map((row) => [row.movieId, row]));
  const missingMovieIds = uniqueMovieIds.filter((movieId) => !existingByMovieId.has(movieId));

  if (missingMovieIds.length > 0) {
    const missingMovies = await loadMoviesForSeasonStats(missingMovieIds);
    const asOfDate = getSeasonAsOfDateUtc(seasonYear);
    const upsertedRows = await upsertMovieSeasonStatsBatch(leagueId, seasonYear, missingMovies, asOfDate, options);
    for (const [movieId, row] of upsertedRows) {
      existingByMovieId.set(movieId, row);
    }
  }

  const scores = new Map<string, HistoricalMovieScore>();
  for (const movieId of uniqueMovieIds) {
    const stat = existingByMovieId.get(movieId);
    const grossUsd = Number(stat?.worldwideGrossUsd ?? BigInt(0));
    const boxPoints = roundHalfUp(grossUsd / 1_000_000, 2);
    const rtPoints = (stat?.rtCriticsScore ?? 0) + (stat?.rtAudienceScore ?? 0);
    const totalPoints = roundHalfUp(boxPoints + rtPoints, 2);

    scores.set(movieId, {
      movieId,
      boxPoints,
      rtPoints,
      totalPoints,
    });
  }

  return scores;
}

export async function refreshMovieSeasonStats(
  leagueId: string,
  seasonYear: number,
  movieIds: string[],
  options?: RefreshMovieSeasonStatsOptions,
): Promise<Map<string, HistoricalMovieScore>> {
  if (movieIds.length === 0) {
    return new Map();
  }

  const uniqueMovieIds = Array.from(new Set(movieIds));
  const movies = await loadMoviesForSeasonStats(uniqueMovieIds);
  const asOfDate = options?.asOfDate ?? getSeasonAsOfDateUtc(seasonYear);
  const upsertedRows = await upsertMovieSeasonStatsBatch(leagueId, seasonYear, movies, asOfDate, options);

  const scores = new Map<string, HistoricalMovieScore>();
  for (const movieId of uniqueMovieIds) {
    const stat = upsertedRows.get(movieId);
    const grossUsd = Number(stat?.worldwideGrossUsd ?? BigInt(0));
    const boxPoints = roundHalfUp(grossUsd / 1_000_000, 2);
    const rtPoints = (stat?.rtCriticsScore ?? 0) + (stat?.rtAudienceScore ?? 0);
    const totalPoints = roundHalfUp(boxPoints + rtPoints, 2);

    scores.set(movieId, {
      movieId,
      boxPoints,
      rtPoints,
      totalPoints,
    });
  }

  return scores;
}

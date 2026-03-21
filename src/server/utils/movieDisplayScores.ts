import { roundHalfUp } from "@/server/utils/math";

interface MovieDisplayScoreRow {
  movieId: string;
  worldwideGrossUsd: bigint;
  rtCriticsScore: number | null;
  rtAudienceScore: number | null;
  snapshotAt?: Date | null;
  week?: {
    index: number;
  } | null;
}

export function aggregateMovieDisplayScores(
  rows: MovieDisplayScoreRow[],
): Map<string, { boxOfficePoints: number; rtPoints: number }> {
  const rowsByMovie = new Map<
    string,
    Map<
      string,
      {
        boxOfficePoints: number;
        rtPoints: number;
        weekIndex: number;
        snapshotAt: number;
      }
    >
  >();

  for (const row of rows) {
    const movieRows = rowsByMovie.get(row.movieId) ?? new Map();
    const weekIndex = row.week?.index ?? Number.NEGATIVE_INFINITY;
    const snapshotAt = row.snapshotAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const periodKey =
      row.week?.index != null
        ? `week:${row.week.index}`
        : row.snapshotAt != null
          ? `snapshot:${snapshotAt}`
          : `row:${movieRows.size}`;
    const existing = movieRows.get(periodKey);

    if (!existing || snapshotAt >= existing.snapshotAt) {
      movieRows.set(periodKey, {
        boxOfficePoints: Number(row.worldwideGrossUsd) / 1_000_000,
        rtPoints: (row.rtCriticsScore ?? 0) + (row.rtAudienceScore ?? 0),
        weekIndex,
        snapshotAt,
      });
    }

    rowsByMovie.set(row.movieId, movieRows);
  }

  return new Map(
    Array.from(rowsByMovie.entries()).map(([movieId, movieRows]) => {
      const uniqueRows = Array.from(movieRows.values());
      const latestRtRow = uniqueRows.reduce<
        | {
            boxOfficePoints: number;
            rtPoints: number;
            weekIndex: number;
            snapshotAt: number;
          }
        | null
      >((latest, row) => {
        if (!latest) {
          return row;
        }

        if (row.weekIndex > latest.weekIndex) {
          return row;
        }

        if (row.weekIndex === latest.weekIndex && row.snapshotAt >= latest.snapshotAt) {
          return row;
        }

        return latest;
      }, null);

      return [
        movieId,
        {
          boxOfficePoints: roundHalfUp(
            uniqueRows.reduce((sum, row) => sum + row.boxOfficePoints, 0),
            2,
          ),
          rtPoints: latestRtRow?.rtPoints ?? 0,
        },
      ] as const;
    }),
  );
}

interface MovieSeasonDisplayScoreRow {
  movieId: string;
  seasonYear: number;
  worldwideGrossUsd: bigint;
  rtCriticsScore: number | null;
  rtAudienceScore: number | null;
  snapshotAt?: Date | null;
}

export function selectMovieSeasonDisplayScores(
  rows: MovieSeasonDisplayScoreRow[],
  options?: { seasonYear?: number },
): Map<string, { boxOfficePoints: number; rtPoints: number }> {
  const requestedSeasonYear = options?.seasonYear;
  const bestRowByMovieId = new Map<string, MovieSeasonDisplayScoreRow>();

  for (const row of rows) {
    if (requestedSeasonYear != null && row.seasonYear !== requestedSeasonYear) {
      continue;
    }

    const existing = bestRowByMovieId.get(row.movieId);
    if (!existing) {
      bestRowByMovieId.set(row.movieId, row);
      continue;
    }

    const existingSnapshotAt = existing.snapshotAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rowSnapshotAt = row.snapshotAt?.getTime() ?? Number.NEGATIVE_INFINITY;

    if (row.seasonYear > existing.seasonYear || (row.seasonYear === existing.seasonYear && rowSnapshotAt >= existingSnapshotAt)) {
      bestRowByMovieId.set(row.movieId, row);
    }
  }

  return new Map(
    Array.from(bestRowByMovieId.entries()).map(([movieId, row]) => [
      movieId,
      {
        boxOfficePoints: roundHalfUp(Number(row.worldwideGrossUsd) / 1_000_000, 2),
        rtPoints: (row.rtCriticsScore ?? 0) + (row.rtAudienceScore ?? 0),
      },
    ]),
  );
}

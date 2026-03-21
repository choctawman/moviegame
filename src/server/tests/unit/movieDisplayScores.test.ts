import { describe, expect, it } from "vitest";

import { aggregateMovieDisplayScores, selectMovieSeasonDisplayScores } from "@/server/utils/movieDisplayScores";

describe("movieDisplayScores", () => {
  it("prefers the requested season stat when available", () => {
    const scores = selectMovieSeasonDisplayScores(
      [
        {
          movieId: "movie-1",
          seasonYear: 2025,
          worldwideGrossUsd: BigInt(50_000_000),
          rtCriticsScore: 80,
          rtAudienceScore: 90,
          snapshotAt: new Date("2025-12-31T23:00:00.000Z"),
        },
        {
          movieId: "movie-1",
          seasonYear: 2026,
          worldwideGrossUsd: BigInt(125_500_000),
          rtCriticsScore: 85,
          rtAudienceScore: 88,
          snapshotAt: new Date("2026-03-17T18:00:00.000Z"),
        },
      ],
      { seasonYear: 2026 },
    );

    expect(scores.get("movie-1")).toEqual({
      boxOfficePoints: 125.5,
      rtPoints: 173,
    });
  });

  it("falls back to the latest available season when no season is requested", () => {
    const scores = selectMovieSeasonDisplayScores([
      {
        movieId: "movie-1",
        seasonYear: 2025,
        worldwideGrossUsd: BigInt(50_000_000),
        rtCriticsScore: 80,
        rtAudienceScore: 90,
        snapshotAt: new Date("2025-12-31T23:00:00.000Z"),
      },
      {
        movieId: "movie-1",
        seasonYear: 2026,
        worldwideGrossUsd: BigInt(125_500_000),
        rtCriticsScore: 85,
        rtAudienceScore: 88,
        snapshotAt: new Date("2026-03-17T18:00:00.000Z"),
      },
    ]);

    expect(scores.get("movie-1")).toEqual({
      boxOfficePoints: 125.5,
      rtPoints: 173,
    });
  });

  it("still aggregates month rows as a fallback", () => {
    const scores = aggregateMovieDisplayScores([
      {
        movieId: "movie-1",
        worldwideGrossUsd: BigInt(10_000_000),
        rtCriticsScore: 80,
        rtAudienceScore: 90,
        snapshotAt: new Date("2026-02-28T23:00:00.000Z"),
        week: { index: 2 },
      },
      {
        movieId: "movie-1",
        worldwideGrossUsd: BigInt(25_000_000),
        rtCriticsScore: 82,
        rtAudienceScore: 91,
        snapshotAt: new Date("2026-03-31T23:00:00.000Z"),
        week: { index: 3 },
      },
    ]);

    expect(scores.get("movie-1")).toEqual({
      boxOfficePoints: 35,
      rtPoints: 173,
    });
  });
});

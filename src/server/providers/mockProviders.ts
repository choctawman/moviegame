import type { BoxOfficeProvider, BoxOfficeResult, ProviderMovieInput, RatingsProvider, RatingsResult } from "@/server/providers/types";

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

export class MockBoxOfficeProvider implements BoxOfficeProvider {
  name = "mock-box-office";

  async getCumulativeWorldwideGross(movie: ProviderMovieInput, asOfDate: Date): Promise<BoxOfficeResult> {
    const seed = hash(`${movie.title}-${asOfDate.toISOString().slice(0, 10)}`);
    return {
      cumulativeWorldwideGrossUsd: (seed % 300) * 1_000_000,
      estimated: true,
      sourceUrl: "mock://boxoffice",
      raw: { seed },
      asOfDate: asOfDate.toISOString(),
    };
  }
}

export class MockRatingsProvider implements RatingsProvider {
  name = "mock-ratings";

  async getRtScores(movie: ProviderMovieInput): Promise<RatingsResult> {
    const seed = hash(movie.title);
    return {
      critics: 40 + (seed % 60),
      audience: 35 + (Math.floor(seed / 7) % 65),
      sourceUrl: "mock://ratings",
      raw: { seed },
    };
  }
}

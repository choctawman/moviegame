export interface ProviderMovieInput {
  movieId: string;
  title: string;
  externalTmdbMovieId: number | null;
  releaseDate: Date | null;
}

export interface BoxOfficeResult {
  cumulativeWorldwideGrossUsd: number;
  estimated: boolean;
  sourceUrl: string;
  raw: unknown;
  asOfDate: string;
}

export interface RatingsResult {
  critics: number | null;
  audience: number | null;
  sourceUrl: string;
  raw: unknown;
}

export interface BoxOfficeProvider {
  name: string;
  getCumulativeWorldwideGross(movie: ProviderMovieInput, asOfDate: Date): Promise<BoxOfficeResult>;
}

export interface RatingsProvider {
  name: string;
  getRtScores(movie: ProviderMovieInput): Promise<RatingsResult>;
}

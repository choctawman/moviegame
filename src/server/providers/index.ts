import { prisma } from "@/lib/prisma";
import { BoxOfficeScraperProvider } from "@/server/providers/boxOfficeScraperProvider";
import { RtScraperProvider } from "@/server/providers/rtScraperProvider";
import type { BoxOfficeProvider, ProviderMovieInput, RatingsProvider } from "@/server/providers/types";

const ratingsProviders: RatingsProvider[] = [new RtScraperProvider()];
const boxOfficeProviders: BoxOfficeProvider[] = [new BoxOfficeScraperProvider()];

export async function resolveRatings(movie: ProviderMovieInput, leagueId: string) {
  const errors: string[] = [];
  type RatingsNoScoreResult = {
    providerName: string;
  } & Awaited<ReturnType<RatingsProvider["getRtScores"]>>;
  let noScoreResult: RatingsNoScoreResult | null = null;

  for (const provider of ratingsProviders) {
    try {
      const result = await provider.getRtScores(movie);

      await prisma.providerStatus.upsert({
        where: {
          leagueId_providerName: {
            leagueId,
            providerName: provider.name,
          },
        },
        update: {
          lastSuccessAt: new Date(),
          lastErrorAt: null,
          lastErrorMessage: null,
        },
        create: {
          leagueId,
          providerName: provider.name,
          lastSuccessAt: new Date(),
        },
      });

      if (result.critics != null || result.audience != null) {
        return { ...result, providerName: provider.name };
      }

      if (!noScoreResult) {
        noScoreResult = { ...result, providerName: provider.name };
      }
    } catch (error) {
      const message = (error as Error).message;
      errors.push(`${provider.name}: ${message}`);
      await prisma.providerStatus.upsert({
        where: {
          leagueId_providerName: {
            leagueId,
            providerName: provider.name,
          },
        },
        update: {
          lastErrorAt: new Date(),
          lastErrorMessage: message,
        },
        create: {
          leagueId,
          providerName: provider.name,
          lastErrorAt: new Date(),
          lastErrorMessage: message,
        },
      });
    }
  }

  if (noScoreResult) {
    return noScoreResult;
  }

  throw new Error(errors.length > 0 ? errors.join(" | ") : "No ratings provider available");
}

export async function resolveCumulativeGross(movie: ProviderMovieInput, asOfDate: Date, leagueId: string) {
  const errors: string[] = [];

  for (const provider of boxOfficeProviders) {
    try {
      const result = await provider.getCumulativeWorldwideGross(movie, asOfDate);

      await prisma.providerStatus.upsert({
        where: {
          leagueId_providerName: {
            leagueId,
            providerName: provider.name,
          },
        },
        update: {
          lastSuccessAt: new Date(),
          lastErrorAt: null,
          lastErrorMessage: null,
        },
        create: {
          leagueId,
          providerName: provider.name,
          lastSuccessAt: new Date(),
        },
      });

      return { ...result, providerName: provider.name };
    } catch (error) {
      const message = (error as Error).message;
      errors.push(`${provider.name}: ${message}`);
      await prisma.providerStatus.upsert({
        where: {
          leagueId_providerName: {
            leagueId,
            providerName: provider.name,
          },
        },
        update: {
          lastErrorAt: new Date(),
          lastErrorMessage: message,
        },
        create: {
          leagueId,
          providerName: provider.name,
          lastErrorAt: new Date(),
          lastErrorMessage: message,
        },
      });
    }
  }

  throw new Error(errors.length > 0 ? errors.join(" | ") : "No box office provider available");
}

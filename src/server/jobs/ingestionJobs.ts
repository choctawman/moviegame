import { prisma } from "@/lib/prisma";
import { ingestSeasonMoviesForLeague } from "@/server/services/movieIngestionService";
import { getCurrentWeekForLeague } from "@/server/services/leagueQueryService";
import { refreshMovieSeasonStats } from "@/server/services/historicalScoringService";
import { refreshWeekScoring } from "@/server/services/scoringService";

export async function handleSeasonIngestionJob(data: { leagueId: string }) {
  return ingestSeasonMoviesForLeague(data.leagueId);
}

export async function handleDailyStatsIngestionJob(data: { leagueId: string }) {
  const [league, week] = await Promise.all([
    prisma.league.findUnique({
      where: { id: data.leagueId },
      select: {
        seasonYear: true,
        eligibleMovies: {
          select: { movieId: true },
        },
      },
    }),
    getCurrentWeekForLeague(data.leagueId),
  ]);

  if (!league || !week) {
    return;
  }

  const asOf = new Date();
  const movieIds = league.eligibleMovies.map((movie) => movie.movieId);

  await Promise.all([
    refreshWeekScoring(data.leagueId, week.id, asOf),
    refreshMovieSeasonStats(data.leagueId, league.seasonYear, movieIds, { asOfDate: asOf }),
  ]);
}

export async function enqueueDailyIngestionForAllLeagues(): Promise<string[]> {
  const leagues = await prisma.league.findMany({ select: { id: true } });
  return leagues.map((league) => league.id);
}

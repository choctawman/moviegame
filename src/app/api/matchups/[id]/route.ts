import { prisma } from "@/lib/prisma";
import { apiHandler, ok } from "@/server/api/http";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;

    const matchup = await prisma.matchup.findUnique({
      where: { id },
      include: {
        week: true,
        homeTeam: true,
        awayTeam: true,
      },
    });

    if (!matchup) {
      return ok({ matchup: null, teamScores: [], movieStats: [] });
    }

    const [teamScores, movieStats] = await Promise.all([
      prisma.teamWeekScore.findMany({
        where: {
          leagueId: matchup.leagueId,
          weekId: matchup.weekId,
          teamId: {
            in: [matchup.homeTeamId, matchup.awayTeamId],
          },
        },
      }),
      prisma.movieWeekStat.findMany({
        where: {
          leagueId: matchup.leagueId,
          weekId: matchup.weekId,
        },
        include: {
          movie: true,
        },
      }),
    ]);

    return ok({ matchup, teamScores, movieStats });
  });
}

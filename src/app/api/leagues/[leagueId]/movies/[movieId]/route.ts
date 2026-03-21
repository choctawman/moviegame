import { prisma } from "@/lib/prisma";
import { apiHandler, ApiError, ok, requireAuth } from "@/server/api/http";
import { requireLeagueCommissioner } from "@/server/auth/permissions";

export async function DELETE(_: Request, context: { params: Promise<{ leagueId: string; movieId: string }> }) {
  return apiHandler(async () => {
    const user = await requireAuth();
    const { leagueId, movieId } = await context.params;
    await requireLeagueCommissioner(user.id, leagueId);

    const movie = await prisma.movie.findUnique({
      where: { id: movieId },
      select: { id: true, title: true },
    });
    if (!movie) {
      throw new ApiError(404, "Movie not found");
    }

    const eligibility = await prisma.leagueEligibleMovie.findUnique({
      where: {
        leagueId_movieId: {
          leagueId,
          movieId,
        },
      },
      select: { id: true },
    });
    if (!eligibility) {
      throw new ApiError(404, "Movie is not currently in this league");
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.leagueEligibleMovie.delete({
        where: {
          leagueId_movieId: {
            leagueId,
            movieId,
          },
        },
      });

      const weekStatsDeleted = await tx.movieWeekStat.deleteMany({
        where: {
          leagueId,
          movieId,
        },
      });

      return {
        weekStatsDeleted: weekStatsDeleted.count,
      };
    });

    return ok({
      removed: true,
      movie: {
        id: movie.id,
        title: movie.title,
      },
      weekStatsDeleted: result.weekStatsDeleted,
    });
  });
}

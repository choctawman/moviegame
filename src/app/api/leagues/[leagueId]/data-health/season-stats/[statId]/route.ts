import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiHandler, ApiError, ok, parseBody, requireAuth } from "@/server/api/http";
import { requireLeagueCommissioner } from "@/server/auth/permissions";

const updateSeasonStatSchema = z.object({
  worldwideGrossUsd: z.number().int().nonnegative(),
  rtCriticsScore: z.number().int().min(0).max(100).nullable(),
  rtAudienceScore: z.number().int().min(0).max(100).nullable(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ leagueId: string; statId: string }> },
) {
  return apiHandler(async () => {
    const user = await requireAuth();
    const { leagueId, statId } = await context.params;
    await requireLeagueCommissioner(user.id, leagueId);

    const input = await parseBody(request, updateSeasonStatSchema);

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { seasonYear: true },
    });
    if (!league) {
      throw new ApiError(404, "League not found");
    }

    const existing = await prisma.movieSeasonStat.findUnique({
      where: { id: statId },
      select: { id: true, movieId: true, seasonYear: true },
    });
    if (!existing) {
      throw new ApiError(404, "Season score row not found");
    }

    // This page edits previous-season scoring used in player-pool "last year points".
    if (existing.seasonYear !== league.seasonYear - 1) {
      throw new ApiError(400, "Only previous-season score rows can be edited from this league");
    }

    const isRelevantToLeague = await prisma.credit.findFirst({
      where: {
        movieId: existing.movieId,
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
      select: { id: true },
    });
    if (!isRelevantToLeague) {
      throw new ApiError(404, "Season score row is not relevant to this league");
    }

    const updated = await prisma.movieSeasonStat.update({
      where: { id: statId },
      data: {
        worldwideGrossUsd: BigInt(input.worldwideGrossUsd),
        rtCriticsScore: input.rtCriticsScore,
        rtAudienceScore: input.rtAudienceScore,
        dataStatus: "MANUAL_OVERRIDE",
        errorMessage: null,
        manualOverrideAt: new Date(),
        manualOverrideByUserId: user.id,
        snapshotAt: new Date(),
      },
      select: {
        id: true,
        worldwideGrossUsd: true,
        rtCriticsScore: true,
        rtAudienceScore: true,
        dataStatus: true,
      },
    });

    return ok({
      stat: {
        ...updated,
        worldwideGrossUsd: updated.worldwideGrossUsd.toString(),
      },
    });
  });
}

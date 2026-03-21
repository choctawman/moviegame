import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, parseBody, requireAuth, ApiError } from "@/server/api/http";
import { getWaiverPeriodForLeague } from "@/server/services/leagueQueryService";
import { submitWaiverNomination } from "@/server/services/waiverService";

const schema = z.object({
  fantasyPlayerId: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    const membership = await requireLeagueMembership(user.id, leagueId);
    if (!membership.teamId) {
      throw new ApiError(400, "You are not assigned to a team in this league");
    }

    const body = await parseBody(request, schema);
    await submitWaiverNomination(leagueId, membership.teamId, body.fantasyPlayerId);

    return ok({ success: true });
  });
}

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const week = await getWaiverPeriodForLeague(leagueId);
    if (!week) {
      throw new ApiError(400, "No waiver month found");
    }

    const nominations = await prisma.waiverNomination.findMany({
      where: {
        leagueId,
        weekId: week.id,
      },
      include: {
        nominatingTeam: true,
        fantasyPlayer: {
          include: {
            person: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    return ok({ nominations });
  });
}

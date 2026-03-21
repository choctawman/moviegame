import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, parseBody, requireAuth, ApiError } from "@/server/api/http";
import { submitWaiverClaims } from "@/server/services/waiverService";

const schema = z.object({
  claims: z
    .array(
      z.object({
        addFantasyPlayerId: z.string().min(1),
        bidAmount: z.number().int().min(1),
        targetRosterSlotId: z.string().min(1),
      }),
    )
    .min(1),
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

    await submitWaiverClaims(leagueId, membership.teamId, body.claims);

    return ok({ success: true });
  });
}

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const claims = await prisma.waiverClaim.findMany({
      where: { leagueId },
      include: {
        team: true,
        addFantasyPlayer: { include: { person: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    return ok({ claims });
  });
}

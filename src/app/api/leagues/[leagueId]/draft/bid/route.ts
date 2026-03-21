import { z } from "zod";

import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ApiError, ok, parseBody, requireAuth } from "@/server/api/http";
import { draftStateService } from "@/server/services/draftStateService";

const schema = z.object({
  nominationId: z.string().min(1),
  amount: z.number().int().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    const membership = await requireLeagueMembership(user.id, leagueId);
    if (!membership.teamId) {
      throw new ApiError(400, "You need a team to bid");
    }
    const body = await parseBody(request, schema);

    const bid = await draftStateService.bid({
      leagueId,
      nominationId: body.nominationId,
      amount: body.amount,
      bidTeamId: membership.teamId,
    });

    return ok({ bid });
  });
}

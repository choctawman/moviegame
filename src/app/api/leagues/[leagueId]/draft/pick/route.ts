import { z } from "zod";

import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ApiError, ok, parseBody, requireAuth } from "@/server/api/http";
import { draftStateService } from "@/server/services/draftStateService";

const schema = z.object({
  fantasyPlayerId: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    const membership = await requireLeagueMembership(user.id, leagueId);
    const body = await parseBody(request, schema);

    const state = await draftStateService.getState(leagueId);

    const canPick =
      membership.role === "COMMISSIONER" ||
      (membership.teamId != null && state.currentPick != null && membership.teamId === state.currentPick.teamId);

    if (!canPick) {
      throw new ApiError(403, "It is not your team's turn to pick");
    }

    const pick = await draftStateService.makePick({
      leagueId,
      fantasyPlayerId: body.fantasyPlayerId,
    });

    return ok({ pick });
  });
}

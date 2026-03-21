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
    if (!membership.teamId) {
      throw new ApiError(400, "You need a team to nominate");
    }
    const body = await parseBody(request, schema);

    const nomination = await draftStateService.nominate({
      leagueId,
      fantasyPlayerId: body.fantasyPlayerId,
      nominatingTeamId: membership.teamId,
    });

    return ok({ nomination });
  });
}

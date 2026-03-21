import { z } from "zod";

import { requireLeagueCommissioner } from "@/server/auth/permissions";
import { apiHandler, ok, parseBody, requireAuth } from "@/server/api/http";
import { draftStateService } from "@/server/services/draftStateService";

const schema = z.object({
  teamId: z.string().min(1),
  fantasyPlayerId: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueCommissioner(user.id, leagueId);
    const body = await parseBody(request, schema);

    const pick = await draftStateService.forcePick({
      leagueId,
      teamId: body.teamId,
      fantasyPlayerId: body.fantasyPlayerId,
    });

    return ok({ pick });
  });
}

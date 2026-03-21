import { z } from "zod";

import { requireTeamOwner } from "@/server/auth/permissions";
import { apiHandler, ok, parseBody, requireAuth } from "@/server/api/http";
import { addFreeAgent } from "@/server/services/teamService";

const schema = z.object({
  fantasyPlayerId: z.string().min(1),
  dropRosterSlotId: z.string().min(1).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ teamId: string }> }) {
  return apiHandler(async () => {
    const { teamId } = await context.params;
    const user = await requireAuth();
    const team = await requireTeamOwner(user.id, teamId);
    const body = await parseBody(request, schema);

    const result = await addFreeAgent(team.leagueId, teamId, body.fantasyPlayerId, body.dropRosterSlotId);
    return ok({ slot: result });
  });
}

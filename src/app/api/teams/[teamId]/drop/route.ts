import { z } from "zod";

import { requireTeamOwner } from "@/server/auth/permissions";
import { apiHandler, ok, parseBody, requireAuth } from "@/server/api/http";
import { dropFromTeam } from "@/server/services/teamService";

const schema = z.object({
  rosterSlotId: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ teamId: string }> }) {
  return apiHandler(async () => {
    const { teamId } = await context.params;
    const user = await requireAuth();
    const team = await requireTeamOwner(user.id, teamId);
    const body = await parseBody(request, schema);

    const slot = await dropFromTeam(team.leagueId, teamId, body.rosterSlotId);
    return ok({ dropped: slot });
  });
}

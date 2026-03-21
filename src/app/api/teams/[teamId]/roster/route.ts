import { z } from "zod";

import { getTeamRoster } from "@/server/services/teamService";
import { requireTeamOwnerOrLeagueCommissioner } from "@/server/auth/permissions";
import { apiHandler, ok, parseBody, requireAuth } from "@/server/api/http";
import { movePlayerWithinTeam } from "@/server/services/rosterService";

const moveSchema = z.object({
  fromRosterSlotId: z.string().min(1),
  toRosterSlotId: z.string().min(1),
});

export async function GET(_: Request, context: { params: Promise<{ teamId: string }> }) {
  return apiHandler(async () => {
    const { teamId } = await context.params;
    const user = await requireAuth();
    await requireTeamOwnerOrLeagueCommissioner(user.id, teamId);

    const roster = await getTeamRoster(teamId);
    return ok({ team: roster });
  });
}

export async function POST(request: Request, context: { params: Promise<{ teamId: string }> }) {
  return apiHandler(async () => {
    const { teamId } = await context.params;
    const user = await requireAuth();
    await requireTeamOwnerOrLeagueCommissioner(user.id, teamId);
    const body = await parseBody(request, moveSchema);

    await movePlayerWithinTeam(teamId, body.fromRosterSlotId, body.toRosterSlotId);

    return ok({ success: true });
  });
}

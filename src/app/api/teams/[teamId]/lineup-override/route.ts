import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireLeagueCommissionerForTeam } from "@/server/auth/permissions";
import { apiHandler, ok, parseBody, requireAuth } from "@/server/api/http";
import { setTeamLineupUnlockForCurrentPeriod } from "@/server/services/rosterService";

const overrideSchema = z.object({
  unlocked: z.boolean(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  return apiHandler(async () => {
    const { teamId } = await context.params;
    const user = await requireAuth();
    await requireLeagueCommissionerForTeam(user.id, teamId);
    const body = await parseBody(request, overrideSchema);

    const team = await setTeamLineupUnlockForCurrentPeriod(teamId, body.unlocked);

    return ok({
      lineupUnlockWeekId: team.lineupUnlockWeekId,
    });
  });
}

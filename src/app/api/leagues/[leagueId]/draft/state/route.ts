import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth } from "@/server/api/http";
import { draftStateService } from "@/server/services/draftStateService";

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const state = await draftStateService.getState(leagueId);
    return ok(state);
  });
}

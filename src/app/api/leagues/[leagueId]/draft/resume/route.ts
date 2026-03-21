import { requireLeagueCommissioner } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth } from "@/server/api/http";
import { draftStateService } from "@/server/services/draftStateService";

export async function POST(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueCommissioner(user.id, leagueId);

    await draftStateService.resume(leagueId);
    return ok({ success: true });
  });
}

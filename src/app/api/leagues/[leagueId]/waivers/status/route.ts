import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth } from "@/server/api/http";
import { getWaiverStatus } from "@/server/services/waiverService";

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const status = await getWaiverStatus(leagueId);
    return ok(status);
  });
}

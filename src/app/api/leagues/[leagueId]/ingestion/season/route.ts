import { requireLeagueCommissioner, requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth } from "@/server/api/http";
import { enqueueSeasonIngestion, getLeagueIngestionStatus } from "@/server/services/ingestionService";

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const status = await getLeagueIngestionStatus(leagueId);
    return ok({ status });
  });
}

export async function POST(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueCommissioner(user.id, leagueId);

    const result = await enqueueSeasonIngestion(leagueId);
    return ok({
      queued: result.queued,
      jobState: result.jobState,
      message: "Season ingestion queued",
    });
  });
}

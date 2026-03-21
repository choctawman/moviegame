import { apiHandler, ok } from "@/server/api/http";
import { getFantasyPlayerDetail } from "@/server/services/playerPoolService";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const leagueId = url.searchParams.get("leagueId") ?? undefined;
    const player = await getFantasyPlayerDetail(id, leagueId);
    return ok({ player });
  });
}

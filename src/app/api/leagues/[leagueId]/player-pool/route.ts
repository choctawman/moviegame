import { FantasyRole } from "@prisma/client";

import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth } from "@/server/api/http";
import { isActiveFantasyRole } from "@/server/services/constants";
import { getLeaguePlayerPool } from "@/server/services/playerPoolService";

export async function GET(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const url = new URL(request.url);
    const roleRaw = url.searchParams.get("role");
    const q = url.searchParams.get("q") ?? undefined;
    const availableOnly = url.searchParams.get("availableOnly") === "true";

    const role =
      roleRaw && Object.values(FantasyRole).includes(roleRaw as FantasyRole) && isActiveFantasyRole(roleRaw as FantasyRole)
        ? (roleRaw as FantasyRole)
        : undefined;

    const players = await getLeaguePlayerPool({
      leagueId,
      role,
      q,
      availableOnly,
    });

    return ok({ players });
  });
}

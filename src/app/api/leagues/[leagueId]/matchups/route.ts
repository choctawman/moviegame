import { prisma } from "@/lib/prisma";
import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth } from "@/server/api/http";

export async function GET(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const url = new URL(request.url);
    const weekId = url.searchParams.get("weekId") ?? undefined;

    const matchups = await prisma.matchup.findMany({
      where: {
        leagueId,
        weekId,
      },
      include: {
        week: true,
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: [{ week: { index: "desc" } }, { id: "asc" }],
    });

    return ok({ matchups });
  });
}

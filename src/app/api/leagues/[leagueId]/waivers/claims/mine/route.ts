import { prisma } from "@/lib/prisma";
import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth, ApiError } from "@/server/api/http";

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    const membership = await requireLeagueMembership(user.id, leagueId);

    if (!membership.teamId) {
      throw new ApiError(400, "No team assigned");
    }

    const claims = await prisma.waiverClaim.findMany({
      where: {
        leagueId,
        teamId: membership.teamId,
      },
      include: {
        addFantasyPlayer: {
          include: { person: true },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    return ok({ claims });
  });
}

import { prisma } from "@/lib/prisma";
import { apiHandler, ok, requireAuth } from "@/server/api/http";
import { requireLeagueMembership } from "@/server/auth/permissions";

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
        teams: true,
        members: {
          include: {
            user: {
              select: { id: true, email: true },
            },
          },
        },
      },
    });

    return ok({ league });
  });
}

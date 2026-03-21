import { prisma } from "@/lib/prisma";
import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth } from "@/server/api/http";

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const transactions = await prisma.transaction.findMany({
      where: { leagueId },
      include: {
        fantasyPlayer: {
          include: { person: true },
        },
        team: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });

    return ok({ transactions });
  });
}

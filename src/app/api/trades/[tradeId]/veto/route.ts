import { prisma } from "@/lib/prisma";
import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth, ApiError } from "@/server/api/http";
import { castTradeVetoVote } from "@/server/services/tradeService";

export async function POST(_: Request, context: { params: Promise<{ tradeId: string }> }) {
  return apiHandler(async () => {
    const { tradeId } = await context.params;
    const user = await requireAuth();

    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      select: {
        id: true,
        leagueId: true,
      },
    });

    if (!trade) {
      throw new ApiError(404, "Trade not found");
    }

    const membership = await requireLeagueMembership(user.id, trade.leagueId);
    if (!membership.teamId) {
      throw new ApiError(403, "You need a team in this league to vote on trades");
    }

    const result = await castTradeVetoVote(tradeId, membership.teamId);

    return ok({
      success: true,
      status: result.status,
      vetoVotesCount: result.vetoVotesCount,
      vetoVotesNeeded: result.vetoVotesNeeded,
      message: result.status === "VETOED" ? "Trade vetoed." : "Veto vote recorded.",
    });
  });
}

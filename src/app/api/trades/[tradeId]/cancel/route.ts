import { prisma } from "@/lib/prisma";
import { apiHandler, ok, requireAuth, ApiError } from "@/server/api/http";
import { cancelTrade } from "@/server/services/tradeService";

export async function POST(_: Request, context: { params: Promise<{ tradeId: string }> }) {
  return apiHandler(async () => {
    const { tradeId } = await context.params;
    const user = await requireAuth();

    const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
    if (!trade) {
      throw new ApiError(404, "Trade not found");
    }

    const proposerTeam = await prisma.team.findUnique({ where: { id: trade.proposerTeamId } });
    if (proposerTeam?.ownerUserId !== user.id) {
      throw new ApiError(403, "Only proposer team owner can cancel trade");
    }

    await cancelTrade(tradeId);
    return ok({ success: true });
  });
}

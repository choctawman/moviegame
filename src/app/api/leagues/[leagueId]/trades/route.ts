import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, parseBody, requireAuth, ApiError } from "@/server/api/http";
import { proposeTrade } from "@/server/services/tradeService";

const tradeItemSchema = z
  .object({
    fromTeamId: z.string().min(1),
    fantasyPlayerId: z.string().min(1).optional(),
    rosterSlotRole: z.enum(["LEADING_ACTOR", "LEADING_ACTRESS", "SUPPORTING", "DIRECTOR", "BENCH"]).optional(),
    rosterSlotIndex: z.number().int().min(1).optional(),
    faabAmount: z.number().int().min(1).optional(),
  })
  .superRefine((item, ctx) => {
    const hasPlayerFields = Boolean(item.fantasyPlayerId || item.rosterSlotRole || item.rosterSlotIndex != null);
    const hasAllPlayerFields = Boolean(item.fantasyPlayerId && item.rosterSlotRole && item.rosterSlotIndex != null);
    const hasFaab = item.faabAmount != null;

    if (hasFaab && hasPlayerFields) {
      ctx.addIssue({
        code: "custom",
        message: "Trade items must be either a player or FAAB, not both",
      });
    }

    if (!hasFaab && !hasPlayerFields) {
      ctx.addIssue({
        code: "custom",
        message: "Trade item must include a player or FAAB amount",
      });
    }

    if (hasPlayerFields && !hasAllPlayerFields) {
      ctx.addIssue({
        code: "custom",
        message: "Player trade items must include fantasyPlayerId, rosterSlotRole, and rosterSlotIndex",
      });
    }
  });

const schema = z.object({
  recipientTeamId: z.string().min(1),
  items: z.array(tradeItemSchema).min(1),
});

export async function POST(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    const membership = await requireLeagueMembership(user.id, leagueId);

    if (!membership.teamId) {
      throw new ApiError(400, "No team assigned for this league");
    }

    const body = await parseBody(request, schema);

    const trade = await proposeTrade(leagueId, membership.teamId, body.recipientTeamId, body.items);
    return ok({ trade });
  });
}

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    const membership = await requireLeagueMembership(user.id, leagueId);

    const trades = await prisma.trade.findMany({
      where: {
        leagueId,
        OR: membership.teamId
          ? [{ proposerTeamId: membership.teamId }, { recipientTeamId: membership.teamId }]
          : undefined,
      },
      include: {
        approveVotes: {
          select: {
            teamId: true,
          },
        },
        vetoVotes: {
          select: {
            teamId: true,
          },
        },
        items: {
          include: {
            fantasyPlayer: { include: { person: true } },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    return ok({ trades });
  });
}

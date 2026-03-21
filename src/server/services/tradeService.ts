import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "@/lib/prisma";
import { ApiError } from "@/server/api/http";
import { addPlayerToRosterSlot, ensureRoleSlotCapacity, getOpenSlot } from "@/server/services/rosterService";

type TradeRosterRole = "LEADING_ACTOR" | "LEADING_ACTRESS" | "SUPPORTING" | "DIRECTOR" | "BENCH";
const TRADE_VETO_WINDOW_HOURS = 24;

export type TradeItemInput = {
  fromTeamId: string;
  fantasyPlayerId?: string | null;
  rosterSlotRole?: TradeRosterRole | null;
  rosterSlotIndex?: number | null;
  faabAmount?: number | null;
};

type TradeItemRecord = {
  fromTeamId: string;
  fantasyPlayerId: string | null;
  rosterSlotRole: string | null;
  rosterSlotIndex: number | null;
  faabAmount: number | null;
};

function isTradeRosterRole(role: string | null | undefined): role is TradeRosterRole {
  return (
    role === "LEADING_ACTOR" ||
    role === "LEADING_ACTRESS" ||
    role === "SUPPORTING" ||
    role === "DIRECTOR" ||
    role === "BENCH"
  );
}

function toTradeItemRecord(item: TradeItemInput | TradeItemRecord): TradeItemRecord {
  return {
    fromTeamId: item.fromTeamId,
    fantasyPlayerId: item.fantasyPlayerId ?? null,
    rosterSlotRole: item.rosterSlotRole ?? null,
    rosterSlotIndex: item.rosterSlotIndex ?? null,
    faabAmount: item.faabAmount ?? null,
  };
}

function getPlayerTradeAsset(item: TradeItemInput | TradeItemRecord) {
  const normalized = toTradeItemRecord(item);
  if (
    normalized.faabAmount == null &&
    normalized.fantasyPlayerId &&
    isTradeRosterRole(normalized.rosterSlotRole) &&
    normalized.rosterSlotIndex != null
  ) {
    return {
      fromTeamId: normalized.fromTeamId,
      fantasyPlayerId: normalized.fantasyPlayerId,
      rosterSlotRole: normalized.rosterSlotRole,
      rosterSlotIndex: normalized.rosterSlotIndex,
    };
  }

  return null;
}

function getFaabTradeAsset(item: TradeItemInput | TradeItemRecord) {
  const normalized = toTradeItemRecord(item);
  if (
    normalized.faabAmount != null &&
    normalized.faabAmount > 0 &&
    !normalized.fantasyPlayerId &&
    !normalized.rosterSlotRole &&
    normalized.rosterSlotIndex == null
  ) {
    return {
      fromTeamId: normalized.fromTeamId,
      faabAmount: normalized.faabAmount,
    };
  }

  return null;
}

type TeamSnapshot = {
  id: string;
  leagueId: string;
  waiverBudget: number;
};

function getRequiredVetoVotes(eligibleVetoTeamCount: number): number {
  if (eligibleVetoTeamCount <= 0) {
    return 0;
  }

  return Math.floor(eligibleVetoTeamCount / 2) + 1;
}

async function validateTradeItems(
  leagueId: string,
  proposerTeamId: string,
  recipientTeamId: string,
  items: TradeItemInput[],
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (proposerTeamId === recipientTeamId) {
    throw new ApiError(400, "Cannot trade with same team");
  }

  if (items.length === 0) {
    throw new ApiError(400, "Trade must include at least one item");
  }

  const teams = await tx.team.findMany({
    where: {
      id: { in: [proposerTeamId, recipientTeamId] },
      leagueId,
    },
    select: {
      id: true,
      leagueId: true,
      waiverBudget: true,
    },
  });

  if (teams.length !== 2) {
    throw new ApiError(400, "Trade teams are invalid for this league");
  }

  const teamById = new Map<string, TeamSnapshot>(teams.map((team) => [team.id, team]));
  const assetCountByTeamId = new Map<string, number>([
    [proposerTeamId, 0],
    [recipientTeamId, 0],
  ]);
  const faabSentByTeamId = new Map<string, number>([
    [proposerTeamId, 0],
    [recipientTeamId, 0],
  ]);
  const seenRosterKeys = new Set<string>();

  for (const item of items) {
    if (item.fromTeamId !== proposerTeamId && item.fromTeamId !== recipientTeamId) {
      throw new ApiError(400, "Trade items must belong to one of the two teams in the trade");
    }

    assetCountByTeamId.set(item.fromTeamId, (assetCountByTeamId.get(item.fromTeamId) ?? 0) + 1);

    const playerAsset = getPlayerTradeAsset(item);
    if (playerAsset) {
      const rosterKey = `${playerAsset.fromTeamId}:${playerAsset.fantasyPlayerId}`;
      if (seenRosterKeys.has(rosterKey)) {
        throw new ApiError(400, "Each player can only be included once in a trade");
      }
      seenRosterKeys.add(rosterKey);

      const slot = await tx.rosterSlot.findFirst({
        where: {
          teamId: playerAsset.fromTeamId,
          role: playerAsset.rosterSlotRole,
          slotIndex: playerAsset.rosterSlotIndex,
          fantasyPlayerId: playerAsset.fantasyPlayerId,
        },
        select: { id: true },
      });

      if (!slot) {
        throw new ApiError(400, "Trade item no longer matches the selected roster slot");
      }

      continue;
    }

    const faabAsset = getFaabTradeAsset(item);
    if (faabAsset) {
      if (!Number.isInteger(faabAsset.faabAmount) || faabAsset.faabAmount < 1) {
        throw new ApiError(400, "FAAB amount must be a whole number of at least 1");
      }

      faabSentByTeamId.set(
        faabAsset.fromTeamId,
        (faabSentByTeamId.get(faabAsset.fromTeamId) ?? 0) + faabAsset.faabAmount,
      );
      continue;
    }

    throw new ApiError(400, "Each trade item must be either a player or a FAAB amount");
  }

  for (const teamId of [proposerTeamId, recipientTeamId]) {
    if ((assetCountByTeamId.get(teamId) ?? 0) === 0) {
      throw new ApiError(400, "Each side must send at least one player or FAAB");
    }

    const outgoingFaab = faabSentByTeamId.get(teamId) ?? 0;
    const team = teamById.get(teamId);
    if (!team) {
      throw new ApiError(400, "Trade team is invalid");
    }

    if (outgoingFaab > team.waiverBudget) {
      throw new ApiError(400, `A team cannot trade more FAAB than it has available ($${team.waiverBudget})`);
    }
  }
}

export async function proposeTrade(
  leagueId: string,
  proposerTeamId: string,
  recipientTeamId: string,
  items: TradeItemInput[],
) {
  await validateTradeItems(leagueId, proposerTeamId, recipientTeamId, items);

  return prisma.trade.create({
    data: {
      leagueId,
      proposerTeamId,
      recipientTeamId,
      status: "PROPOSED",
      items: {
        create: items,
      },
    },
    include: { items: true },
  });
}

async function executeTrade(tradeId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const trade = await tx.trade.findUnique({
      where: { id: tradeId },
      include: {
        league: { include: { settings: true } },
        items: { include: { fantasyPlayer: true } },
      },
    });

    if (!trade) {
      throw new ApiError(404, "Trade not found");
    }

    if (trade.status !== "ACCEPTED" && trade.status !== "PROPOSED") {
      throw new ApiError(400, "Trade cannot be completed in current status");
    }

    await validateTradeItems(
      trade.leagueId,
      trade.proposerTeamId,
      trade.recipientTeamId,
      trade.items.flatMap((item) => {
        const asset = getPlayerTradeAsset(item) ?? getFaabTradeAsset(item);
        return asset ? [asset] : [];
      }),
      tx,
    );

    const proposerOutgoingPlayers = trade.items.filter(
      (item) => item.fromTeamId === trade.proposerTeamId && getPlayerTradeAsset(item) && item.fantasyPlayer,
    );
    const recipientOutgoingPlayers = trade.items.filter(
      (item) => item.fromTeamId === trade.recipientTeamId && getPlayerTradeAsset(item) && item.fantasyPlayer,
    );
    const proposerOutgoingFaab = trade.items.reduce(
      (sum, item) => sum + (item.fromTeamId === trade.proposerTeamId ? getFaabTradeAsset(item)?.faabAmount ?? 0 : 0),
      0,
    );
    const recipientOutgoingFaab = trade.items.reduce(
      (sum, item) => sum + (item.fromTeamId === trade.recipientTeamId ? getFaabTradeAsset(item)?.faabAmount ?? 0 : 0),
      0,
    );

    for (const item of trade.items) {
      const playerAsset = getPlayerTradeAsset(item);
      if (!playerAsset) {
        continue;
      }

      const slot = await tx.rosterSlot.findFirst({
        where: {
          teamId: playerAsset.fromTeamId,
          role: playerAsset.rosterSlotRole,
          slotIndex: playerAsset.rosterSlotIndex,
          fantasyPlayerId: playerAsset.fantasyPlayerId,
        },
      });

      if (!slot) {
        throw new ApiError(400, "Trade item no longer valid on roster");
      }
    }

    for (const item of trade.items) {
      const playerAsset = getPlayerTradeAsset(item);
      if (!playerAsset) {
        continue;
      }

      await tx.rosterSlot.updateMany({
        where: {
          teamId: playerAsset.fromTeamId,
          role: playerAsset.rosterSlotRole,
          slotIndex: playerAsset.rosterSlotIndex,
          fantasyPlayerId: playerAsset.fantasyPlayerId,
        },
        data: {
          fantasyPlayerId: null,
        },
      });
    }

    for (const item of recipientOutgoingPlayers) {
      if (!item.fantasyPlayer || !item.fantasyPlayerId) {
        throw new ApiError(400, "Trade item no longer has a valid player");
      }

      const slot = await getOpenSlot(trade.proposerTeamId, item.fantasyPlayer.role, tx);
      if (!slot) {
        throw new ApiError(400, "Proposer team has no valid slot for incoming player");
      }
      await addPlayerToRosterSlot(slot.id, item.fantasyPlayerId, tx);

      await tx.transaction.create({
        data: {
          leagueId: trade.leagueId,
          type: "TRADE",
          teamId: trade.proposerTeamId,
          fantasyPlayerId: item.fantasyPlayerId,
          rosterSlotId: slot.id,
          meta: { tradeId },
        },
      });
    }

    for (const item of proposerOutgoingPlayers) {
      if (!item.fantasyPlayer || !item.fantasyPlayerId) {
        throw new ApiError(400, "Trade item no longer has a valid player");
      }

      const slot = await getOpenSlot(trade.recipientTeamId, item.fantasyPlayer.role, tx);
      if (!slot) {
        throw new ApiError(400, "Recipient team has no valid slot for incoming player");
      }
      await addPlayerToRosterSlot(slot.id, item.fantasyPlayerId, tx);

      await tx.transaction.create({
        data: {
          leagueId: trade.leagueId,
          type: "TRADE",
          teamId: trade.recipientTeamId,
          fantasyPlayerId: item.fantasyPlayerId,
          rosterSlotId: slot.id,
          meta: { tradeId },
        },
      });
    }

    if (proposerOutgoingFaab !== recipientOutgoingFaab) {
      await tx.team.update({
        where: { id: trade.proposerTeamId },
        data: {
          waiverBudget: {
            increment: recipientOutgoingFaab - proposerOutgoingFaab,
          },
        },
      });

      await tx.team.update({
        where: { id: trade.recipientTeamId },
        data: {
          waiverBudget: {
            increment: proposerOutgoingFaab - recipientOutgoingFaab,
          },
        },
      });
    }

    await ensureRoleSlotCapacity(trade.proposerTeamId, tx);
    await ensureRoleSlotCapacity(trade.recipientTeamId, tx);

    await tx.trade.update({
      where: { id: tradeId },
      data: {
        status: "COMPLETED",
      },
    });
  });
}

export async function acceptTrade(tradeId: string): Promise<void> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new ApiError(404, "Trade not found");
  }

  if (trade.status !== "PROPOSED") {
    throw new ApiError(400, "Trade is not pending");
  }

  const eligibleVetoTeamCount = await prisma.team.count({
    where: {
      leagueId: trade.leagueId,
      id: {
        notIn: [trade.proposerTeamId, trade.recipientTeamId],
      },
    },
  });

  if (eligibleVetoTeamCount === 0) {
    await executeTrade(tradeId);
    return;
  }

  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status: "ACCEPTED",
      reviewEndsAt: DateTime.now()
        .plus({ hours: TRADE_VETO_WINDOW_HOURS })
        .toUTC()
        .toJSDate(),
    },
  });
}

export async function completeAcceptedTradesPastReviewWindow(): Promise<void> {
  const now = new Date();
  const trades = await prisma.trade.findMany({
    where: {
      status: "ACCEPTED",
      reviewEndsAt: {
        lte: now,
      },
    },
    select: {
      id: true,
    },
  });

  for (const trade of trades) {
    await executeTrade(trade.id);
  }
}

export async function rejectTrade(tradeId: string): Promise<void> {
  await prisma.trade.update({
    where: { id: tradeId },
    data: { status: "REJECTED" },
  });
}

export async function cancelTrade(tradeId: string): Promise<void> {
  await prisma.trade.update({
    where: { id: tradeId },
    data: { status: "CANCELED" },
  });
}

export async function castTradeVetoVote(
  tradeId: string,
  teamId: string,
): Promise<{ status: "ACCEPTED" | "VETOED"; vetoVotesCount: number; vetoVotesNeeded: number }> {
  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.findUnique({
      where: { id: tradeId },
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
      },
    });

    if (!trade) {
      throw new ApiError(404, "Trade not found");
    }

    if (trade.status !== "ACCEPTED") {
      throw new ApiError(400, "Trade is not in the veto window");
    }

    if (!trade.reviewEndsAt || trade.reviewEndsAt <= new Date()) {
      throw new ApiError(400, "The veto window has ended");
    }

    if (teamId === trade.proposerTeamId || teamId === trade.recipientTeamId) {
      throw new ApiError(403, "Teams involved in the trade cannot vote to veto");
    }

    const votingTeam = await tx.team.findFirst({
      where: {
        id: teamId,
        leagueId: trade.leagueId,
      },
      select: {
        id: true,
      },
    });

    if (!votingTeam) {
      throw new ApiError(403, "Only teams in this league can vote to veto");
    }

    if (trade.vetoVotes.some((vote) => vote.teamId === teamId)) {
      throw new ApiError(400, "Your team has already voted to veto this trade");
    }

    if (trade.approveVotes.some((vote) => vote.teamId === teamId)) {
      throw new ApiError(400, "Your team has already voted to approve this trade");
    }

    const eligibleVetoTeamCount = await tx.team.count({
      where: {
        leagueId: trade.leagueId,
        id: {
          notIn: [trade.proposerTeamId, trade.recipientTeamId],
        },
      },
    });
    const vetoVotesNeeded = getRequiredVetoVotes(eligibleVetoTeamCount);

    if (vetoVotesNeeded === 0) {
      throw new ApiError(400, "There are no eligible veto voters for this trade");
    }

    await tx.tradeVetoVote.create({
      data: {
        tradeId,
        teamId,
      },
    });

    const vetoVotesCount = trade.vetoVotes.length + 1;
    if (vetoVotesCount >= vetoVotesNeeded) {
      await tx.trade.update({
        where: { id: tradeId },
        data: {
          status: "VETOED",
        },
      });

      return {
        status: "VETOED",
        vetoVotesCount,
        vetoVotesNeeded,
      };
    }

    return {
      status: "ACCEPTED",
      vetoVotesCount,
      vetoVotesNeeded,
    };
  });
}

export async function castTradeApproveVote(
  tradeId: string,
  teamId: string,
): Promise<{ status: "ACCEPTED"; approveVotesCount: number }> {
  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.findUnique({
      where: { id: tradeId },
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
      },
    });

    if (!trade) {
      throw new ApiError(404, "Trade not found");
    }

    if (trade.status !== "ACCEPTED") {
      throw new ApiError(400, "Trade is not in the review window");
    }

    if (!trade.reviewEndsAt || trade.reviewEndsAt <= new Date()) {
      throw new ApiError(400, "The review window has ended");
    }

    if (teamId === trade.proposerTeamId || teamId === trade.recipientTeamId) {
      throw new ApiError(403, "Teams involved in the trade cannot vote on approval");
    }

    const votingTeam = await tx.team.findFirst({
      where: {
        id: teamId,
        leagueId: trade.leagueId,
      },
      select: {
        id: true,
      },
    });

    if (!votingTeam) {
      throw new ApiError(403, "Only teams in this league can vote on trades");
    }

    if (trade.approveVotes.some((vote) => vote.teamId === teamId)) {
      throw new ApiError(400, "Your team has already approved this trade");
    }

    if (trade.vetoVotes.some((vote) => vote.teamId === teamId)) {
      throw new ApiError(400, "Your team has already voted to veto this trade");
    }

    await tx.tradeApproveVote.create({
      data: {
        tradeId,
        teamId,
      },
    });

    return {
      status: "ACCEPTED",
      approveVotesCount: trade.approveVotes.length + 1,
    };
  });
}

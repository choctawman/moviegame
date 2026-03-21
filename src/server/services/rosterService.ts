import type { FantasyRole, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ApiError } from "@/server/api/http";
import { getCurrentWeekForLeague } from "@/server/services/leagueQueryService";
import { finalizeMostRecentlyEndedPeriodIfNeeded } from "@/server/services/scoringService";
import {
  ACTIVE_FANTASY_ROLES,
  BENCH_SLOT_COUNT,
  isActiveFantasyRole,
  ROLE_SLOT_LIMITS,
} from "@/server/services/constants";
import { isLineupLockedForPeriod } from "@/server/utils/time";

const BENCH_MOVE_TARGET = "__bench__";

function getDb(tx?: Prisma.TransactionClient): PrismaClient | Prisma.TransactionClient {
  return tx ?? prisma;
}

export async function createDefaultRosterSlots(teamId: string, tx?: Prisma.TransactionClient): Promise<void> {
  const db = getDb(tx);
  const starterSlots = Object.entries(ROLE_SLOT_LIMITS).flatMap(([role, limit]) =>
    Array.from({ length: limit }, (_, idx) => ({
      teamId,
      role: role as FantasyRole,
      slotIndex: idx + 1,
    })),
  );
  const benchSlots = Array.from({ length: BENCH_SLOT_COUNT }, (_, idx) => ({
    teamId,
    role: "BENCH" as FantasyRole,
    slotIndex: idx + 1,
  }));
  const slots = [...starterSlots, ...benchSlots];

  await db.rosterSlot.createMany({ data: slots });
}

export async function getOpenSlot(teamId: string, role: FantasyRole, tx?: Prisma.TransactionClient) {
  const db = getDb(tx);
  const roleSlot = await db.rosterSlot.findFirst({
    where: { teamId, role, fantasyPlayerId: null },
    orderBy: { slotIndex: "asc" },
  });

  if (roleSlot) {
    return roleSlot;
  }

  if (isActiveFantasyRole(role)) {
    return db.rosterSlot.findFirst({
      where: { teamId, role: "BENCH", fantasyPlayerId: null },
      orderBy: { slotIndex: "asc" },
    });
  }

  return null;
}

export async function validateCanAddPlayerToTeam(
  leagueId: string,
  teamId: string,
  fantasyPlayerId: string,
  dropRosterSlotId?: string | null,
  tx?: Prisma.TransactionClient,
): Promise<{ openSlotId: string; droppedSlotId?: string }> {
  const db = getDb(tx);

  const fantasyPlayer = await db.fantasyPlayer.findUnique({ where: { id: fantasyPlayerId } });
  if (!fantasyPlayer) {
    throw new ApiError(404, "Fantasy player not found");
  }
  if (!isActiveFantasyRole(fantasyPlayer.role)) {
    throw new ApiError(400, "That role is disabled");
  }

  const rostered = await db.rosterSlot.findFirst({
    where: {
      team: { leagueId },
      fantasyPlayerId,
    },
  });

  if (rostered) {
    throw new ApiError(400, "Player already rostered in league");
  }

  const openSlot = await getOpenSlot(teamId, fantasyPlayer.role, tx);

  if (!openSlot && dropRosterSlotId) {
    const dropSlot = await db.rosterSlot.findFirst({
      where: {
        id: dropRosterSlotId,
        teamId,
      },
    });

    if (!dropSlot) {
      throw new ApiError(400, "Invalid drop slot");
    }

    if (!dropSlot.fantasyPlayerId) {
      throw new ApiError(400, "Drop slot is already empty");
    }

    if (dropSlot.role !== fantasyPlayer.role && dropSlot.role !== "BENCH") {
      throw new ApiError(400, "Drop slot must match role or be a bench slot");
    }

    return { openSlotId: dropSlot.id, droppedSlotId: dropSlot.id };
  }

  if (!openSlot) {
    throw new ApiError(400, "No open roster slot available for role");
  }

  return { openSlotId: openSlot.id };
}

export async function addPlayerToRosterSlot(
  rosterSlotId: string,
  fantasyPlayerId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = getDb(tx);
  await db.rosterSlot.update({
    where: { id: rosterSlotId },
    data: { fantasyPlayerId },
  });
}

export async function dropRosterSlot(rosterSlotId: string, tx?: Prisma.TransactionClient): Promise<void> {
  const db = getDb(tx);
  await db.rosterSlot.update({
    where: { id: rosterSlotId },
    data: { fantasyPlayerId: null },
  });
}

export async function ensureRoleSlotCapacity(teamId: string, tx?: Prisma.TransactionClient): Promise<void> {
  const db = getDb(tx);
  const slots = await db.rosterSlot.findMany({ where: { teamId } });
  const counts = slots.reduce<Record<(typeof ACTIVE_FANTASY_ROLES)[number], number>>(
    (acc, slot) => {
      if (slot.fantasyPlayerId && isActiveFantasyRole(slot.role)) {
        acc[slot.role] += 1;
      }
      return acc;
    },
    {
      LEADING_ACTOR: 0,
      LEADING_ACTRESS: 0,
      SUPPORTING: 0,
      DIRECTOR: 0,
    },
  );

  const overflowRole = ACTIVE_FANTASY_ROLES.find((role) => counts[role] > ROLE_SLOT_LIMITS[role]);

  if (overflowRole) {
    throw new ApiError(400, `Team exceeds roster slot limit for ${overflowRole}`);
  }
}

function canPlayerFitSlot(playerRole: FantasyRole, slotRole: FantasyRole): boolean {
  if (slotRole === "BENCH") {
    return isActiveFantasyRole(playerRole);
  }
  return playerRole === slotRole;
}

export async function movePlayerWithinTeam(
  teamId: string,
  fromRosterSlotId: string,
  toRosterSlotId: string,
): Promise<void> {
  if (fromRosterSlotId === toRosterSlotId) {
    throw new ApiError(400, "Source and target slot must be different");
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      leagueId: true,
      lineupUnlockWeekId: true,
      league: {
        select: {
          timezone: true,
        },
      },
    },
  });

  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentPeriod = await getCurrentWeekForLeague(team.leagueId);
  if (!currentPeriod) {
    throw new ApiError(400, "No active month found");
  }

  const lineupOverrideActive = team.lineupUnlockWeekId === currentPeriod.id;

  if (isLineupLockedForPeriod(currentPeriod.startAt, team.league.timezone) && !lineupOverrideActive) {
    throw new ApiError(400, "Lineup is locked for the rest of the month after the first Friday deadline");
  }

  await finalizeMostRecentlyEndedPeriodIfNeeded(team.leagueId);

  await prisma.$transaction(async (tx) => {
    const fromSlot = await tx.rosterSlot.findFirst({
      where: {
        id: fromRosterSlotId,
        teamId,
      },
      include: {
        fantasyPlayer: true,
      },
    });

    if (!fromSlot) {
      throw new ApiError(404, "Roster slot not found");
    }

    if (!fromSlot.fantasyPlayerId || !fromSlot.fantasyPlayer) {
      throw new ApiError(400, "Source slot must contain a player");
    }

    if (toRosterSlotId === BENCH_MOVE_TARGET) {
      if (fromSlot.role === "BENCH") {
        throw new ApiError(400, "Bench player is already on the bench");
      }

      const emptyBenchSlot = await tx.rosterSlot.findFirst({
        where: {
          teamId,
          role: "BENCH",
          fantasyPlayerId: null,
        },
        orderBy: { slotIndex: "asc" },
      });

      const targetBenchSlot =
        emptyBenchSlot ??
        (await tx.rosterSlot.create({
          data: {
            teamId,
            role: "BENCH",
            slotIndex:
              ((await tx.rosterSlot.aggregate({
                where: {
                  teamId,
                  role: "BENCH",
                },
                _max: {
                  slotIndex: true,
                },
              }))._max.slotIndex ?? 0) + 1,
          },
        }));

      await tx.rosterSlot.update({
        where: { id: fromSlot.id },
        data: {
          fantasyPlayerId: null,
        },
      });

      await tx.rosterSlot.update({
        where: { id: targetBenchSlot.id },
        data: {
          fantasyPlayerId: fromSlot.fantasyPlayerId,
        },
      });

      return;
    }

    const toSlot = await tx.rosterSlot.findFirst({
      where: {
        id: toRosterSlotId,
        teamId,
      },
      include: {
        fantasyPlayer: true,
      },
    });

    if (!toSlot) {
      throw new ApiError(404, "Roster slot not found");
    }

    if (!canPlayerFitSlot(fromSlot.fantasyPlayer.role, toSlot.role)) {
      throw new ApiError(400, "Source player cannot be moved into the selected target slot");
    }

    if (toSlot.fantasyPlayer && !canPlayerFitSlot(toSlot.fantasyPlayer.role, fromSlot.role)) {
      throw new ApiError(400, "Target player cannot be moved back into the source slot");
    }

    const fromFantasyPlayerId = fromSlot.fantasyPlayerId;
    const toFantasyPlayerId = toSlot.fantasyPlayerId;

    await tx.rosterSlot.update({
      where: { id: fromSlot.id },
      data: {
        fantasyPlayerId: null,
      },
    });

    await tx.rosterSlot.update({
      where: { id: toSlot.id },
      data: {
        fantasyPlayerId: fromFantasyPlayerId,
      },
    });

    await tx.rosterSlot.update({
      where: { id: fromSlot.id },
      data: {
        fantasyPlayerId: toFantasyPlayerId ?? null,
      },
    });

    if (fromSlot.role === "BENCH" && fromSlot.slotIndex > BENCH_SLOT_COUNT && !toFantasyPlayerId) {
      await tx.rosterSlot.delete({
        where: { id: fromSlot.id },
      });
    }
  });
}

export async function setTeamLineupUnlockForCurrentPeriod(
  teamId: string,
  unlocked: boolean,
): Promise<{ lineupUnlockWeekId: string | null }> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      leagueId: true,
    },
  });

  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  if (!unlocked) {
    return prisma.team.update({
      where: { id: teamId },
      data: { lineupUnlockWeekId: null },
      select: { lineupUnlockWeekId: true },
    });
  }

  const currentPeriod = await getCurrentWeekForLeague(team.leagueId);
  if (!currentPeriod) {
    throw new ApiError(400, "No active month found");
  }

  return prisma.team.update({
    where: { id: teamId },
    data: {
      lineupUnlockWeekId: currentPeriod.id,
    },
    select: { lineupUnlockWeekId: true },
  });
}

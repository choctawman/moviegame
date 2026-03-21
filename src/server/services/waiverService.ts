import { DateTime } from "luxon";

import { prisma } from "@/lib/prisma";
import { ApiError } from "@/server/api/http";
import { getCurrentWeekForLeague, getWaiverPeriodForLeague } from "@/server/services/leagueQueryService";
import { isActiveFantasyRole } from "@/server/services/constants";
import { pickWinningFaabClaim } from "@/server/services/waiverResolver";
import {
  formatMonthLabel,
  isLineupLockedForPeriod,
  isNominationWindowOpenForPeriod,
  isWaiverClaimsWindowOpenForPeriod,
  isWaiverPoolPublishedForPeriod,
  resolveMonthlyCycleTimes,
} from "@/server/utils/time";

type WaiverPeriod = Awaited<ReturnType<typeof getWaiverPeriodForLeague>>;

async function getLeagueContext(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      timezone: true,
      weeks: {
        orderBy: { index: "asc" },
        select: { id: true, index: true, startAt: true, endAt: true },
      },
    },
  });

  if (!league) {
    throw new ApiError(404, "League not found");
  }

  return league;
}

function assertWaiverPeriod(period: WaiverPeriod): asserts period is NonNullable<WaiverPeriod> {
  if (!period) {
    throw new ApiError(400, "No waiver month found");
  }
}

export async function getWaiverStatus(leagueId: string, now?: Date) {
  const league = await getLeagueContext(leagueId);
  const [currentPeriod, waiverPeriod] = await Promise.all([
    getCurrentWeekForLeague(leagueId),
    getWaiverPeriodForLeague(leagueId, now),
  ]);

  assertWaiverPeriod(waiverPeriod);

  const cycle = resolveMonthlyCycleTimes(waiverPeriod.startAt, league.timezone);
  const nextPeriod = league.weeks.find((item) => item.index === waiverPeriod.index + 1) ?? null;
  const currentLineupCycle = currentPeriod ? resolveMonthlyCycleTimes(currentPeriod.startAt, league.timezone) : null;
  const nextLineupCycle = nextPeriod ? resolveMonthlyCycleTimes(nextPeriod.startAt, league.timezone) : null;
  const nowUtc = DateTime.fromJSDate(now ?? new Date()).toUTC();

  const lineupLockAt =
    currentLineupCycle && nowUtc <= DateTime.fromJSDate(currentLineupCycle.lineupLockAt).toUTC()
      ? currentLineupCycle.lineupLockAt
      : nextLineupCycle?.lineupLockAt ?? currentLineupCycle?.lineupLockAt ?? waiverPeriod.endAt;

  return {
    claimsOpen: waiverPeriod.index !== 1 && isWaiverClaimsWindowOpenForPeriod(waiverPeriod.startAt, league.timezone, now),
    nominationsOpen:
      waiverPeriod.index !== 1 && isNominationWindowOpenForPeriod(waiverPeriod.startAt, league.timezone, now),
    lineupLocked: currentPeriod ? isLineupLockedForPeriod(currentPeriod.startAt, league.timezone, now) : false,
    nextLineupLockTime: lineupLockAt.toISOString(),
    nextNominationProcessingTime: cycle.waiverPoolPublishAt.toISOString(),
    nextWaiverProcessingTime: cycle.waiverProcessAt?.toISOString() ?? null,
    waiverPoolPublished:
      waiverPeriod.index !== 1 && isWaiverPoolPublishedForPeriod(waiverPeriod.startAt, league.timezone, now),
    waiverWeekId: waiverPeriod.id,
    waiverPeriodLabel: formatMonthLabel(waiverPeriod.startAt, league.timezone),
    januaryWaiversSkipped: waiverPeriod.index === 1,
  };
}

export async function assertFreeAgencyOpen(leagueId: string, now?: Date): Promise<void> {
  const status = await getWaiverStatus(leagueId, now);
  if (!status.claimsOpen) {
    throw new ApiError(403, "Waiver claims are closed");
  }
}

async function getWaiverPeriodIdOrThrow(leagueId: string, now?: Date): Promise<string> {
  const period = await getWaiverPeriodForLeague(leagueId, now);
  assertWaiverPeriod(period);
  return period.id;
}

export async function submitWaiverNomination(
  leagueId: string,
  teamId: string,
  fantasyPlayerId: string,
): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, timezone: true },
  });

  if (!league) {
    throw new ApiError(404, "League not found");
  }

  const waiverPeriod = await getWaiverPeriodForLeague(leagueId);
  assertWaiverPeriod(waiverPeriod);

  if (waiverPeriod.index === 1) {
    throw new ApiError(403, "January waivers are skipped");
  }

  if (!isNominationWindowOpenForPeriod(waiverPeriod.startAt, league.timezone)) {
    throw new ApiError(403, "Waiver nominations are closed");
  }

  const weekId = await getWaiverPeriodIdOrThrow(leagueId);

  await prisma.$transaction(async (tx) => {
    const team = await tx.team.findFirst({
      where: {
        id: teamId,
        leagueId,
      },
      select: { id: true },
    });

    if (!team) {
      throw new ApiError(400, "Invalid team for league");
    }

    const player = await tx.fantasyPlayer.findFirst({
      where: {
        id: fantasyPlayerId,
        person: {
          credits: {
            some: {
              movie: {
                eligibleLeagues: {
                  some: { leagueId },
                },
              },
            },
          },
        },
      },
      include: { person: true },
    });

    if (!player) {
      throw new ApiError(404, "Fantasy player not found in this league pool");
    }

    if (!isActiveFantasyRole(player.role)) {
      throw new ApiError(400, "That player role is not eligible");
    }

    const alreadyRostered = await tx.rosterSlot.findFirst({
      where: {
        team: { leagueId },
        fantasyPlayerId: player.id,
      },
      select: { id: true },
    });

    if (alreadyRostered) {
      throw new ApiError(400, "Player is already rostered");
    }

    await tx.waiverNomination.upsert({
      where: {
        leagueId_weekId_nominatingTeamId: {
          leagueId,
          weekId,
          nominatingTeamId: teamId,
        },
      },
      update: {
        fantasyPlayerId: player.id,
      },
      create: {
        leagueId,
        weekId,
        nominatingTeamId: teamId,
        fantasyPlayerId: player.id,
      },
    });
  });
}

export async function submitWaiverClaims(
  leagueId: string,
  teamId: string,
  claims: Array<{ addFantasyPlayerId: string; bidAmount: number; targetRosterSlotId: string }>,
): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, timezone: true },
  });

  if (!league) {
    throw new ApiError(404, "League not found");
  }

  const waiverPeriod = await getWaiverPeriodForLeague(leagueId);
  assertWaiverPeriod(waiverPeriod);

  if (waiverPeriod.index === 1) {
    throw new ApiError(403, "January waivers are skipped");
  }

  if (!isWaiverClaimsWindowOpenForPeriod(waiverPeriod.startAt, league.timezone)) {
    throw new ApiError(403, "Waiver claim submission window is closed");
  }

  const weekId = await getWaiverPeriodIdOrThrow(leagueId);

  await prisma.$transaction(async (tx) => {
    const [team, nominationPool, teamSlots] = await Promise.all([
      tx.team.findFirst({
        where: { id: teamId, leagueId },
        select: { id: true, waiverBudget: true },
      }),
      tx.waiverNomination.findMany({
        where: { leagueId, weekId },
        include: {
          fantasyPlayer: {
            select: {
              id: true,
              role: true,
            },
          },
        },
      }),
      tx.rosterSlot.findMany({
        where: { teamId },
        select: {
          id: true,
          role: true,
        },
      }),
    ]);

    if (!team) {
      throw new ApiError(400, "Invalid team for league");
    }

    const nominationPoolByPlayerId = new Map(
      nominationPool.map((row) => [row.fantasyPlayerId, row.fantasyPlayer]),
    );
    const teamSlotsById = new Map(teamSlots.map((slot) => [slot.id, slot]));
    const seenPlayerIds = new Set<string>();

    for (const claim of claims) {
      const poolPlayer = nominationPoolByPlayerId.get(claim.addFantasyPlayerId);
      if (!poolPlayer) {
        throw new ApiError(400, "Claims must target players in this month's waiver pool");
      }

      if (seenPlayerIds.has(claim.addFantasyPlayerId)) {
        throw new ApiError(400, "Submit only one claim per waiver player");
      }
      seenPlayerIds.add(claim.addFantasyPlayerId);

      if (!Number.isInteger(claim.bidAmount) || claim.bidAmount < 1 || claim.bidAmount > team.waiverBudget) {
        throw new ApiError(400, `Bid must be between $1 and $${team.waiverBudget}`);
      }

      const targetSlot = teamSlotsById.get(claim.targetRosterSlotId);
      if (!targetSlot) {
        throw new ApiError(400, "Select a valid roster slot");
      }

      if (targetSlot.role !== "BENCH" && targetSlot.role !== poolPlayer.role) {
        throw new ApiError(400, "Selected slot does not fit that player");
      }
    }

    await tx.waiverClaim.deleteMany({
      where: {
        leagueId,
        weekId,
        teamId,
        status: "PENDING",
      },
    });

    for (let i = 0; i < claims.length; i += 1) {
      await tx.waiverClaim.create({
        data: {
          leagueId,
          weekId,
          teamId,
          priorityIndex: i,
          bidAmount: claims[i].bidAmount,
          addFantasyPlayerId: claims[i].addFantasyPlayerId,
          targetRosterSlotId: claims[i].targetRosterSlotId,
          dropRosterSlotId: null,
          status: "PENDING",
        },
      });
    }
  });
}

export async function publishWaiverNominationPool(
  leagueId: string,
  weekId: string,
): Promise<{
  publishedAt: string;
  nominations: Array<{ teamName: string; playerName: string; role: string }>;
}> {
  const nominations = await prisma.waiverNomination.findMany({
    where: { leagueId, weekId },
    include: {
      nominatingTeam: true,
      fantasyPlayer: { include: { person: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return {
    publishedAt: DateTime.utc().toISO() ?? new Date().toISOString(),
    nominations: nominations.map((nomination) => ({
      teamName: nomination.nominatingTeam.name,
      playerName: nomination.fantasyPlayer.person.name,
      role: nomination.fantasyPlayer.role,
    })),
  };
}

export async function processWaivers(leagueId: string, weekId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [claims, nominationPool, teams] = await Promise.all([
      tx.waiverClaim.findMany({
        where: { leagueId, weekId, status: "PENDING" },
        orderBy: [{ priorityIndex: "asc" }, { createdAt: "asc" }],
      }),
      tx.waiverNomination.findMany({
        where: { leagueId, weekId },
        select: { fantasyPlayerId: true },
      }),
      tx.team.findMany({
        where: { leagueId },
        select: {
          id: true,
          waiverBudget: true,
          recordWins: true,
          recordLosses: true,
          recordTies: true,
        },
      }),
    ]);

    const nominatedPlayerIds = new Set(nominationPool.map((row) => row.fantasyPlayerId));
    const remainingBudgetByTeamId = new Map(teams.map((team) => [team.id, team.waiverBudget]));
    const teamById = new Map(teams.map((team) => [team.id, team]));
    const claimsByTeamId = new Map<string, typeof claims>();

    for (const claim of claims) {
      if (!claimsByTeamId.has(claim.teamId)) {
        claimsByTeamId.set(claim.teamId, []);
      }
      claimsByTeamId.get(claim.teamId)?.push(claim);
    }

    async function resolveClaimStatus(claimId: string, status: "INVALID" | "LOST" | "WON") {
      await tx.waiverClaim.update({
        where: { id: claimId },
        data: {
          status,
          resolvedAt: new Date(),
        },
      });
    }

    async function validateClaim(claim: (typeof claims)[number]): Promise<"READY" | "INVALID" | "LOST"> {
      if (!nominatedPlayerIds.has(claim.addFantasyPlayerId)) {
        return "INVALID";
      }

      const remainingBudget = remainingBudgetByTeamId.get(claim.teamId) ?? 0;
      if (!claim.targetRosterSlotId || claim.bidAmount < 1 || claim.bidAmount > remainingBudget) {
        return "INVALID";
      }

      const [targetPlayerOwned, addPlayer, targetSlot] = await Promise.all([
        tx.rosterSlot.findFirst({
          where: {
            team: { leagueId },
            fantasyPlayerId: claim.addFantasyPlayerId,
          },
          select: { teamId: true },
        }),
        tx.fantasyPlayer.findUnique({
          where: { id: claim.addFantasyPlayerId },
          select: { id: true, role: true },
        }),
        claim.targetRosterSlotId
          ? tx.rosterSlot.findFirst({
              where: {
                id: claim.targetRosterSlotId,
                teamId: claim.teamId,
              },
              select: {
                id: true,
                role: true,
                fantasyPlayerId: true,
              },
            })
          : Promise.resolve(null),
      ]);

      if (!addPlayer || !isActiveFantasyRole(addPlayer.role)) {
        return "INVALID";
      }

      if (targetPlayerOwned) {
        return "LOST";
      }

      if (!targetSlot) {
        return "INVALID";
      }

      if (targetSlot.role !== "BENCH" && targetSlot.role !== addPlayer.role) {
        return "INVALID";
      }

      if (targetSlot.fantasyPlayerId === claim.addFantasyPlayerId) {
        return "INVALID";
      }

      return "READY";
    }

    while (true) {
      let progressed = false;
      const roundClaims: typeof claims = [];

      for (const [teamId, queue] of claimsByTeamId.entries()) {
        while (queue.length > 0) {
          const claim = queue[0];
          const validation = await validateClaim(claim);
          if (validation === "READY") {
            roundClaims.push(claim);
            break;
          }

          await resolveClaimStatus(claim.id, validation);
          queue.shift();
          progressed = true;
        }

        if (queue.length === 0) {
          claimsByTeamId.delete(teamId);
        }
      }

      if (roundClaims.length === 0) {
        if (!progressed) {
          break;
        }
        continue;
      }

      const claimsByPlayerId = new Map<string, typeof claims>();
      for (const claim of roundClaims) {
        if (!claimsByPlayerId.has(claim.addFantasyPlayerId)) {
          claimsByPlayerId.set(claim.addFantasyPlayerId, []);
        }
        claimsByPlayerId.get(claim.addFantasyPlayerId)?.push(claim);
      }

      for (const playerClaims of claimsByPlayerId.values()) {
        const winner = pickWinningFaabClaim(
          playerClaims.map((claim) => {
            const team = teamById.get(claim.teamId);

            return {
              ...claim,
              recordWins: team?.recordWins ?? 0,
              recordLosses: team?.recordLosses ?? 0,
              recordTies: team?.recordTies ?? 0,
            };
          }),
        );
        if (!winner) {
          continue;
        }

        const targetSlot = winner.targetRosterSlotId
          ? await tx.rosterSlot.findFirst({
              where: {
                id: winner.targetRosterSlotId,
                teamId: winner.teamId,
              },
              select: {
                id: true,
                fantasyPlayerId: true,
              },
            })
          : null;

        if (!targetSlot) {
          await resolveClaimStatus(winner.id, "INVALID");
        } else {
          const droppedFantasyPlayerId = targetSlot.fantasyPlayerId ?? null;

          await tx.rosterSlot.update({
            where: { id: targetSlot.id },
            data: {
              fantasyPlayerId: winner.addFantasyPlayerId,
            },
          });

          await tx.team.update({
            where: { id: winner.teamId },
            data: {
              waiverBudget: {
                decrement: winner.bidAmount,
              },
            },
          });

          remainingBudgetByTeamId.set(
            winner.teamId,
            Math.max(0, (remainingBudgetByTeamId.get(winner.teamId) ?? 0) - winner.bidAmount),
          );

          await tx.transaction.create({
            data: {
              leagueId,
              weekId,
              type: "WAIVER_ADD",
              teamId: winner.teamId,
              fantasyPlayerId: winner.addFantasyPlayerId,
              rosterSlotId: targetSlot.id,
              meta: {
                claimId: winner.id,
                bidAmount: winner.bidAmount,
                targetRosterSlotId: targetSlot.id,
              },
            },
          });

          if (droppedFantasyPlayerId) {
            await tx.transaction.create({
              data: {
                leagueId,
                weekId,
                type: "WAIVER_DROP",
                teamId: winner.teamId,
                fantasyPlayerId: droppedFantasyPlayerId,
                rosterSlotId: targetSlot.id,
                meta: {
                  claimId: winner.id,
                  replacementFantasyPlayerId: winner.addFantasyPlayerId,
                },
              },
            });
          }

          await resolveClaimStatus(winner.id, "WON");
        }

        for (const claim of playerClaims) {
          const queue = claimsByTeamId.get(claim.teamId);
          if (queue && queue[0]?.id === claim.id) {
            queue.shift();
            if (queue.length === 0) {
              claimsByTeamId.delete(claim.teamId);
            }
          } else if (queue) {
            const index = queue.findIndex((item) => item.id === claim.id);
            if (index >= 0) {
              queue.splice(index, 1);
            }
          }

          if (claim.id !== winner.id) {
            await resolveClaimStatus(claim.id, "LOST");
          }
        }

        progressed = true;
      }

      if (!progressed) {
        break;
      }
    }
  });
}

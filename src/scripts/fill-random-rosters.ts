import "dotenv/config";

import { FantasyRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ensureFantasyPlayerSeasonStats } from "@/server/services/fantasyPlayerSeasonStatsService";
import { refreshWeekScoring } from "@/server/services/scoringService";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { getPreviousSeasonPointsWindow } from "@/server/utils/previousSeasonWindow";

interface CandidatePlayer {
  id: string;
  role: FantasyRole;
  personId: string;
  personName: string;
  previousSeasonPoints: number;
  currentSeasonReleasedCredit: boolean;
}

function parseLeagueId(argv: string[]): string | null {
  const argument = argv.find((value) => value.startsWith("--leagueId="));
  return argument ? argument.split("=")[1] ?? null : null;
}

function shuffle<T>(items: T[]): T[] {
  const clone = [...items];
  for (let idx = clone.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    [clone[idx], clone[swapIdx]] = [clone[swapIdx] as T, clone[idx] as T];
  }
  return clone;
}

function sortCandidates(candidates: CandidatePlayer[]): CandidatePlayer[] {
  const grouped = new Map<string, CandidatePlayer[]>();

  for (const candidate of candidates) {
    const tier = candidate.currentSeasonReleasedCredit
      ? "released"
      : candidate.previousSeasonPoints > 0
        ? "priorPoints"
        : "fallback";
    const existing = grouped.get(tier) ?? [];
    existing.push(candidate);
    grouped.set(tier, existing);
  }

  const ordered: CandidatePlayer[] = [];
  for (const tier of ["released", "priorPoints", "fallback"]) {
    const shuffled = shuffle(grouped.get(tier) ?? []);
    shuffled.sort((a, b) => b.previousSeasonPoints - a.previousSeasonPoints || a.personName.localeCompare(b.personName));
    ordered.push(...shuffled);
  }

  return ordered;
}

async function refreshVisibleMonthScoring(leagueId: string, now: Date) {
  const weeks = await prisma.week.findMany({
    where: {
      leagueId,
      startAt: {
        lte: now,
      },
    },
    orderBy: { index: "asc" },
    select: {
      id: true,
      index: true,
      endAt: true,
    },
  });

  if (weeks.length === 0) {
    return { refreshedWeeks: 0 };
  }

  await prisma.fantasyPlayerWeekScore.deleteMany({
    where: {
      leagueId,
      weekId: {
        in: weeks.map((week) => week.id),
      },
    },
  });

  for (const week of weeks) {
    const asOf = week.endAt.getTime() < now.getTime() ? week.endAt : now;
    console.log(`[seed:random-rosters] Recomputing month ${week.index} scoring`);
    await refreshWeekScoring(leagueId, week.id, asOf);
  }

  return { refreshedWeeks: weeks.length };
}

async function main() {
  const leagueId = parseLeagueId(process.argv.slice(2));
  const now = new Date();

  const league = leagueId
    ? await prisma.league.findUnique({
        where: { id: leagueId },
        include: {
          teams: {
            orderBy: { name: "asc" },
            include: {
              rosterSlots: {
                orderBy: [{ role: "asc" }, { slotIndex: "asc" }],
              },
            },
          },
        },
      })
    : await prisma.league.findFirst({
        orderBy: { createdAt: "asc" },
        include: {
          teams: {
            orderBy: { name: "asc" },
            include: {
              rosterSlots: {
                orderBy: [{ role: "asc" }, { slotIndex: "asc" }],
              },
            },
          },
        },
      });

  if (!league) {
    throw new Error(leagueId ? `League ${leagueId} not found` : "No leagues found");
  }

  const { previousSeasonYear, startAt, cutoffAt } = getPreviousSeasonPointsWindow(league.seasonYear);

  const players = await prisma.fantasyPlayer.findMany({
    where: {
      role: { in: ACTIVE_FANTASY_ROLES_LIST },
      person: {
        credits: {
          some: {
            movie: {
              eligibleLeagues: {
                some: {
                  leagueId: league.id,
                },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      role: true,
      personId: true,
      person: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { person: { name: "asc" } }],
  });

  if (players.length === 0) {
    throw new Error(`League ${league.name} has no eligible fantasy players to roster`);
  }

  const previousSeasonPointsByFantasyPlayerId = await ensureFantasyPlayerSeasonStats({
    seasonYear: previousSeasonYear,
    startAt,
    cutoffAt,
    fantasyPlayers: players.map((player) => ({
      id: player.id,
      personId: player.personId,
      role: player.role,
    })),
  });

  const currentSeasonReleasedPersonIds = new Set(
    (
      await prisma.credit.findMany({
        where: {
          personId: {
            in: Array.from(new Set(players.map((player) => player.personId))),
          },
          movie: {
            eligibleLeagues: {
              some: { leagueId: league.id },
            },
            theatricalReleaseDate: {
              lte: now,
            },
          },
        },
        select: { personId: true },
        distinct: ["personId"],
      })
    ).map((credit) => credit.personId),
  );

  const candidatesByRole = new Map<FantasyRole, CandidatePlayer[]>();
  for (const role of ACTIVE_FANTASY_ROLES_LIST) {
    const roleCandidates = players
      .filter((player) => player.role === role)
      .map((player) => ({
        id: player.id,
        role: player.role,
        personId: player.personId,
        personName: player.person.name,
        previousSeasonPoints: previousSeasonPointsByFantasyPlayerId.get(player.id) ?? 0,
        currentSeasonReleasedCredit: currentSeasonReleasedPersonIds.has(player.personId),
      }));

    candidatesByRole.set(role, sortCandidates(roleCandidates));
  }

  const usedFantasyPlayerIds = new Set<string>();
  const assignments = new Map<string, string>();

  for (const team of league.teams) {
    const starterSlots = team.rosterSlots.filter((slot) => slot.role !== "BENCH");
    for (const slot of starterSlots) {
      const candidates = candidatesByRole.get(slot.role) ?? [];
      const next = candidates.find((candidate) => !usedFantasyPlayerIds.has(candidate.id));
      if (!next) {
        throw new Error(`Not enough eligible ${slot.role} players to fill ${team.name}`);
      }
      usedFantasyPlayerIds.add(next.id);
      assignments.set(slot.id, next.id);
    }
  }

  const benchPool = sortCandidates(
    players.map((player) => ({
      id: player.id,
      role: player.role,
      personId: player.personId,
      personName: player.person.name,
      previousSeasonPoints: previousSeasonPointsByFantasyPlayerId.get(player.id) ?? 0,
      currentSeasonReleasedCredit: currentSeasonReleasedPersonIds.has(player.personId),
    })),
  );

  for (const team of league.teams) {
    const benchSlots = team.rosterSlots.filter((slot) => slot.role === "BENCH");
    for (const slot of benchSlots) {
      const next = benchPool.find((candidate) => !usedFantasyPlayerIds.has(candidate.id));
      if (!next) {
        throw new Error(`Not enough eligible bench players to fill ${team.name}`);
      }
      usedFantasyPlayerIds.add(next.id);
      assignments.set(slot.id, next.id);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.rosterSlot.updateMany({
      where: {
        teamId: {
          in: league.teams.map((team) => team.id),
        },
      },
      data: {
        fantasyPlayerId: null,
      },
    });

    for (const [rosterSlotId, fantasyPlayerId] of assignments.entries()) {
      await tx.rosterSlot.update({
        where: { id: rosterSlotId },
        data: { fantasyPlayerId },
      });
    }
  });

  const scoringRefresh = await refreshVisibleMonthScoring(league.id, now);

  const scoredCandidateCount = players.filter((player) => currentSeasonReleasedPersonIds.has(player.personId)).length;
  const priorSeasonScorerCount = players.filter(
    (player) => (previousSeasonPointsByFantasyPlayerId.get(player.id) ?? 0) > 0,
  ).length;

  console.log(
    JSON.stringify(
      {
        leagueId: league.id,
        leagueName: league.name,
        teamCount: league.teams.length,
        rosterSlotsFilled: assignments.size,
        refreshedMonths: scoringRefresh.refreshedWeeks,
        seasonYear: league.seasonYear,
        currentSeasonReleasedPlayerCandidates: scoredCandidateCount,
        previousSeasonScorerCandidates: priorSeasonScorerCount,
        note:
          scoredCandidateCount === 0
            ? `No eligible ${league.seasonYear} players with released league movies were available, so rosters were filled from players with nonzero ${previousSeasonYear} points first.`
            : `Rosters were filled by preferring players tied to already released ${league.seasonYear} league movies, then nonzero ${previousSeasonYear} scorers.`,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

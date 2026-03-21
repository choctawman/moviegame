import { prisma } from "@/lib/prisma";
import { LEAGUE_TEAM_LIMIT } from "@/server/services/constants";

function deterministicSort(ids: string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export function buildRoundRobinWeekPairings(teamIds: string[], weekIndex: number): Array<[string, string]> {
  if (teamIds.length !== LEAGUE_TEAM_LIMIT || teamIds.length % 2 !== 0) {
    throw new Error(`Round-robin scheduler requires exactly ${LEAGUE_TEAM_LIMIT} teams`);
  }

  const rotation = deterministicSort(teamIds);
  const rounds: Array<Array<[string, string]>> = [];

  for (let roundIndex = 0; roundIndex < rotation.length - 1; roundIndex += 1) {
    const pairings: Array<[string, string]> = [];
    for (let pairIndex = 0; pairIndex < rotation.length / 2; pairIndex += 1) {
      const homeCandidate = rotation[pairIndex];
      const awayCandidate = rotation[rotation.length - 1 - pairIndex];
      pairings.push(roundIndex % 2 === 0 ? [homeCandidate, awayCandidate] : [awayCandidate, homeCandidate]);
    }
    rounds.push(pairings);

    rotation.splice(1, 0, rotation.pop() as string);
  }

  return rounds[(weekIndex - 1) % rounds.length] ?? [];
}

export async function generateSeasonSchedule(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      teams: { select: { id: true } },
      weeks: { orderBy: { index: "asc" } },
      matchups: true,
    },
  });

  if (!league) {
    throw new Error("League not found");
  }

  if (league.matchups.length > 0) {
    throw new Error("Schedule already exists");
  }

  if (league.teams.length !== LEAGUE_TEAM_LIMIT) {
    throw new Error(`League must have exactly ${LEAGUE_TEAM_LIMIT} teams`);
  }

  const teamIds = league.teams.map((team) => team.id);

  await prisma.$transaction(async (tx) => {
    for (const week of league.weeks) {
      const pairings = buildRoundRobinWeekPairings(teamIds, week.index);
      for (const [homeTeamId, awayTeamId] of pairings) {
        await tx.matchup.create({
          data: {
            leagueId,
            weekId: week.id,
            homeTeamId,
            awayTeamId,
          },
        });
      }
    }
  });
}

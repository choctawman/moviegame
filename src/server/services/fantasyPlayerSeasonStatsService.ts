import type { FantasyRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { roundHalfUp } from "@/server/utils/math";

interface FantasyPlayerSeasonStatInput {
  id: string;
  personId: string;
  role: FantasyRole;
}

interface EnsureFantasyPlayerSeasonStatsParams {
  seasonYear: number;
  startAt: Date;
  cutoffAt: Date;
  fantasyPlayers: FantasyPlayerSeasonStatInput[];
}

function personRoleKey(personId: string, role: FantasyRole): string {
  return `${personId}:${role}`;
}

function creditMatchesFantasyRole(
  role: FantasyRole,
  credit: { creditType: "CAST" | "CREW"; billingOrder: number | null; job: string | null },
): boolean {
  if (role === "LEADING_ACTOR" || role === "LEADING_ACTRESS") {
    return credit.creditType === "CAST" && credit.billingOrder != null && credit.billingOrder <= 1;
  }
  if (role === "SUPPORTING") {
    return credit.creditType === "CAST" && credit.billingOrder != null && credit.billingOrder >= 2;
  }
  if (role === "DIRECTOR") {
    return credit.creditType === "CREW" && credit.job === "Director";
  }
  return false;
}

function moviePoints(stat?: {
  worldwideGrossUsd: bigint;
  rtCriticsScore: number | null;
  rtAudienceScore: number | null;
}): { boxPoints: number; rtPoints: number; totalPoints: number } {
  if (!stat) {
    return { boxPoints: 0, rtPoints: 0, totalPoints: 0 };
  }

  const boxPoints = roundHalfUp(Number(stat.worldwideGrossUsd) / 1_000_000, 2);
  const rtPoints = (stat.rtCriticsScore ?? 0) + (stat.rtAudienceScore ?? 0);
  return {
    boxPoints,
    rtPoints,
    totalPoints: roundHalfUp(boxPoints + rtPoints, 2),
  };
}

export async function ensureFantasyPlayerSeasonStats({
  seasonYear,
  startAt,
  cutoffAt,
  fantasyPlayers,
}: EnsureFantasyPlayerSeasonStatsParams): Promise<Map<string, number>> {
  if (fantasyPlayers.length === 0) {
    return new Map();
  }

  const uniquePlayers = Array.from(new Map(fantasyPlayers.map((player) => [player.id, player])).values());
  const fantasyPlayerIds = uniquePlayers.map((player) => player.id);

  const existingRows = await prisma.fantasyPlayerSeasonStat.findMany({
    where: {
      seasonYear,
      fantasyPlayerId: { in: fantasyPlayerIds },
    },
    select: {
      fantasyPlayerId: true,
      pointsTotal: true,
    },
  });

  const pointsByFantasyPlayerId = new Map<string, number>(
    existingRows.map((row) => [row.fantasyPlayerId, Number(row.pointsTotal)]),
  );

  const missingPlayers = uniquePlayers.filter((player) => !pointsByFantasyPlayerId.has(player.id));
  if (missingPlayers.length === 0) {
    return pointsByFantasyPlayerId;
  }

  const fantasyPlayerIdByPersonRole = new Map<string, string>();
  for (const player of missingPlayers) {
    fantasyPlayerIdByPersonRole.set(personRoleKey(player.personId, player.role), player.id);
  }

  const personIds = Array.from(new Set(missingPlayers.map((player) => player.personId)));

  const previousSeasonCredits = personIds.length
    ? await prisma.credit.findMany({
        where: {
          personId: { in: personIds },
          movie: {
            theatricalReleaseDate: {
              gte: startAt,
              lte: cutoffAt,
            },
          },
        },
        select: {
          personId: true,
          movieId: true,
          creditType: true,
          billingOrder: true,
          job: true,
        },
      })
    : [];

  const seasonMovieIds = Array.from(new Set(previousSeasonCredits.map((credit) => credit.movieId)));
  const seasonMovieStats = seasonMovieIds.length
    ? await prisma.movieSeasonStat.findMany({
        where: {
          seasonYear,
          movieId: { in: seasonMovieIds },
        },
        select: {
          movieId: true,
          worldwideGrossUsd: true,
          rtCriticsScore: true,
          rtAudienceScore: true,
        },
      })
    : [];

  const pointsByMovieId = new Map(seasonMovieStats.map((stat) => [stat.movieId, moviePoints(stat)]));
  const movieIdsByFantasyPlayerId = new Map<string, Set<string>>();

  for (const credit of previousSeasonCredits) {
    for (const role of ACTIVE_FANTASY_ROLES_LIST) {
      if (!creditMatchesFantasyRole(role, credit)) {
        continue;
      }

      const fantasyPlayerId = fantasyPlayerIdByPersonRole.get(personRoleKey(credit.personId, role));
      if (!fantasyPlayerId) {
        continue;
      }

      const movieIds = movieIdsByFantasyPlayerId.get(fantasyPlayerId) ?? new Set<string>();
      movieIds.add(credit.movieId);
      movieIdsByFantasyPlayerId.set(fantasyPlayerId, movieIds);
    }
  }

  const now = new Date();
  const insertRows = missingPlayers.map((player) => {
    const movieIds = movieIdsByFantasyPlayerId.get(player.id) ?? new Set<string>();
    let pointsTotal = 0;
    let pointsBoxOffice = 0;
    let pointsRt = 0;

    for (const movieId of movieIds) {
      const movie = pointsByMovieId.get(movieId);
      if (!movie) {
        continue;
      }
      pointsBoxOffice = roundHalfUp(pointsBoxOffice + movie.boxPoints, 2);
      pointsRt += movie.rtPoints;
      pointsTotal = roundHalfUp(pointsTotal + movie.totalPoints, 2);
    }

    pointsByFantasyPlayerId.set(player.id, pointsTotal);

    return {
      fantasyPlayerId: player.id,
      seasonYear,
      pointsTotal,
      pointsBoxOffice,
      pointsRt,
      sourceMovieCount: movieIds.size,
      snapshotAt: now,
    };
  });

  if (insertRows.length > 0) {
    await prisma.fantasyPlayerSeasonStat.createMany({
      data: insertRows,
      skipDuplicates: true,
    });
  }

  return pointsByFantasyPlayerId;
}

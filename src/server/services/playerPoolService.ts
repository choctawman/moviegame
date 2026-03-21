import type { FantasyRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ACTIVE_FANTASY_ROLES_LIST, isActiveFantasyRole } from "@/server/services/constants";

interface PlayerPoolFilters {
  leagueId: string;
  role?: FantasyRole;
  q?: string;
  availableOnly?: boolean;
}

export async function getLeaguePlayerPool(filters: PlayerPoolFilters) {
  const league = await prisma.league.findUnique({
    where: { id: filters.leagueId },
    select: { id: true },
  });

  if (!league) {
    return [];
  }

  const rosteredSlots = await prisma.rosterSlot.findMany({
    where: {
      team: {
        leagueId: filters.leagueId,
      },
      fantasyPlayerId: { not: null },
    },
    select: {
      fantasyPlayerId: true,
    },
  });

  const rosteredSet = new Set(rosteredSlots.map((slot) => slot.fantasyPlayerId).filter(Boolean) as string[]);

  const roleFilter = filters.role && isActiveFantasyRole(filters.role) ? filters.role : undefined;

  const players = await prisma.fantasyPlayer.findMany({
    where: {
      role: roleFilter ?? { in: ACTIVE_FANTASY_ROLES_LIST },
      person: {
        credits: {
          some: {
            movie: {
              eligibleLeagues: {
                some: {
                  leagueId: filters.leagueId,
                },
              },
            },
          },
        },
        ...(filters.q
          ? {
              name: {
                contains: filters.q,
                mode: "insensitive",
              },
            }
          : {}),
      },
    },
    include: {
      person: true,
    },
    orderBy: [{ role: "asc" }, { person: { name: "asc" } }],
    take: 1000,
  });

  return players
    .filter((player) => !filters.availableOnly || !rosteredSet.has(player.id))
    .map((player) => ({
      ...player,
      isAvailable: !rosteredSet.has(player.id),
    }));
}

export async function getFantasyPlayerDetail(id: string, leagueId?: string) {
  const player = await prisma.fantasyPlayer.findUnique({
    where: { id },
    include: {
      person: {
        include: {
          credits: {
            where: leagueId
              ? {
                  movie: {
                    eligibleLeagues: {
                      some: {
                        leagueId,
                      },
                    },
                  },
                }
              : undefined,
            orderBy: [{ movie: { theatricalReleaseDate: "asc" } }, { id: "asc" }],
            include: {
              movie: true,
            },
          },
        },
      },
      playerWeekScores: {
        include: {
          week: true,
        },
        orderBy: {
          week: {
            index: "desc",
          },
        },
        take: 20,
      },
    },
  });

  if (!player || !isActiveFantasyRole(player.role)) {
    return null;
  }

  return player;
}

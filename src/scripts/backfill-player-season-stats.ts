import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { ensureFantasyPlayerSeasonStats } from "@/server/services/fantasyPlayerSeasonStatsService";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { getPreviousSeasonPointsWindow } from "@/server/utils/previousSeasonWindow";

async function main() {
  const leagues = await prisma.league.findMany({
    select: { id: true, seasonYear: true },
    orderBy: { createdAt: "asc" },
  });

  if (leagues.length === 0) {
    console.log("[player-season-stats] No leagues found.");
    return;
  }

  let totalPlayers = 0;
  for (const league of leagues) {
    const window = getPreviousSeasonPointsWindow(league.seasonYear);
    const fantasyPlayers = await prisma.fantasyPlayer.findMany({
      where: {
        role: { in: ACTIVE_FANTASY_ROLES_LIST },
        person: {
          credits: {
            some: {
              movie: {
                eligibleLeagues: {
                  some: { leagueId: league.id },
                },
              },
            },
          },
        },
      },
      select: {
        id: true,
        personId: true,
        role: true,
      },
    });

    const results = await ensureFantasyPlayerSeasonStats({
      seasonYear: window.previousSeasonYear,
      startAt: window.startAt,
      cutoffAt: window.cutoffAt,
      fantasyPlayers,
    });

    totalPlayers += results.size;
    console.log(
      `[player-season-stats] League ${league.id}: season=${window.previousSeasonYear}, players=${fantasyPlayers.length}, ensured=${results.size}`,
    );
  }

  console.log(`[player-season-stats] Done. leagues=${leagues.length}, ensured=${totalPlayers}`);
}

main()
  .catch((error) => {
    console.error("[player-season-stats] Failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

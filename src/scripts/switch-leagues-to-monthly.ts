import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { LEAGUE_TEAM_LIMIT } from "@/server/services/constants";
import { generateSeasonSchedule } from "@/server/services/scheduleService";
import { generateLeagueWeeks } from "@/server/services/weekService";

async function main() {
  const leagues = await prisma.league.findMany({
    include: {
      teams: {
        select: { id: true },
      },
      weeks: {
        select: { id: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const league of leagues) {
    await prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({
        where: { leagueId: league.id },
      });

      await tx.week.deleteMany({
        where: { leagueId: league.id },
      });

      await tx.team.updateMany({
        where: { leagueId: league.id },
        data: {
          recordWins: 0,
          recordLosses: 0,
          recordTies: 0,
        },
      });
    });

    await generateLeagueWeeks(league.id, league.seasonYear, league.timezone);

    if (league.teams.length === LEAGUE_TEAM_LIMIT) {
      await generateSeasonSchedule(league.id);
    }

    console.log(
      `Converted ${league.name} (${league.id}) from ${league.weeks.length} weekly periods to monthly periods.`,
    );
  }

  console.log(`Processed ${leagues.length} league(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

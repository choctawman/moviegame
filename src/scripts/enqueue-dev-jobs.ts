import "dotenv/config";

import { DateTime } from "luxon";

import { prisma } from "@/lib/prisma";
import { draftQueue, ingestionQueue, scoringQueue, waiverQueue } from "@/server/queues";
import { getCurrentWeekForLeague } from "@/server/services/leagueQueryService";

async function main() {
  const leagues = await prisma.league.findMany({ select: { id: true } });

  for (const league of leagues) {
    await ingestionQueue.add("ingest-season", { leagueId: league.id });
    await ingestionQueue.add("ingest-daily-stats", { leagueId: league.id });

    const week = await getCurrentWeekForLeague(league.id);
    if (week) {
      await scoringQueue.add("finalize-week", { leagueId: league.id, weekId: week.id });

      const now = DateTime.now();
      await waiverQueue.add(
        "process-waivers",
        { leagueId: league.id, weekId: week.id },
        {
          delay: 1000,
          jobId: `manual-waivers-${league.id}-${now.toISODate()}`,
        },
      );
    }

    await draftQueue.add("autopick", { leagueId: league.id }, { delay: 1000 });
  }

  console.log(`Queued jobs for ${leagues.length} league(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

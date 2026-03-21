import { prisma } from "@/lib/prisma";
import { buildSeasonWeeks } from "@/server/utils/time";

export async function generateLeagueWeeks(leagueId: string, seasonYear: number, timezone: string): Promise<void> {
  const weeks = buildSeasonWeeks(seasonYear, timezone);

  await prisma.week.createMany({
    data: weeks.map((week) => ({
      leagueId,
      index: week.index,
      startAt: week.startAt,
      endAt: week.endAt,
    })),
    skipDuplicates: true,
  });
}

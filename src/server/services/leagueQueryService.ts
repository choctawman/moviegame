import { DateTime } from "luxon";

import { prisma } from "@/lib/prisma";
import { findCurrentWeek, resolveMonthlyCycleTimes } from "@/server/utils/time";

async function getLeagueWithWeeks(leagueId: string) {
  return prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      weeks: {
        orderBy: { index: "asc" },
      },
    },
  });
}

export async function getCurrentWeekForLeague(leagueId: string) {
  const league = await getLeagueWithWeeks(leagueId);
  if (!league) {
    return null;
  }

  return findCurrentWeek(league.weeks, league.timezone) ?? null;
}

export async function getWaiverPeriodForLeague(leagueId: string, nowInput?: Date) {
  const league = await getLeagueWithWeeks(leagueId);
  if (!league) {
    return null;
  }

  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).setZone(league.timezone);
  const currentPeriod = findCurrentWeek(league.weeks, league.timezone, now);
  if (!currentPeriod) {
    return null;
  }

  const currentIndex = league.weeks.findIndex((week) => week.id === currentPeriod.id);
  const nextPeriod = currentIndex >= 0 ? league.weeks[currentIndex + 1] ?? null : null;
  const currentCycle = resolveMonthlyCycleTimes(currentPeriod.startAt, league.timezone);

  if (currentPeriod.index !== 1) {
    const waiverProcessAt = currentCycle.waiverProcessAt ? DateTime.fromJSDate(currentCycle.waiverProcessAt).toUTC() : null;
    if (waiverProcessAt && now.toUTC() < waiverProcessAt) {
      return currentPeriod;
    }
  }

  if (nextPeriod) {
    return nextPeriod;
  }

  return currentPeriod;
}

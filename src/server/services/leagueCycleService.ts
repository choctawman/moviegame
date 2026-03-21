import { LeagueEventType, Prisma } from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "@/lib/prisma";
import { captureWeekOpeningBoxOfficeSnapshots, finalizeWeekScoring } from "@/server/services/scoringService";
import { enqueueDailyStatsIngestion } from "@/server/services/ingestionService";
import { createLeagueNotification } from "@/server/services/notificationService";
import { publishWaiverNominationPool, processWaivers } from "@/server/services/waiverService";
import { decimalToNumber, roundHalfUp } from "@/server/utils/math";
import { findCurrentWeek, formatMonthLabel, resolveMonthlyCycleTimes } from "@/server/utils/time";

type MatchupSummaryLineItem = {
  homeTeamName: string;
  awayTeamName: string;
  homeScoreTotal: number;
  awayScoreTotal: number;
  homeRtAvg: number;
  awayRtAvg: number;
  result: "HOME_WIN" | "AWAY_WIN" | "TIE" | null;
};

type MatchupSummaryPlayerItem = {
  playerName: string;
  teamName: string;
  totalPoints: number;
};

type MatchupSummaryTeamItem = {
  teamName: string;
  totalPoints: number;
};

function formatScore(value: number): string {
  return value.toFixed(2);
}

function formatPlayerStat(item: MatchupSummaryPlayerItem): string {
  return `${item.playerName} (${item.teamName}, ${formatScore(item.totalPoints)})`;
}

function buildMatchupResultLine(matchup: MatchupSummaryLineItem): string {
  const homeScore = formatScore(matchup.homeScoreTotal);
  const awayScore = formatScore(matchup.awayScoreTotal);
  const tiedOnPoints = matchup.homeScoreTotal === matchup.awayScoreTotal;

  if (matchup.result == null) {
    return `${matchup.homeTeamName} vs ${matchup.awayTeamName} ${homeScore}-${awayScore}.`;
  }

  if (matchup.result === "TIE") {
    return `${matchup.homeTeamName} tied ${matchup.awayTeamName} ${homeScore}-${awayScore}.`;
  }

  const homeWon = matchup.result === "HOME_WIN";
  const winner = homeWon ? matchup.homeTeamName : matchup.awayTeamName;
  const loser = homeWon ? matchup.awayTeamName : matchup.homeTeamName;
  const winnerScore = homeWon ? homeScore : awayScore;
  const loserScore = homeWon ? awayScore : homeScore;
  const decidedByRt = tiedOnPoints && matchup.homeRtAvg !== matchup.awayRtAvg;

  if (decidedByRt) {
    return `${winner} beat ${loser} ${winnerScore}-${loserScore} on RT tiebreak.`;
  }

  return `${winner} beat ${loser} ${winnerScore}-${loserScore}.`;
}

export function buildMatchupSummaryBody(input: {
  matchups: MatchupSummaryLineItem[];
  playerPerformances: MatchupSummaryPlayerItem[];
  teamPerformances: MatchupSummaryTeamItem[];
}): string {
  const lines: string[] = [];

  if (input.matchups.length === 0) {
    lines.push("No matchups finalized.");
  } else {
    lines.push("Results:");
    lines.push(...input.matchups.map(buildMatchupResultLine));
  }

  const topTeam = [...input.teamPerformances].sort((a, b) => b.totalPoints - a.totalPoints || a.teamName.localeCompare(b.teamName))[0];
  if (topTeam) {
    lines.push(`Highest team score: ${topTeam.teamName} with ${formatScore(topTeam.totalPoints)}.`);
  }

  const sortedPlayersDesc = [...input.playerPerformances].sort(
    (a, b) => b.totalPoints - a.totalPoints || a.playerName.localeCompare(b.playerName),
  );
  const sortedPlayersAsc = [...input.playerPerformances].sort(
    (a, b) => a.totalPoints - b.totalPoints || a.playerName.localeCompare(b.playerName),
  );

  if (sortedPlayersDesc.length === 1) {
    lines.push(`Only scoring player: ${formatPlayerStat(sortedPlayersDesc[0])}.`);
  } else if (sortedPlayersDesc.length > 0) {
    if (sortedPlayersDesc.length <= 4) {
      lines.push(`Highest player: ${formatPlayerStat(sortedPlayersDesc[0])}.`);
      lines.push(`Lowest player: ${formatPlayerStat(sortedPlayersAsc[0])}.`);
    } else {
      const topScorers = sortedPlayersDesc.slice(0, 3).map(formatPlayerStat).join("; ");
      const seen = new Set(sortedPlayersDesc.slice(0, 3).map((item) => `${item.playerName}:${item.teamName}`));
      const lowestScorers = sortedPlayersAsc
        .filter((item) => !seen.has(`${item.playerName}:${item.teamName}`))
        .slice(0, 3)
        .map(formatPlayerStat)
        .join("; ");

      lines.push(`Top scorers: ${topScorers}.`);
      if (lowestScorers.length > 0) {
        lines.push(`Lowest scorers: ${lowestScorers}.`);
      }
    }
  }

  return lines.join("\n");
}

async function claimEventRun(
  leagueId: string,
  weekId: string,
  eventType: LeagueEventType,
): Promise<boolean> {
  try {
    await prisma.leagueEventRun.create({
      data: {
        leagueId,
        weekId,
        eventType,
      },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

async function releaseEventRun(leagueId: string, weekId: string, eventType: LeagueEventType): Promise<void> {
  await prisma.leagueEventRun.deleteMany({
    where: {
      leagueId,
      weekId,
      eventType,
    },
  });
}

async function notifyNominationPool(leagueId: string, weekId: string, monthLabel: string): Promise<void> {
  const published = await publishWaiverNominationPool(leagueId, weekId);
  const lines =
    published.nominations.length === 0
      ? "No players were nominated for this monthly waiver pool."
      : published.nominations
          .slice(0, 15)
          .map((item) => `${item.playerName} (${item.role}) by ${item.teamName}`)
          .join("; ");

  await createLeagueNotification(
    leagueId,
    "WAIVER_POOL_PUBLISHED",
    `${monthLabel} Waiver Pool Published`,
    lines,
    {
      weekId,
      publishedAt: published.publishedAt,
      nominationCount: published.nominations.length,
    },
  );
}

async function notifyWaiverResults(leagueId: string, weekId: string, monthLabel: string): Promise<void> {
  const winningClaims = await prisma.waiverClaim.findMany({
    where: {
      leagueId,
      weekId,
      status: "WON",
    },
    include: {
      team: true,
      addFantasyPlayer: { include: { person: true } },
    },
    orderBy: [{ resolvedAt: "asc" }],
  });

  const body =
    winningClaims.length === 0
      ? "No waiver claims were awarded this month."
      : winningClaims
          .slice(0, 20)
          .map((claim) => `${claim.team.name} added ${claim.addFantasyPlayer.person.name}`)
          .join("; ");

  await createLeagueNotification(leagueId, "WAIVERS_PROCESSED", `${monthLabel} Waivers Processed`, body, {
    weekId,
    winners: winningClaims.map((claim) => ({
      teamId: claim.teamId,
      teamName: claim.team.name,
      fantasyPlayerId: claim.addFantasyPlayerId,
      playerName: claim.addFantasyPlayer.person.name,
    })),
  });
}

async function notifyMatchupSummary(leagueId: string, weekId: string, monthLabel: string): Promise<void> {
  const [week, standings, teamScores, playerScores] = await Promise.all([
    prisma.week.findUnique({
      where: { id: weekId },
      include: {
        matchups: {
          include: {
            homeTeam: true,
            awayTeam: true,
          },
          orderBy: { id: "asc" },
        },
      },
    }),
    prisma.team.findMany({
      where: { leagueId },
      orderBy: [{ recordWins: "desc" }, { recordLosses: "asc" }, { recordTies: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        recordWins: true,
        recordLosses: true,
        recordTies: true,
      },
    }),
    prisma.teamWeekScore.findMany({
      where: { leagueId, weekId },
      include: {
        team: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.fantasyPlayerWeekScore.findMany({
      where: { leagueId, weekId },
      include: {
        fantasyPlayer: {
          include: {
            person: {
              select: {
                name: true,
              },
            },
            rosterSlots: {
              where: {
                team: {
                  leagueId,
                },
              },
              include: {
                team: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  if (!week) {
    return;
  }

  const body = buildMatchupSummaryBody({
    matchups: week.matchups.map((matchup) => ({
      homeTeamName: matchup.homeTeam.name,
      awayTeamName: matchup.awayTeam.name,
      homeScoreTotal: decimalToNumber(matchup.homeScoreTotal),
      awayScoreTotal: decimalToNumber(matchup.awayScoreTotal),
      homeRtAvg: decimalToNumber(matchup.homeRtAvg),
      awayRtAvg: decimalToNumber(matchup.awayRtAvg),
      result: matchup.result,
    })),
    teamPerformances: teamScores.map((score) => ({
      teamName: score.team.name,
      totalPoints: decimalToNumber(score.pointsTotal),
    })),
    playerPerformances: playerScores
      .map((score) => {
        const rosterSlot = score.fantasyPlayer.rosterSlots[0];
        if (!rosterSlot) {
          return null;
        }

        return {
          playerName: score.fantasyPlayer.person.name,
          teamName: rosterSlot.team.name,
          totalPoints: roundHalfUp(decimalToNumber(score.pointsBoxOffice) + score.pointsRt, 2),
        };
      })
      .filter((item): item is MatchupSummaryPlayerItem => item != null),
  });

  await createLeagueNotification(
    leagueId,
    "MATCHUP_SUMMARY",
    `${monthLabel} Matchup Summary`,
    body,
    {
      weekId,
      weekIndex: week.index,
      standings,
    },
  );
}

async function maybePublishNominationPool(league: {
  id: string;
  timezone: string;
  weeks: Array<{ id: string; index: number; startAt: Date; endAt: Date }>;
}, nowInput?: Date): Promise<void> {
  const currentPeriod = findCurrentWeek(league.weeks, league.timezone, (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).setZone(league.timezone));
  if (!currentPeriod || currentPeriod.index === 1) {
    return;
  }

  const cycle = resolveMonthlyCycleTimes(currentPeriod.startAt, league.timezone);
  const nowUtc = DateTime.fromJSDate(nowInput ?? new Date()).toUTC();
  const publishAt = DateTime.fromJSDate(cycle.waiverPoolPublishAt).toUTC();
  if (nowUtc < publishAt) {
    return;
  }

  const claimed = await claimEventRun(league.id, currentPeriod.id, "NOMINATION_PROCESS");
  if (!claimed) {
    return;
  }

  try {
    await notifyNominationPool(league.id, currentPeriod.id, formatMonthLabel(currentPeriod.startAt, league.timezone));
  } catch (error) {
    await releaseEventRun(league.id, currentPeriod.id, "NOMINATION_PROCESS");
    throw error;
  }
}

async function maybeProcessWaivers(league: {
  id: string;
  timezone: string;
  weeks: Array<{ id: string; index: number; startAt: Date; endAt: Date }>;
}, nowInput?: Date): Promise<void> {
  const currentPeriod = findCurrentWeek(league.weeks, league.timezone, (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).setZone(league.timezone));
  if (!currentPeriod || currentPeriod.index === 1) {
    return;
  }

  const cycle = resolveMonthlyCycleTimes(currentPeriod.startAt, league.timezone);
  if (!cycle.waiverProcessAt) {
    return;
  }

  const nowUtc = DateTime.fromJSDate(nowInput ?? new Date()).toUTC();
  const waiverProcessAt = DateTime.fromJSDate(cycle.waiverProcessAt).toUTC();
  if (nowUtc < waiverProcessAt) {
    return;
  }

  const claimed = await claimEventRun(league.id, currentPeriod.id, "WAIVER_PROCESS");
  if (!claimed) {
    return;
  }

  try {
    await processWaivers(league.id, currentPeriod.id);
    await notifyWaiverResults(league.id, currentPeriod.id, formatMonthLabel(currentPeriod.startAt, league.timezone));
  } catch (error) {
    await releaseEventRun(league.id, currentPeriod.id, "WAIVER_PROCESS");
    throw error;
  }
}

export function resolveDailyStatsRefreshDate(
  league: {
    timezone: string;
    weeks: Array<{ id: string; index: number; startAt: Date; endAt: Date }>;
  },
  nowInput?: Date,
): string | null {
  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).setZone(league.timezone);
  const currentPeriod = findCurrentWeek(league.weeks, league.timezone, now);
  if (!currentPeriod) {
    return null;
  }

  const refreshAt = now.startOf("day").set({
    hour: 12,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  if (now < refreshAt) {
    return null;
  }

  return now.toISODate();
}

async function maybeEnqueueDailyStatsRefresh(league: {
  id: string;
  timezone: string;
  weeks: Array<{ id: string; index: number; startAt: Date; endAt: Date }>;
}, nowInput?: Date): Promise<void> {
  const localDate = resolveDailyStatsRefreshDate(league, nowInput);
  if (!localDate) {
    return;
  }

  await enqueueDailyStatsIngestion(league.id, localDate);
}

async function maybeCaptureOpeningBoxOfficeSnapshots(league: {
  id: string;
  timezone: string;
  weeks: Array<{ id: string; index: number; startAt: Date; endAt: Date }>;
}, nowInput?: Date): Promise<void> {
  const currentPeriod = findCurrentWeek(
    league.weeks,
    league.timezone,
    (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).setZone(league.timezone),
  );
  if (!currentPeriod) {
    return;
  }

  await captureWeekOpeningBoxOfficeSnapshots(league.id, currentPeriod.id);
}

async function maybeFinalizeEndedPeriods(league: {
  id: string;
  timezone: string;
  weeks: Array<{ id: string; index: number; startAt: Date; endAt: Date }>;
}, nowInput?: Date): Promise<void> {
  const nowUtc = DateTime.fromJSDate(nowInput ?? new Date()).toUTC();

  for (const period of league.weeks.filter((item) => nowUtc > DateTime.fromJSDate(item.endAt).toUTC())) {
    const claimed = await claimEventRun(league.id, period.id, "MATCHUP_FINALIZE");
    if (!claimed) {
      continue;
    }

    try {
      await finalizeWeekScoring(league.id, period.id);
      await notifyMatchupSummary(league.id, period.id, formatMonthLabel(period.startAt, league.timezone));
    } catch (error) {
      await releaseEventRun(league.id, period.id, "MATCHUP_FINALIZE");
      throw error;
    }
  }
}

async function runLeagueCycleForLeague(leagueId: string, nowInput?: Date): Promise<void> {
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
    return;
  }

  await maybeCaptureOpeningBoxOfficeSnapshots(league, nowInput);
  await maybeFinalizeEndedPeriods(league, nowInput);
  await maybeEnqueueDailyStatsRefresh(league, nowInput);
  await maybePublishNominationPool(league, nowInput);
  await maybeProcessWaivers(league, nowInput);
}

export async function runLeagueCycleSchedulerTick(nowInput?: Date): Promise<void> {
  const leagues = await prisma.league.findMany({
    select: { id: true },
  });

  for (const league of leagues) {
    try {
      await runLeagueCycleForLeague(league.id, nowInput);
    } catch (error) {
      console.error(`[cycle] failed for league ${league.id}`, error);
    }
  }
}

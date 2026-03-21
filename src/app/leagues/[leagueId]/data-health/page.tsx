import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { DataHealthManager } from "@/components/DataHealthManager";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/server/auth/session";
import { getRottenTomatoesUrlForMovieTitle } from "@/server/services/movieExternalLinkService";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { getStoredBoxOfficeSnapshot } from "@/server/services/scoringService";
import { getPreviousSeasonPointsWindow } from "@/server/utils/previousSeasonWindow";
import { findCurrentWeek } from "@/server/utils/time";

export const dynamic = "force-dynamic";

function needsManualBoxOfficeReview(input: {
  worldwideGrossUsd: bigint;
  dataStatus: "SUCCESS" | "FAILED" | "MANUAL_OVERRIDE";
  rawSource: unknown;
  movieReleaseDate: Date | null;
  weekStartAt: Date;
  weekEndAt: Date;
  errorMessage: string | null;
  now: Date;
}) {
  if (input.dataStatus === "MANUAL_OVERRIDE") {
    return false;
  }

  if (!input.movieReleaseDate || input.movieReleaseDate.getTime() > input.weekEndAt.getTime()) {
    return false;
  }

  if (input.weekEndAt.getTime() >= input.now.getTime()) {
    return false;
  }

  const rawSource = input.rawSource && typeof input.rawSource === "object" ? (input.rawSource as Record<string, unknown>) : null;
  const releasedDuringPeriod = input.movieReleaseDate.getTime() > input.weekStartAt.getTime();
  const hasOpeningSnapshot =
    rawSource?.boxOfficeOpeningSnapshot != null && typeof rawSource.boxOfficeOpeningSnapshot === "object";
  const hasClosingSnapshot =
    rawSource?.boxOfficeClosingSnapshot != null && typeof rawSource.boxOfficeClosingSnapshot === "object";
  const missingRequiredSnapshots = releasedDuringPeriod ? !hasClosingSnapshot : !hasOpeningSnapshot || !hasClosingSnapshot;
  const usedLegacyEstimator = rawSource?.estimatedMonthlyFromCumulative === true;
  const boxOfficeImportFailed =
    input.dataStatus === "FAILED" &&
    typeof input.errorMessage === "string" &&
    (input.errorMessage.includes("boxOfficeCurrent:") || input.errorMessage.includes("boxOfficeBaseline:"));

  if (missingRequiredSnapshots || usedLegacyEstimator || boxOfficeImportFailed) {
    return true;
  }

  return false;
}

function getStoredRatingsSourceUrl(rawSource: unknown): string | null {
  if (!rawSource || typeof rawSource !== "object") {
    return null;
  }

  const ratings = (rawSource as Record<string, unknown>).ratings;
  if (!ratings || typeof ratings !== "object") {
    return null;
  }

  const sourceUrl = (ratings as Record<string, unknown>).sourceUrl;
  return typeof sourceUrl === "string" && sourceUrl.length > 0 ? sourceUrl : null;
}

function getStoredBoxOfficeSourceUrl(rawSource: unknown): string | null {
  if (!rawSource || typeof rawSource !== "object") {
    return null;
  }

  for (const key of ["boxOfficeCurrent", "boxOfficeBaseline", "boxOfficeOpeningSnapshot", "boxOfficeClosingSnapshot"]) {
    const value = (rawSource as Record<string, unknown>)[key];
    if (!value || typeof value !== "object") {
      continue;
    }

    const sourceUrl = (value as Record<string, unknown>).sourceUrl;
    if (typeof sourceUrl === "string" && sourceUrl.length > 0) {
      return sourceUrl;
    }
  }

  return null;
}

function getStoredMonthEndWorldwideGrossUsd(rawSource: unknown, weekEndAt: Date): string {
  const closingSnapshot = getStoredBoxOfficeSnapshot(rawSource, "boxOfficeClosingSnapshot");
  if (closingSnapshot) {
    const snapshotAsOf = new Date(closingSnapshot.asOfDate);
    if (!Number.isNaN(snapshotAsOf.getTime()) && snapshotAsOf.getTime() <= weekEndAt.getTime()) {
      return String(closingSnapshot.cumulativeWorldwideGrossUsd);
    }
  }

  return "";
}

export default async function LeagueDataHealthPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ weekId?: string }>;
}) {
  const { leagueId } = await params;
  const { weekId } = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      members: true,
    },
  });
  if (!league) {
    return <div>League not found</div>;
  }

  const membership = league.members.find((member) => member.userId === user.id);
  if (!membership) {
    redirect("/");
  }

  const isCommissioner = league.commissionerUserId === user.id;
  const now = new Date();

  const weeks = await prisma.week.findMany({
    where: { leagueId },
    orderBy: { index: "asc" },
    take: 20,
    select: { id: true, index: true, startAt: true, endAt: true },
  });

  const currentWeek = findCurrentWeek(weeks, league.timezone);
  const selectedWeek = weeks.find((week) => week.id === weekId) ?? currentWeek ?? weeks[0] ?? null;

  const providerStatuses = await prisma.providerStatus.findMany({
    where: { leagueId },
    orderBy: { providerName: "asc" },
    select: {
      providerName: true,
      lastSuccessAt: true,
      lastErrorAt: true,
      lastErrorMessage: true,
    },
  });

  const failedWeekStats = await prisma.movieWeekStat.findMany({
    where: {
      leagueId,
      dataStatus: "FAILED",
      movie: {
        eligibleLeagues: {
          some: { leagueId },
        },
      },
    },
    include: {
      movie: { select: { title: true } },
      week: { select: { index: true } },
    },
    orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
    take: 100,
  });

  const editableWeekStats = selectedWeek
    ? await prisma.movieWeekStat.findMany({
        where: {
          leagueId,
          weekId: selectedWeek.id,
          dataStatus: {
            not: "MANUAL_OVERRIDE",
          },
          movie: {
            eligibleLeagues: {
              some: { leagueId },
            },
            theatricalReleaseDate: {
              lte: selectedWeek.endAt,
            },
          },
        },
        include: {
          movie: { select: { title: true, theatricalReleaseDate: true } },
          week: { select: { index: true, startAt: true, endAt: true } },
        },
        orderBy: [{ movie: { title: "asc" } }, { id: "asc" }],
        take: 1000,
      })
    : [];

  const { previousSeasonYear, startAt: previousSeasonStartAt, cutoffAt: previousSeasonCutoffAt } =
    getPreviousSeasonPointsWindow(league.seasonYear);

  const fantasyPlayers = await prisma.fantasyPlayer.findMany({
    where: {
      role: { in: ACTIVE_FANTASY_ROLES_LIST },
      person: {
        credits: {
          some: {
            movie: {
              eligibleLeagues: {
                some: { leagueId },
              },
            },
          },
        },
      },
    },
    select: {
      personId: true,
    },
  });

  const personIds = Array.from(new Set(fantasyPlayers.map((player) => player.personId)));
  const previousSeasonMovieRows =
    personIds.length > 0
      ? await prisma.credit.findMany({
          where: {
            personId: { in: personIds },
            movie: {
              eligibleLeagues: {
                some: { leagueId },
              },
              theatricalReleaseDate: {
                gte: previousSeasonStartAt,
                lte: previousSeasonCutoffAt,
              },
            },
          },
          select: { movieId: true },
          distinct: ["movieId"],
        })
      : [];
  const previousSeasonMovieIds = previousSeasonMovieRows.map((row) => row.movieId);

  const editableSeasonStats =
    previousSeasonMovieIds.length > 0
      ? await prisma.movieSeasonStat.findMany({
          where: {
            seasonYear: previousSeasonYear,
            movieId: { in: previousSeasonMovieIds },
            movie: {
              eligibleLeagues: {
                some: { leagueId },
              },
            },
          },
          include: {
            movie: { select: { title: true } },
          },
          orderBy: [{ movie: { title: "asc" } }, { id: "asc" }],
          take: 1000,
        })
      : [];

  const failedSeasonStats = editableSeasonStats.filter((row) => row.dataStatus === "FAILED");
  const missingSeasonRows = Math.max(0, previousSeasonMovieIds.length - editableSeasonStats.length);

  return (
    <AppShell title="Data Health">
      <Card>
        <p className="text-sm text-slate-100">
          League: {league.name} ({league.seasonYear})
        </p>
        <p className="text-sm text-slate-200">Selected month: {selectedWeek ? `Month ${selectedWeek.index}` : "No month selected"}</p>
        <p className="text-xs text-slate-400">
          Previous season tracked movies: {previousSeasonMovieIds.length} • Stored rows: {editableSeasonStats.length} • Missing rows:{" "}
          {missingSeasonRows}
        </p>
        {weeks.length > 0 ? (
          <form method="get" className="mt-3 flex items-end gap-2">
            <label className="text-xs text-slate-300">
              Month
              <select
                name="weekId"
                defaultValue={selectedWeek?.id ?? ""}
                className="mt-1 block rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white"
              >
                {weeks.map((week) => (
                  <option key={week.id} value={week.id}>
                    Month {week.index}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white">
              Load Month
            </button>
          </form>
        ) : null}
        {!isCommissioner ? <p className="mt-1 text-xs text-slate-400">Read-only. Only commissioner can save overrides.</p> : null}
      </Card>

      <Card>
        <DataHealthManager
          leagueId={leagueId}
          isCommissioner={isCommissioner}
          timezone={league.timezone}
          selectedWeekLabel={selectedWeek ? `Month ${selectedWeek.index}` : "No month"}
          providerStatuses={providerStatuses.map((status) => ({
            providerName: status.providerName,
            lastSuccessAt: status.lastSuccessAt?.toISOString() ?? null,
            lastErrorAt: status.lastErrorAt?.toISOString() ?? null,
            lastErrorMessage: status.lastErrorMessage,
          }))}
          failedWeekStats={failedWeekStats.map((row) => ({
            id: row.id,
            movieId: row.movieId,
            movieTitle: row.movie.title,
            movieUrl: `/movies/${row.movieId}?leagueId=${leagueId}`,
            rottenTomatoesUrl: null,
            boxOfficeMojoUrl: null,
            weekIndex: row.week.index,
            worldwideGrossUsd: row.worldwideGrossUsd.toString(),
            endOfMonthWorldwideGrossUsd: "",
            rtCriticsScore: row.rtCriticsScore,
            rtAudienceScore: row.rtAudienceScore,
            dataStatus: row.dataStatus,
            errorMessage: row.errorMessage,
            snapshotAt: row.snapshotAt.toISOString(),
            manualOverrideAt: row.manualOverrideAt?.toISOString() ?? null,
            needsManualBoxOfficeReview: false,
          }))}
          failedSeasonStats={failedSeasonStats.map((row) => ({
            id: row.id,
            movieId: row.movieId,
            movieTitle: row.movie.title,
            seasonYear: row.seasonYear,
            worldwideGrossUsd: row.worldwideGrossUsd.toString(),
            rtCriticsScore: row.rtCriticsScore,
            rtAudienceScore: row.rtAudienceScore,
            dataStatus: row.dataStatus,
            errorMessage: row.errorMessage,
            snapshotAt: row.snapshotAt.toISOString(),
            manualOverrideAt: row.manualOverrideAt?.toISOString() ?? null,
          }))}
          editableWeekStats={editableWeekStats.map((row) => ({
            id: row.id,
            movieId: row.movieId,
            movieTitle: row.movie.title,
            movieUrl: `/movies/${row.movieId}?leagueId=${leagueId}`,
            rottenTomatoesUrl: getStoredRatingsSourceUrl(row.rawSource) ?? getRottenTomatoesUrlForMovieTitle(row.movie.title),
            boxOfficeMojoUrl: getStoredBoxOfficeSourceUrl(row.rawSource),
            weekIndex: row.week.index,
            worldwideGrossUsd: row.worldwideGrossUsd.toString(),
            endOfMonthWorldwideGrossUsd: getStoredMonthEndWorldwideGrossUsd(row.rawSource, row.week.endAt),
            rtCriticsScore: row.rtCriticsScore,
            rtAudienceScore: row.rtAudienceScore,
            dataStatus: row.dataStatus,
            errorMessage: row.errorMessage,
            snapshotAt: row.snapshotAt.toISOString(),
            manualOverrideAt: row.manualOverrideAt?.toISOString() ?? null,
            needsManualBoxOfficeReview: needsManualBoxOfficeReview({
              worldwideGrossUsd: row.worldwideGrossUsd,
              dataStatus: row.dataStatus,
              rawSource: row.rawSource,
              movieReleaseDate: row.movie.theatricalReleaseDate,
              weekStartAt: row.week.startAt,
              weekEndAt: row.week.endAt,
              errorMessage: row.errorMessage,
              now,
            }),
          })).filter((row) => row.needsManualBoxOfficeReview)}
          editableSeasonStats={editableSeasonStats.map((row) => ({
            id: row.id,
            movieId: row.movieId,
            movieTitle: row.movie.title,
            seasonYear: row.seasonYear,
            worldwideGrossUsd: row.worldwideGrossUsd.toString(),
            rtCriticsScore: row.rtCriticsScore,
            rtAudienceScore: row.rtAudienceScore,
            dataStatus: row.dataStatus,
            errorMessage: row.errorMessage,
            snapshotAt: row.snapshotAt.toISOString(),
            manualOverrideAt: row.manualOverrideAt?.toISOString() ?? null,
          }))}
        />
      </Card>
    </AppShell>
  );
}

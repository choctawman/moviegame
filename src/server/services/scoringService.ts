import { FantasyRole, MatchupResult, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveCumulativeGross, resolveRatings } from "@/server/providers";
import { isActiveFantasyRole } from "@/server/services/constants";
import { decimalToNumber, roundHalfUp, toDecimal } from "@/server/utils/math";
import { getWeekBoundsClampedToSeason } from "@/server/utils/time";

const BOX_OFFICE_OPENING_SNAPSHOT_KEY = "boxOfficeOpeningSnapshot";
const BOX_OFFICE_CLOSING_SNAPSHOT_KEY = "boxOfficeClosingSnapshot";
const OPENING_SNAPSHOT_GRACE_MS = 36 * 60 * 60 * 1000;

type StoredBoxOfficeSnapshot = {
  cumulativeWorldwideGrossUsd: number;
  asOfDate: string;
  capturedAt: string;
  sourceUrl?: string;
  providerName?: string;
  estimated?: boolean;
  raw?: unknown;
  notReleasedYet?: boolean;
  releaseDate?: string | null;
};

function creditMatchesRole(
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

function resolveAsOf(startAt: Date, endAt: Date, asOfInput?: Date): Date {
  const asOf = asOfInput ?? new Date();
  if (asOf.getTime() < startAt.getTime()) {
    return startAt;
  }
  if (asOf.getTime() > endAt.getTime()) {
    return endAt;
  }
  return asOf;
}

export function isReleasedByAsOf(releaseDate: Date | null, asOf: Date): boolean {
  if (!releaseDate) {
    return true;
  }

  return releaseDate.getTime() <= asOf.getTime();
}

export function isReleasedDuringWindow(releaseDate: Date | null, windowStart: Date, asOf: Date): boolean {
  if (!releaseDate) {
    return false;
  }

  const releaseTime = releaseDate.getTime();
  return releaseTime >= windowStart.getTime() && releaseTime <= asOf.getTime();
}

export function calculateMonthlyGrossFromCumulative(
  currentGrossUsd: number,
  baselineGrossUsd: number,
  priorAssignedGrossUsd = 0,
): number {
  return Math.max(0, Math.round(currentGrossUsd - Math.max(baselineGrossUsd, priorAssignedGrossUsd)));
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

export function getStoredBoxOfficeSnapshot(rawSource: unknown, key: string): StoredBoxOfficeSnapshot | null {
  const value = asObjectRecord(rawSource)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Record<string, unknown>;
  const cumulativeWorldwideGrossUsd = snapshot.cumulativeWorldwideGrossUsd;
  const asOfDate = snapshot.asOfDate;
  const capturedAt = snapshot.capturedAt;

  if (typeof cumulativeWorldwideGrossUsd !== "number" || !Number.isFinite(cumulativeWorldwideGrossUsd)) {
    return null;
  }

  if (typeof asOfDate !== "string" || asOfDate.length === 0 || typeof capturedAt !== "string" || capturedAt.length === 0) {
    return null;
  }

  return {
    cumulativeWorldwideGrossUsd,
    asOfDate,
    capturedAt,
    sourceUrl: typeof snapshot.sourceUrl === "string" ? snapshot.sourceUrl : undefined,
    providerName: typeof snapshot.providerName === "string" ? snapshot.providerName : undefined,
    estimated: typeof snapshot.estimated === "boolean" ? snapshot.estimated : undefined,
    raw: snapshot.raw,
    notReleasedYet: snapshot.notReleasedYet === true,
    releaseDate: typeof snapshot.releaseDate === "string" ? snapshot.releaseDate : null,
  };
}

function preserveStoredBoxOfficeSnapshots(rawSource: unknown): Record<string, unknown> {
  const source = asObjectRecord(rawSource);
  const next: Record<string, unknown> = {};

  for (const key of [BOX_OFFICE_OPENING_SNAPSHOT_KEY, BOX_OFFICE_CLOSING_SNAPSHOT_KEY]) {
    if (source[key] !== undefined) {
      next[key] = source[key];
    }
  }

  return next;
}

function storeBoxOfficeSnapshot(rawSource: unknown, key: string, snapshot: StoredBoxOfficeSnapshot): Record<string, unknown> {
  return {
    ...asObjectRecord(rawSource),
    [key]: snapshot,
  };
}

function toStoredBoxOfficeSnapshot(
  input:
    | { cumulativeWorldwideGrossUsd: number; asOfDate: string; sourceUrl: string; providerName?: string; estimated: boolean; raw: unknown }
    | { cumulativeWorldwideGrossUsd: number; asOfDate: string; notReleasedYet: true; releaseDate: string | null },
  capturedAt: Date,
): StoredBoxOfficeSnapshot {
  if ("notReleasedYet" in input) {
    return {
      cumulativeWorldwideGrossUsd: input.cumulativeWorldwideGrossUsd,
      asOfDate: input.asOfDate,
      capturedAt: capturedAt.toISOString(),
      notReleasedYet: true,
      releaseDate: input.releaseDate,
    };
  }

  return {
    cumulativeWorldwideGrossUsd: input.cumulativeWorldwideGrossUsd,
    asOfDate: input.asOfDate,
    capturedAt: capturedAt.toISOString(),
    sourceUrl: input.sourceUrl,
    providerName: input.providerName,
    estimated: input.estimated,
    raw: input.raw,
  };
}

async function captureBoxOfficeBoundarySnapshots(
  leagueId: string,
  weekId: string,
  boundary: "OPENING" | "CLOSING",
): Promise<void> {
  const [league, week] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId } }),
    prisma.week.findUnique({ where: { id: weekId } }),
  ]);

  if (!league || !week) {
    throw new Error("League or period not found");
  }

  const { startAt, endAt } = getWeekBoundsClampedToSeason(week.startAt, week.endAt, league.seasonYear, league.timezone);
  const snapshotKey = boundary === "OPENING" ? BOX_OFFICE_OPENING_SNAPSHOT_KEY : BOX_OFFICE_CLOSING_SNAPSHOT_KEY;
  const boundaryAt = boundary === "OPENING" ? startAt : endAt;

  const movies = await prisma.movie.findMany({
    where: {
      eligibleLeagues: {
        some: { leagueId },
      },
    },
  });

  if (movies.length === 0) {
    return;
  }

  const existingStats = await prisma.movieWeekStat.findMany({
    where: {
      leagueId,
      weekId,
      movieId: {
        in: movies.map((movie) => movie.id),
      },
    },
    select: {
      movieId: true,
      dataStatus: true,
      rawSource: true,
    },
  });

  const existingByMovieId = new Map(existingStats.map((row) => [row.movieId, row]));

  for (const movie of movies) {
    const existing = existingByMovieId.get(movie.id);
    if (existing?.dataStatus === "MANUAL_OVERRIDE") {
      continue;
    }

    if (getStoredBoxOfficeSnapshot(existing?.rawSource, snapshotKey)) {
      continue;
    }

    const providerMovie = {
      movieId: movie.id,
      title: movie.title,
      externalTmdbMovieId: movie.externalTmdbMovieId,
      releaseDate: movie.theatricalReleaseDate,
    };

    const capturedAt = new Date();

    if (boundary === "OPENING" && capturedAt.getTime() - boundaryAt.getTime() > OPENING_SNAPSHOT_GRACE_MS) {
      continue;
    }

    try {
      const snapshot = !isReleasedByAsOf(movie.theatricalReleaseDate, boundaryAt)
        ? toStoredBoxOfficeSnapshot(
            {
              cumulativeWorldwideGrossUsd: 0,
              asOfDate: boundaryAt.toISOString(),
              notReleasedYet: true,
              releaseDate: movie.theatricalReleaseDate?.toISOString() ?? null,
            },
            capturedAt,
          )
        : toStoredBoxOfficeSnapshot(await resolveCumulativeGross(providerMovie, capturedAt, leagueId), capturedAt);

      await prisma.movieWeekStat.upsert({
        where: {
          movieId_leagueId_weekId: {
            movieId: movie.id,
            leagueId,
            weekId,
          },
        },
        update: {
          rawSource: storeBoxOfficeSnapshot(existing?.rawSource, snapshotKey, snapshot) as Prisma.InputJsonValue,
          snapshotAt: capturedAt,
        },
        create: {
          movieId: movie.id,
          leagueId,
          weekId,
          rawSource: storeBoxOfficeSnapshot({}, snapshotKey, snapshot) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      console.error(
        `[box-office] failed to capture ${boundary.toLowerCase()} snapshot for league ${leagueId}, week ${weekId}, movie ${movie.id}`,
        error,
      );
    }
  }
}

export async function captureWeekOpeningBoxOfficeSnapshots(leagueId: string, weekId: string): Promise<void> {
  await captureBoxOfficeBoundarySnapshots(leagueId, weekId, "OPENING");
}

export async function captureWeekClosingBoxOfficeSnapshots(leagueId: string, weekId: string): Promise<void> {
  await captureBoxOfficeBoundarySnapshots(leagueId, weekId, "CLOSING");
}

export async function ingestMovieWeekSnapshots(leagueId: string, weekId: string, asOfInput?: Date): Promise<void> {
  const [league, week] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId } }),
    prisma.week.findUnique({ where: { id: weekId } }),
  ]);

  if (!league || !week) {
    throw new Error("League or period not found");
  }

  const { startAt, endAt } = getWeekBoundsClampedToSeason(week.startAt, week.endAt, league.seasonYear, league.timezone);
  const asOf = resolveAsOf(startAt, endAt, asOfInput);
  const baselineAt = new Date(startAt.getTime() - 24 * 60 * 60 * 1000);

  const movies = await prisma.movie.findMany({
    where: {
      eligibleLeagues: {
        some: { leagueId },
      },
    },
  });

  const existingStats = await prisma.movieWeekStat.findMany({
    where: {
      leagueId,
      weekId,
      movieId: {
        in: movies.map((movie) => movie.id),
      },
    },
    select: {
      movieId: true,
      dataStatus: true,
      rawSource: true,
    },
  });

  const existingStatByMovieId = new Map(existingStats.map((row) => [row.movieId, row]));
  const manualOverrideMovieIds = new Set(
    existingStats.filter((row) => row.dataStatus === "MANUAL_OVERRIDE").map((row) => row.movieId),
  );

  const priorStats = await prisma.movieWeekStat.findMany({
    where: {
      leagueId,
      movieId: {
        in: movies.map((movie) => movie.id),
      },
      week: {
        index: {
          lt: week.index,
        },
      },
    },
    select: {
      movieId: true,
      worldwideGrossUsd: true,
    },
  });

  const priorAssignedGrossByMovieId = new Map<string, number>();
  for (const stat of priorStats) {
    priorAssignedGrossByMovieId.set(
      stat.movieId,
      (priorAssignedGrossByMovieId.get(stat.movieId) ?? 0) + Number(stat.worldwideGrossUsd),
    );
  }

  for (const movie of movies) {
    const existingStat = existingStatByMovieId.get(movie.id);
    if (manualOverrideMovieIds.has(movie.id)) {
      continue;
    }

    const providerMovie = {
      movieId: movie.id,
      title: movie.title,
      externalTmdbMovieId: movie.externalTmdbMovieId,
      releaseDate: movie.theatricalReleaseDate,
    };

    if (!isReleasedByAsOf(movie.theatricalReleaseDate, asOf)) {
      const raw = {
        ...preserveStoredBoxOfficeSnapshots(existingStat?.rawSource),
        estimatedMonthlyFromCumulative: false,
        boxOfficeComputation: "not-released",
        notReleasedYet: true,
        releaseDate: movie.theatricalReleaseDate?.toISOString() ?? null,
        periodStartAt: startAt.toISOString(),
        periodEndAt: endAt.toISOString(),
        asOfAt: asOf.toISOString(),
      };

      await prisma.movieWeekStat.upsert({
        where: {
          movieId_leagueId_weekId: {
            movieId: movie.id,
            leagueId,
            weekId,
          },
        },
        update: {
          worldwideGrossUsd: BigInt(0),
          rtCriticsScore: null,
          rtAudienceScore: null,
          dataStatus: "SUCCESS",
          errorMessage: null,
          snapshotAt: new Date(),
          rawSource: raw as Prisma.InputJsonValue,
        },
        create: {
          movieId: movie.id,
          leagueId,
          weekId,
          worldwideGrossUsd: BigInt(0),
          rtCriticsScore: null,
          rtAudienceScore: null,
          dataStatus: "SUCCESS",
          errorMessage: null,
          rawSource: raw as Prisma.InputJsonValue,
        },
      });
      continue;
    }

    try {
      const releasedDuringPeriod = isReleasedDuringWindow(movie.theatricalReleaseDate, startAt, asOf);
      const openingSnapshot = getStoredBoxOfficeSnapshot(existingStat?.rawSource, BOX_OFFICE_OPENING_SNAPSHOT_KEY);
      const closingSnapshot = getStoredBoxOfficeSnapshot(existingStat?.rawSource, BOX_OFFICE_CLOSING_SNAPSHOT_KEY);
      const useStoredClosingSnapshot = asOf.getTime() >= endAt.getTime() && closingSnapshot != null;
      const [currentGrossResult, baselineGrossResult, ratingsResult] = await Promise.allSettled([
        useStoredClosingSnapshot ? Promise.resolve(null) : resolveCumulativeGross(providerMovie, asOf, leagueId),
        releasedDuringPeriod || openingSnapshot ? Promise.resolve(null) : resolveCumulativeGross(providerMovie, baselineAt, leagueId),
        resolveRatings(providerMovie, leagueId),
      ]);

      const errors: string[] = [];
      const raw: Record<string, unknown> = {
        ...preserveStoredBoxOfficeSnapshots(existingStat?.rawSource),
        estimatedMonthlyFromCumulative: false,
        periodStartAt: startAt.toISOString(),
        periodEndAt: endAt.toISOString(),
        asOfAt: asOf.toISOString(),
        baselineAt: baselineAt.toISOString(),
      };

      let currentGrossUsd = 0;
      let baselineGrossUsd = 0;
      const priorAssignedGrossUsd = priorAssignedGrossByMovieId.get(movie.id) ?? 0;
      let rtCritics: number | null = null;
      let rtAudience: number | null = null;
      let boxOfficeComputation = "live-current";

      if (useStoredClosingSnapshot && closingSnapshot) {
        currentGrossUsd = closingSnapshot.cumulativeWorldwideGrossUsd;
        raw.boxOfficeCurrent = {
          ...closingSnapshot,
          source: "stored-closing-snapshot",
        };
      } else if (currentGrossResult.status === "fulfilled" && currentGrossResult.value) {
        currentGrossUsd = currentGrossResult.value.cumulativeWorldwideGrossUsd;
        raw.boxOfficeCurrent = currentGrossResult.value;
      } else if (currentGrossResult.status === "rejected") {
        errors.push(
          `boxOfficeCurrent: ${currentGrossResult.reason instanceof Error ? currentGrossResult.reason.message : String(currentGrossResult.reason)}`,
        );
      } else {
        errors.push("boxOfficeCurrent: No current box office data was returned");
      }

      if (releasedDuringPeriod) {
        boxOfficeComputation = useStoredClosingSnapshot ? "closing-snapshot-release-month" : "release-month-live-current";
        raw.boxOfficeBaseline = {
          skipped: true,
          reason: "released-during-period",
          asOfDate: baselineAt.toISOString(),
        };
      } else if (openingSnapshot) {
        baselineGrossUsd = openingSnapshot.cumulativeWorldwideGrossUsd;
        boxOfficeComputation = useStoredClosingSnapshot ? "boundary-snapshots" : "opening-snapshot-live-current";
        raw.boxOfficeBaseline = {
          ...openingSnapshot,
          source: "stored-opening-snapshot",
        };
      } else if (baselineGrossResult.status === "fulfilled" && baselineGrossResult.value) {
        baselineGrossUsd = baselineGrossResult.value.cumulativeWorldwideGrossUsd;
        boxOfficeComputation = "fallback-cumulative-estimator";
        raw.estimatedMonthlyFromCumulative = true;
        raw.boxOfficeBaseline = baselineGrossResult.value;
      } else if (priorAssignedGrossUsd > 0) {
        boxOfficeComputation = "fallback-prior-assigned";
        raw.estimatedMonthlyFromCumulative = true;
        raw.boxOfficeBaseline = {
          skipped: true,
          reason: "using-stored-prior-months",
          asOfDate: baselineAt.toISOString(),
          priorAssignedGrossUsd,
        };
      } else {
        const baselineError =
          baselineGrossResult.status === "rejected"
            ? baselineGrossResult.reason instanceof Error
              ? baselineGrossResult.reason.message
              : String(baselineGrossResult.reason)
            : "No baseline box office data was returned";
        errors.push(
          `boxOfficeBaseline: ${baselineError}`,
        );
      }

      if (priorAssignedGrossUsd > 0) {
        raw.priorAssignedGrossUsd = priorAssignedGrossUsd;
      }
      raw.boxOfficeComputation = boxOfficeComputation;

      if (ratingsResult.status === "fulfilled") {
        rtCritics = ratingsResult.value.critics;
        rtAudience = ratingsResult.value.audience;
        raw.ratings = ratingsResult.value;
      } else {
        errors.push(`ratings: ${ratingsResult.reason instanceof Error ? ratingsResult.reason.message : String(ratingsResult.reason)}`);
      }

      if (errors.length > 0) {
        raw.errors = errors;
      }

      const monthlyGross = calculateMonthlyGrossFromCumulative(currentGrossUsd, baselineGrossUsd, priorAssignedGrossUsd);

      await prisma.movieWeekStat.upsert({
        where: {
          movieId_leagueId_weekId: {
            movieId: movie.id,
            leagueId,
            weekId,
          },
        },
        update: {
          worldwideGrossUsd: BigInt(monthlyGross),
          rtCriticsScore: rtCritics,
          rtAudienceScore: rtAudience,
          dataStatus: errors.length > 0 ? "FAILED" : "SUCCESS",
          errorMessage: errors.length > 0 ? errors.join(" | ") : null,
          snapshotAt: new Date(),
          rawSource: raw as Prisma.InputJsonValue,
        },
        create: {
          movieId: movie.id,
          leagueId,
          weekId,
          worldwideGrossUsd: BigInt(monthlyGross),
          rtCriticsScore: rtCritics,
          rtAudienceScore: rtAudience,
          dataStatus: errors.length > 0 ? "FAILED" : "SUCCESS",
          errorMessage: errors.length > 0 ? errors.join(" | ") : null,
          rawSource: raw as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      const errorMessage = (error as Error).message;
      const raw = {
        ...preserveStoredBoxOfficeSnapshots(existingStat?.rawSource),
        error: errorMessage,
        failedAt: new Date().toISOString(),
        periodStartAt: startAt.toISOString(),
        periodEndAt: endAt.toISOString(),
        asOfAt: asOf.toISOString(),
      };

      await prisma.movieWeekStat.upsert({
        where: {
          movieId_leagueId_weekId: {
            movieId: movie.id,
            leagueId,
            weekId,
          },
        },
        update: {
          worldwideGrossUsd: BigInt(0),
          rtCriticsScore: null,
          rtAudienceScore: null,
          dataStatus: "FAILED",
          errorMessage,
          snapshotAt: new Date(),
          rawSource: raw as Prisma.InputJsonValue,
        },
        create: {
          movieId: movie.id,
          leagueId,
          weekId,
          worldwideGrossUsd: BigInt(0),
          rtCriticsScore: null,
          rtAudienceScore: null,
          dataStatus: "FAILED",
          errorMessage,
          rawSource: raw as Prisma.InputJsonValue,
        },
      });
    }
  }
}

async function recomputePeriodScores(
  leagueId: string,
  weekId: string,
  options?: { finalizeMatchups?: boolean; asOfInput?: Date },
): Promise<void> {
  const finalizeMatchups = options?.finalizeMatchups ?? false;
  await ingestMovieWeekSnapshots(leagueId, weekId, options?.asOfInput);

  const week = await prisma.week.findUnique({
    where: { id: weekId },
    include: {
      league: true,
      matchups: true,
    },
  });

  if (!week) {
    throw new Error("Period not found");
  }

  const { startAt, endAt } = getWeekBoundsClampedToSeason(week.startAt, week.endAt, week.league.seasonYear, week.league.timezone);
  const scoringAsOf = resolveAsOf(startAt, endAt, options?.asOfInput);

  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: {
      rosterSlots: {
        include: {
          fantasyPlayer: {
            include: {
              person: {
                include: {
                  credits: {
                    include: {
                      movie: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const movieStats = await prisma.movieWeekStat.findMany({
    where: {
      leagueId,
      weekId,
    },
  });

  const statsByMovie = new Map(movieStats.map((stat) => [stat.movieId, stat]));
  const eligibleMovieIds = new Set(
    (
      await prisma.leagueEligibleMovie.findMany({
        where: { leagueId },
        select: { movieId: true },
      })
    ).map((item) => item.movieId),
  );

  await prisma.$transaction(async (tx) => {
    for (const team of teams) {
      let teamBox = 0;
      let teamRt = 0;
      let teamRtContrib = 0;

      for (const slot of team.rosterSlots) {
        if (slot.role === "BENCH") {
          continue;
        }

        const fp = slot.fantasyPlayer;
        if (!fp || !isActiveFantasyRole(fp.role)) {
          continue;
        }

        const contributions: Array<{
          movieId: string;
          title: string;
          grossUsd: number;
          boxPoints: number;
          rtCritics: number | null;
          rtAudience: number | null;
          rtPoints: number;
        }> = [];

        let fpBox = 0;
        let fpRt = 0;
        let fpRtContrib = 0;

        for (const credit of fp.person.credits) {
          if (!creditMatchesRole(fp.role, credit as never)) {
            continue;
          }

          if (!eligibleMovieIds.has(credit.movieId)) {
            continue;
          }

          if (!isReleasedByAsOf(credit.movie.theatricalReleaseDate, scoringAsOf)) {
            continue;
          }

          const stat = statsByMovie.get(credit.movieId);
          if (!stat) {
            continue;
          }

          const gross = Number(stat.worldwideGrossUsd);
          const boxPoints = calculateBoxOfficePoints(gross);
          const rtPoints = calculateRtPoints(stat.rtCriticsScore, stat.rtAudienceScore);

          if (stat.rtCriticsScore != null || stat.rtAudienceScore != null) {
            fpRtContrib += 1;
          }

          fpBox += boxPoints;
          fpRt += rtPoints;

          contributions.push({
            movieId: credit.movieId,
            title: credit.movie.title,
            grossUsd: gross,
            boxPoints,
            rtCritics: stat.rtCriticsScore,
            rtAudience: stat.rtAudienceScore,
            rtPoints,
          });
        }

        fpBox = roundHalfUp(fpBox, 2);
        teamBox = roundHalfUp(teamBox + fpBox, 2);
        teamRt += fpRt;
        teamRtContrib += fpRtContrib;

        await tx.fantasyPlayerWeekScore.upsert({
          where: {
            fantasyPlayerId_leagueId_weekId: {
              fantasyPlayerId: fp.id,
              leagueId,
              weekId,
            },
          },
          update: {
            pointsBoxOffice: toDecimal(fpBox),
            pointsRt: fpRt,
            rtContribCount: fpRtContrib,
            breakdown: { contributions },
          },
          create: {
            fantasyPlayerId: fp.id,
            leagueId,
            weekId,
            pointsBoxOffice: toDecimal(fpBox),
            pointsRt: fpRt,
            rtContribCount: fpRtContrib,
            breakdown: { contributions },
          },
        });
      }

      const rtAvg = teamRtContrib > 0 ? roundHalfUp(teamRt / teamRtContrib, 2) : 0;
      const total = roundHalfUp(teamBox + teamRt, 2);

      await tx.teamWeekScore.upsert({
        where: {
          teamId_leagueId_weekId: {
            teamId: team.id,
            leagueId,
            weekId,
          },
        },
        update: {
          pointsBoxOffice: toDecimal(teamBox),
          pointsRt: teamRt,
          pointsTotal: toDecimal(total),
          rtAvg: toDecimal(rtAvg),
        },
        create: {
          teamId: team.id,
          leagueId,
          weekId,
          pointsBoxOffice: toDecimal(teamBox),
          pointsRt: teamRt,
          pointsTotal: toDecimal(total),
          rtAvg: toDecimal(rtAvg),
        },
      });
    }

    const scores = await tx.teamWeekScore.findMany({ where: { leagueId, weekId } });
    const scoreMap = new Map(scores.map((score) => [score.teamId, score]));

    for (const matchup of week.matchups) {
      const home = scoreMap.get(matchup.homeTeamId);
      const away = scoreMap.get(matchup.awayTeamId);

      if (!home || !away) {
        continue;
      }

      const homeTotal = decimalToNumber(home.pointsTotal);
      const awayTotal = decimalToNumber(away.pointsTotal);
      const homeRtAvg = decimalToNumber(home.rtAvg);
      const awayRtAvg = decimalToNumber(away.rtAvg);

      const existing = await tx.matchup.findUnique({ where: { id: matchup.id } });
      await tx.matchup.update({
        where: { id: matchup.id },
        data: {
          homeScoreTotal: toDecimal(homeTotal),
          awayScoreTotal: toDecimal(awayTotal),
          homeRtAvg: toDecimal(homeRtAvg),
          awayRtAvg: toDecimal(awayRtAvg),
          ...(finalizeMatchups
            ? {
                result: resolveMatchupResult(homeTotal, awayTotal, homeRtAvg, awayRtAvg),
                finalizedAt: new Date(),
              }
            : {}),
        },
      });

      if (!finalizeMatchups || existing?.finalizedAt) {
        continue;
      }

      const result = resolveMatchupResult(homeTotal, awayTotal, homeRtAvg, awayRtAvg);
      if (result === MatchupResult.HOME_WIN) {
        await tx.team.update({ where: { id: matchup.homeTeamId }, data: { recordWins: { increment: 1 } } });
        await tx.team.update({ where: { id: matchup.awayTeamId }, data: { recordLosses: { increment: 1 } } });
      } else if (result === MatchupResult.AWAY_WIN) {
        await tx.team.update({ where: { id: matchup.awayTeamId }, data: { recordWins: { increment: 1 } } });
        await tx.team.update({ where: { id: matchup.homeTeamId }, data: { recordLosses: { increment: 1 } } });
      } else {
        await tx.team.update({ where: { id: matchup.homeTeamId }, data: { recordTies: { increment: 1 } } });
        await tx.team.update({ where: { id: matchup.awayTeamId }, data: { recordTies: { increment: 1 } } });
      }
    }
  });
}

export async function refreshWeekScoring(leagueId: string, weekId: string, asOfInput?: Date): Promise<void> {
  await captureWeekOpeningBoxOfficeSnapshots(leagueId, weekId);
  await recomputePeriodScores(leagueId, weekId, { asOfInput, finalizeMatchups: false });
}

export async function finalizeWeekScoring(leagueId: string, weekId: string): Promise<void> {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: { endAt: true },
  });

  if (!week) {
    throw new Error("Period not found");
  }

  await captureWeekOpeningBoxOfficeSnapshots(leagueId, weekId);
  await captureWeekClosingBoxOfficeSnapshots(leagueId, weekId);
  await recomputePeriodScores(leagueId, weekId, {
    asOfInput: week.endAt,
    finalizeMatchups: true,
  });
}

export async function finalizeMostRecentlyEndedPeriodIfNeeded(leagueId: string): Promise<void> {
  const week = await prisma.week.findFirst({
    where: {
      leagueId,
      endAt: {
        lt: new Date(),
      },
      matchups: {
        some: {
          finalizedAt: null,
        },
      },
    },
    orderBy: { endAt: "desc" },
    select: { id: true },
  });

  if (!week) {
    return;
  }

  await finalizeWeekScoring(leagueId, week.id);
}

export function calculateBoxOfficePoints(grossUsd: number): number {
  return roundHalfUp(grossUsd / 1_000_000, 2);
}

export function calculateRtPoints(critics: number | null, audience: number | null): number {
  if (critics == null && audience == null) {
    return 0;
  }
  return (critics ?? 0) + (audience ?? 0);
}

export function resolveMatchupResult(
  homePointsTotal: Prisma.Decimal | number,
  awayPointsTotal: Prisma.Decimal | number,
  homeRtAvg: Prisma.Decimal | number,
  awayRtAvg: Prisma.Decimal | number,
): MatchupResult {
  const home = decimalToNumber(homePointsTotal as never);
  const away = decimalToNumber(awayPointsTotal as never);
  const homeRt = decimalToNumber(homeRtAvg as never);
  const awayRt = decimalToNumber(awayRtAvg as never);

  if (home > away) {
    return MatchupResult.HOME_WIN;
  }
  if (away > home) {
    return MatchupResult.AWAY_WIN;
  }
  if (homeRt > awayRt) {
    return MatchupResult.HOME_WIN;
  }
  if (awayRt > homeRt) {
    return MatchupResult.AWAY_WIN;
  }
  return MatchupResult.TIE;
}

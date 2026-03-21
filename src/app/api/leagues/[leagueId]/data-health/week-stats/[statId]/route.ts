import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiHandler, ApiError, ok, parseBody, requireAuth } from "@/server/api/http";
import { requireLeagueCommissioner } from "@/server/auth/permissions";
import { calculateMonthlyGrossFromCumulative, getStoredBoxOfficeSnapshot, refreshWeekScoring } from "@/server/services/scoringService";

const updateWeekStatSchema = z.object({
  endOfMonthWorldwideGrossUsd: z.number().int().nonnegative(),
  rtCriticsScore: z.number().int().min(0).max(100).nullable(),
  rtAudienceScore: z.number().int().min(0).max(100).nullable(),
});

const BOX_OFFICE_OPENING_SNAPSHOT_KEY = "boxOfficeOpeningSnapshot";
const BOX_OFFICE_CLOSING_SNAPSHOT_KEY = "boxOfficeClosingSnapshot";

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function getStoredBoxOfficeSourceUrl(rawSource: unknown): string | null {
  const source = asObjectRecord(rawSource);

  for (const key of ["boxOfficeOpeningSnapshot", "boxOfficeClosingSnapshot", "boxOfficeCurrent", "boxOfficeBaseline"]) {
    const value = source[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const sourceUrl = (value as Record<string, unknown>).sourceUrl;
    if (typeof sourceUrl === "string" && sourceUrl.length > 0) {
      return sourceUrl;
    }
  }

  return null;
}

function buildManualBoxOfficeSnapshot(input: {
  cumulativeWorldwideGrossUsd: number;
  asOfDate: string;
  sourceUrl: string | null;
  capturedAt: string;
  raw: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    cumulativeWorldwideGrossUsd: input.cumulativeWorldwideGrossUsd,
    asOfDate: input.asOfDate,
    capturedAt: input.capturedAt,
    providerName: "manual-override",
    estimated: false,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    raw: input.raw,
  };
}

function buildManualNotReleasedSnapshot(input: {
  asOfDate: string;
  capturedAt: string;
  releaseDate: string | null;
}): Record<string, unknown> {
  return {
    cumulativeWorldwideGrossUsd: 0,
    asOfDate: input.asOfDate,
    capturedAt: input.capturedAt,
    notReleasedYet: true,
    releaseDate: input.releaseDate,
    raw: {
      source: "manual-override",
    },
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ leagueId: string; statId: string }> },
) {
  return apiHandler(async () => {
    const user = await requireAuth();
    const { leagueId, statId } = await context.params;
    await requireLeagueCommissioner(user.id, leagueId);

    const input = await parseBody(request, updateWeekStatSchema);

    const existing = await prisma.movieWeekStat.findUnique({
      where: { id: statId },
      select: {
        id: true,
        leagueId: true,
        movieId: true,
        weekId: true,
        rawSource: true,
        movie: {
          select: {
            theatricalReleaseDate: true,
          },
        },
        week: {
          select: {
            endAt: true,
            index: true,
            startAt: true,
          },
        },
      },
    });

    if (!existing || existing.leagueId !== leagueId) {
      throw new ApiError(404, "Monthly score row not found");
    }

    const priorStats = await prisma.movieWeekStat.findMany({
      where: {
        leagueId,
        movieId: existing.movieId,
        week: {
          index: {
            lt: existing.week.index,
          },
        },
      },
      select: {
        worldwideGrossUsd: true,
      },
    });

    const priorAssignedGrossUsd = priorStats.reduce((total, row) => total + Number(row.worldwideGrossUsd), 0);
    const openingSnapshot = getStoredBoxOfficeSnapshot(existing.rawSource, BOX_OFFICE_OPENING_SNAPSHOT_KEY);
    const openingSnapshotGrossUsd = openingSnapshot?.cumulativeWorldwideGrossUsd ?? 0;
    const releaseDate = existing.movie.theatricalReleaseDate;
    const releasedDuringMonth =
      releaseDate != null &&
      releaseDate.getTime() > existing.week.startAt.getTime() &&
      releaseDate.getTime() <= existing.week.endAt.getTime();

    if (!releasedDuringMonth && openingSnapshot == null && priorAssignedGrossUsd === 0) {
      throw new ApiError(
        400,
        "Cannot derive this month's gross from a cumulative total because no prior month total is stored yet. Fix earlier months first.",
      );
    }

    const endOfMonthWorldwideGrossUsd = input.endOfMonthWorldwideGrossUsd;
    const baselineGrossUsd = Math.max(openingSnapshotGrossUsd, priorAssignedGrossUsd);
    if (!releasedDuringMonth && endOfMonthWorldwideGrossUsd < baselineGrossUsd) {
      throw new ApiError(
        400,
        `End-of-month box office total cannot be less than the prior cumulative total of ${baselineGrossUsd}.`,
      );
    }

    const monthlyGrossUsd = calculateMonthlyGrossFromCumulative(endOfMonthWorldwideGrossUsd, openingSnapshotGrossUsd, priorAssignedGrossUsd);
    const capturedAt = new Date();
    const capturedAtIso = capturedAt.toISOString();
    const sourceUrl = getStoredBoxOfficeSourceUrl(existing.rawSource);
    const nextOpeningSnapshot =
      openingSnapshot ??
      (releasedDuringMonth
        ? buildManualNotReleasedSnapshot({
            asOfDate: existing.week.startAt.toISOString(),
            capturedAt: capturedAtIso,
            releaseDate: releaseDate?.toISOString() ?? null,
          })
        : buildManualBoxOfficeSnapshot({
            cumulativeWorldwideGrossUsd: baselineGrossUsd,
            asOfDate: existing.week.startAt.toISOString(),
            sourceUrl,
            capturedAt: capturedAtIso,
            raw: {
              source: "manual-derived-prior-months",
              priorAssignedGrossUsd,
            },
          }));
    const nextClosingSnapshot = buildManualBoxOfficeSnapshot({
      cumulativeWorldwideGrossUsd: endOfMonthWorldwideGrossUsd,
      asOfDate: existing.week.endAt.toISOString(),
      sourceUrl,
      capturedAt: capturedAtIso,
      raw: {
        source: "manual-end-of-month-total",
      },
    });
    const nextRawSource = {
      ...asObjectRecord(existing.rawSource),
      boxOfficeOpeningSnapshot: nextOpeningSnapshot,
      boxOfficeClosingSnapshot: nextClosingSnapshot,
      boxOfficeCurrent: {
        ...nextClosingSnapshot,
        source: "manual-end-of-month-total",
      },
      boxOfficeBaseline: releasedDuringMonth
        ? {
            skipped: true,
            reason: "released-during-period",
            asOfDate: existing.week.startAt.toISOString(),
          }
        : {
            ...nextOpeningSnapshot,
            source: openingSnapshot ? "stored-opening-snapshot" : "manual-derived-prior-months",
          },
      boxOfficeComputation: "manual-end-of-month-total",
      estimatedMonthlyFromCumulative: false,
      manualEndOfMonthWorldwideGrossUsd: endOfMonthWorldwideGrossUsd,
    };

    const updated = await prisma.movieWeekStat.update({
      where: { id: statId },
      data: {
        worldwideGrossUsd: BigInt(monthlyGrossUsd),
        rtCriticsScore: input.rtCriticsScore,
        rtAudienceScore: input.rtAudienceScore,
        dataStatus: "MANUAL_OVERRIDE",
        errorMessage: null,
        manualOverrideAt: capturedAt,
        manualOverrideByUserId: user.id,
        snapshotAt: capturedAt,
        rawSource: nextRawSource as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        worldwideGrossUsd: true,
        rtCriticsScore: true,
        rtAudienceScore: true,
        dataStatus: true,
      },
    });

    const now = new Date();
    const asOfInput = existing.week.endAt.getTime() < now.getTime() ? existing.week.endAt : now;
    await refreshWeekScoring(leagueId, existing.weekId, asOfInput);

    return ok({
      stat: {
        ...updated,
        worldwideGrossUsd: updated.worldwideGrossUsd.toString(),
      },
    });
  });
}

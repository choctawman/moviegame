import "dotenv/config";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { extractWorldwideGrossFromHtml } from "@/server/providers/boxOfficeScraperProvider";
import { getBoxOfficeMojoTitleUrlForMovie } from "@/server/services/movieExternalLinkService";
import { finalizeWeekScoring, refreshWeekScoring } from "@/server/services/scoringService";

const WAYBACK_CALENDAR_CAPTURES_URL = "https://web.archive.org/__wb/calendarcaptures/2";
const SEARCH_KEYS = ["boxOfficeOpeningSnapshot", "boxOfficeClosingSnapshot", "boxOfficeCurrent", "boxOfficeBaseline"];

type WaybackCalendarCapturesResponse = {
  items?: Array<[number, number, number?]>;
};

type WaybackSnapshotMatch = {
  archivedUrl: string;
  capturedAt: string;
  distanceMs: number;
  timestamp: string;
};

function parseStringFlag(argv: string[], key: string): string | undefined {
  const argument = argv.find((value) => value.startsWith(`--${key}=`));
  return argument?.split("=")[1];
}

function parseBooleanFlag(argv: string[], key: string): boolean {
  return argv.includes(`--${key}`) || parseStringFlag(argv, key) === "true";
}

function parseIntegerFlag(argv: string[], key: string, defaultValue: number): number {
  const value = parseStringFlag(argv, key);
  if (value == null) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${key} value: ${value}`);
  }

  return parsed;
}

function parseWaybackTimestamp(timestamp: string): Date | null {
  if (!/^\d{14}$/.test(timestamp)) {
    return null;
  }

  const year = Number.parseInt(timestamp.slice(0, 4), 10);
  const month = Number.parseInt(timestamp.slice(4, 6), 10);
  const day = Number.parseInt(timestamp.slice(6, 8), 10);
  const hour = Number.parseInt(timestamp.slice(8, 10), 10);
  const minute = Number.parseInt(timestamp.slice(10, 12), 10);
  const second = Number.parseInt(timestamp.slice(12, 14), 10);

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
}

function decodeCalendarCaptureTimestamp(year: number, value: number): string | null {
  const digits = `${value}`.padStart(10, "0");
  return /^\d{10}$/.test(digits) ? `${year}${digits}` : null;
}

function getClosestWaybackSnapshot(
  payload: WaybackCalendarCapturesResponse,
  pageUrl: string,
  targetAt: Date,
  maxDistanceHours: number,
): WaybackSnapshotMatch | null {
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return null;
  }

  const year = targetAt.getUTCFullYear();
  const maxDistanceMs = maxDistanceHours * 60 * 60 * 1000;

  const candidates = payload.items
    .filter((item) => Array.isArray(item) && item[1] === 200)
    .map((item) => {
      const timestamp = decodeCalendarCaptureTimestamp(year, item[0]);
      const capturedAtDate = timestamp ? parseWaybackTimestamp(timestamp) : null;
      if (!timestamp || !capturedAtDate) {
        return null;
      }

      return {
        timestamp,
        capturedAtDate,
        distanceMs: Math.abs(capturedAtDate.getTime() - targetAt.getTime()),
      };
    })
    .filter((item): item is { timestamp: string; capturedAtDate: Date; distanceMs: number } => item != null)
    .filter((item) => item.distanceMs <= maxDistanceMs)
    .sort((a, b) => a.distanceMs - b.distanceMs || a.timestamp.localeCompare(b.timestamp));

  const closest = candidates[0];
  if (!closest) {
    return null;
  }

  return {
    archivedUrl: `https://web.archive.org/web/${closest.timestamp}id_/${pageUrl}`,
    capturedAt: closest.capturedAtDate.toISOString(),
    distanceMs: closest.distanceMs,
    timestamp: closest.timestamp,
  };
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function getStoredBoxOfficeSourceUrl(rawSource: unknown): string | null {
  const source = asObjectRecord(rawSource);

  for (const key of SEARCH_KEYS) {
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

async function resolveWaybackGross(pageUrl: string, targetAt: Date, maxDistanceHours: number): Promise<{
  archivedUrl: string;
  capturedAt: string;
  cumulativeWorldwideGrossUsd: number;
  distanceMs: number;
  timestamp: string;
}> {
  const calendarUrl = new URL(WAYBACK_CALENDAR_CAPTURES_URL);
  calendarUrl.searchParams.set("url", pageUrl);
  calendarUrl.searchParams.set("date", String(targetAt.getUTCFullYear()));

  const calendarResponse = await fetch(calendarUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (MovieGameBot/1.0)",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!calendarResponse.ok) {
    throw new Error(`Wayback calendarcaptures HTTP ${calendarResponse.status}`);
  }

  const payload = (await calendarResponse.json()) as WaybackCalendarCapturesResponse;
  const match = getClosestWaybackSnapshot(payload, pageUrl, targetAt, maxDistanceHours);
  if (!match) {
    throw new Error(`No snapshot within ${maxDistanceHours}h of ${targetAt.toISOString()}`);
  }

  const snapshotResponse = await fetch(match.archivedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (MovieGameBot/1.0)",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!snapshotResponse.ok) {
    throw new Error(`Wayback snapshot HTTP ${snapshotResponse.status}`);
  }

  const html = await snapshotResponse.text();
  const gross = extractWorldwideGrossFromHtml(html).gross;

  return {
    archivedUrl: match.archivedUrl,
    capturedAt: match.capturedAt,
    cumulativeWorldwideGrossUsd: gross,
    distanceMs: match.distanceMs,
    timestamp: match.timestamp,
  };
}

function buildStoredSnapshot(
  input:
    | {
        archivedUrl: string;
        capturedAt: string;
        cumulativeWorldwideGrossUsd: number;
        distanceMs: number;
        sourceUrl: string;
        timestamp: string;
      }
    | {
        asOfDate: string;
        cumulativeWorldwideGrossUsd: number;
        notReleasedYet: true;
        releaseDate: string | null;
      },
  snapshotCapturedAt: Date,
): Record<string, unknown> {
  if ("notReleasedYet" in input) {
    return {
      cumulativeWorldwideGrossUsd: input.cumulativeWorldwideGrossUsd,
      asOfDate: input.asOfDate,
      capturedAt: snapshotCapturedAt.toISOString(),
      notReleasedYet: true,
      releaseDate: input.releaseDate,
    };
  }

  return {
    cumulativeWorldwideGrossUsd: input.cumulativeWorldwideGrossUsd,
    asOfDate: input.capturedAt,
    capturedAt: snapshotCapturedAt.toISOString(),
    sourceUrl: input.sourceUrl,
    providerName: "wayback-archive",
    estimated: false,
    raw: {
      archivedUrl: input.archivedUrl,
      archivedTimestamp: input.timestamp,
      distanceMs: input.distanceMs,
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const leagueId = parseStringFlag(argv, "leagueId");
  if (!leagueId) {
    throw new Error("Missing required --leagueId=<id>");
  }

  const dryRun = parseBooleanFlag(argv, "dry-run");
  const maxDistanceHours = parseIntegerFlag(argv, "maxDistanceHours", 720);
  const now = new Date();

  const rows = await prisma.movieWeekStat.findMany({
    where: {
      leagueId,
      dataStatus: "MANUAL_OVERRIDE",
      week: {
        endAt: {
          lt: now,
        },
      },
    },
    select: {
      id: true,
      leagueId: true,
      weekId: true,
      worldwideGrossUsd: true,
      rawSource: true,
      movie: {
        select: {
          externalTmdbMovieId: true,
          id: true,
          theatricalReleaseDate: true,
          title: true,
        },
      },
      week: {
        select: {
          endAt: true,
          id: true,
          index: true,
          startAt: true,
        },
      },
    },
    orderBy: [{ week: { index: "asc" } }, { movie: { theatricalReleaseDate: "asc" } }, { movie: { title: "asc" } }],
  });

  const touchedWeeks = new Set<string>();
  const updated: Array<{ title: string; weekIndex: number; previousGrossUsd: number; newGrossUsd: number }> = [];
  const skipped: Array<{ title: string; weekIndex: number; reason: string }> = [];

  for (const row of rows) {
    const sourceUrl =
      getStoredBoxOfficeSourceUrl(row.rawSource) ??
      (await getBoxOfficeMojoTitleUrlForMovie({
        tmdbMovieId: row.movie.externalTmdbMovieId,
        title: row.movie.title,
        releaseDate: row.movie.theatricalReleaseDate,
      }));

    if (!sourceUrl) {
      skipped.push({
        title: row.movie.title,
        weekIndex: row.week.index,
        reason: "Could not resolve Box Office Mojo URL",
      });
      continue;
    }

    const releaseAt = row.movie.theatricalReleaseDate;
    const startAt = row.week.startAt;
    const endAt = row.week.endAt;
    const snapshotCapturedAt = new Date();

    try {
      const openingResult =
        releaseAt && releaseAt.getTime() > startAt.getTime()
          ? null
          : await resolveWaybackGross(sourceUrl, startAt, maxDistanceHours);

      const closingResult =
        releaseAt && releaseAt.getTime() > endAt.getTime()
          ? null
          : await resolveWaybackGross(sourceUrl, endAt, maxDistanceHours);

      const openingSnapshot = openingResult
        ? buildStoredSnapshot(
            {
              ...openingResult,
              sourceUrl,
            },
            snapshotCapturedAt,
          )
        : buildStoredSnapshot(
            {
              asOfDate: startAt.toISOString(),
              cumulativeWorldwideGrossUsd: 0,
              notReleasedYet: true,
              releaseDate: releaseAt?.toISOString() ?? null,
            },
            snapshotCapturedAt,
          );

      const closingSnapshot = closingResult
        ? buildStoredSnapshot(
            {
              ...closingResult,
              sourceUrl,
            },
            snapshotCapturedAt,
          )
        : buildStoredSnapshot(
            {
              asOfDate: endAt.toISOString(),
              cumulativeWorldwideGrossUsd: 0,
              notReleasedYet: true,
              releaseDate: releaseAt?.toISOString() ?? null,
            },
            snapshotCapturedAt,
          );

      const openingGrossUsd = openingResult?.cumulativeWorldwideGrossUsd ?? 0;
      const closingGrossUsd = closingResult?.cumulativeWorldwideGrossUsd ?? 0;
      const correctedGrossUsd = Math.max(0, closingGrossUsd - openingGrossUsd);
      const previousGrossUsd = Number(row.worldwideGrossUsd);
      const nextRawSource = {
        ...asObjectRecord(row.rawSource),
        boxOfficeOpeningSnapshot: openingSnapshot,
        boxOfficeClosingSnapshot: closingSnapshot,
        estimatedMonthlyFromCumulative: false,
      };

      if (!dryRun) {
        await prisma.movieWeekStat.update({
          where: { id: row.id },
          data: {
            worldwideGrossUsd: BigInt(correctedGrossUsd),
            dataStatus: "SUCCESS",
            errorMessage: null,
            manualOverrideAt: null,
            manualOverrideByUserId: null,
            snapshotAt: snapshotCapturedAt,
            rawSource: nextRawSource as Prisma.InputJsonValue,
          },
        });
      }

      updated.push({
        title: row.movie.title,
        weekIndex: row.week.index,
        previousGrossUsd,
        newGrossUsd: correctedGrossUsd,
      });
      touchedWeeks.add(row.week.id);
    } catch (error) {
      skipped.push({
        title: row.movie.title,
        weekIndex: row.week.index,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!dryRun) {
    for (const weekId of touchedWeeks) {
      const week = rows.find((row) => row.week.id === weekId)?.week;
      if (!week) {
        continue;
      }

      if (week.endAt.getTime() < now.getTime()) {
        await finalizeWeekScoring(leagueId, weekId);
      } else {
        await refreshWeekScoring(leagueId, weekId, now);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        leagueId,
        maxDistanceHours,
        updated,
        skipped,
        touchedWeeks: Array.from(touchedWeeks.values()),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("[fix-wayback-manual-overrides] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

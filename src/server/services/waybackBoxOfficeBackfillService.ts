import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { extractWorldwideGrossFromHtml } from "@/server/providers/boxOfficeScraperProvider";
import { getBoxOfficeMojoTitleUrlForMovie } from "@/server/services/movieExternalLinkService";
import { finalizeWeekScoring, getStoredBoxOfficeSnapshot, refreshWeekScoring } from "@/server/services/scoringService";
import { getWeekBoundsClampedToSeason } from "@/server/utils/time";

const BOX_OFFICE_OPENING_SNAPSHOT_KEY = "boxOfficeOpeningSnapshot";
const BOX_OFFICE_CLOSING_SNAPSHOT_KEY = "boxOfficeClosingSnapshot";
const WAYBACK_CALENDAR_CAPTURES_URL = "https://web.archive.org/__wb/calendarcaptures/2";
const DEFAULT_MAX_DISTANCE_HOURS = 72;

interface WaybackCalendarCapturesResponse {
  colls?: string[][];
  items?: Array<[number, number, number?]>;
}

export type WaybackSnapshotMatch = {
  archivedUrl: string;
  originalUrl: string;
  timestamp: string;
  capturedAt: string;
  distanceMs: number;
};

type BackfillCandidateRow = {
  id: string;
  leagueId: string;
  weekId: string;
  dataStatus: "SUCCESS" | "FAILED" | "MANUAL_OVERRIDE";
  rawSource: unknown;
  movie: {
    id: string;
    title: string;
    externalTmdbMovieId: number | null;
    theatricalReleaseDate: Date | null;
  };
  week: {
    id: string;
    index: number;
    startAt: Date;
    endAt: Date;
  };
  league: {
    id: string;
    seasonYear: number;
    timezone: string;
  };
};

export type WaybackBackfillOptions = {
  leagueId?: string;
  weekId?: string;
  movieId?: string;
  force?: boolean;
  dryRun?: boolean;
  maxDistanceHours?: number;
};

export type WaybackBackfillSummary = {
  scannedRows: number;
  candidateRows: number;
  updatedRows: number;
  recomputedWeeks: number;
  skippedRows: number;
  failures: Array<{ statId: string; movieTitle: string; reason: string }>;
};

export function parseWaybackTimestamp(timestamp: string): Date | null {
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
  if (!/^\d{10}$/.test(digits)) {
    return null;
  }

  return `${year}${digits}`;
}

export function getClosestWaybackSnapshot(
  payload: WaybackCalendarCapturesResponse,
  originalUrl: string,
  targetAt: Date,
  maxDistanceHours = DEFAULT_MAX_DISTANCE_HOURS,
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
    archivedUrl: `https://web.archive.org/web/${closest.timestamp}id_/${originalUrl}`,
    originalUrl,
    timestamp: closest.timestamp,
    capturedAt: closest.capturedAtDate.toISOString(),
    distanceMs: closest.distanceMs,
  };
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function getExistingBoxOfficeSourceUrl(rawSource: unknown): string | null {
  const source = asObjectRecord(rawSource);

  for (const key of [
    "boxOfficeOpeningSnapshot",
    "boxOfficeClosingSnapshot",
    "boxOfficeCurrent",
    "boxOfficeBaseline",
  ]) {
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

function needsWaybackBackfill(row: BackfillCandidateRow, now: Date, force: boolean): boolean {
  if (row.dataStatus === "MANUAL_OVERRIDE") {
    return false;
  }

  if (row.week.endAt.getTime() >= now.getTime()) {
    return false;
  }

  if (force) {
    return true;
  }

  const opening = getStoredBoxOfficeSnapshot(row.rawSource, BOX_OFFICE_OPENING_SNAPSHOT_KEY);
  const closing = getStoredBoxOfficeSnapshot(row.rawSource, BOX_OFFICE_CLOSING_SNAPSHOT_KEY);
  if (!opening || !closing) {
    return true;
  }

  return asObjectRecord(row.rawSource).estimatedMonthlyFromCumulative === true;
}

async function resolveWaybackSnapshot(pageUrl: string, targetAt: Date, maxDistanceHours: number): Promise<WaybackSnapshotMatch | null> {
  const calendarUrl = new URL(WAYBACK_CALENDAR_CAPTURES_URL);
  calendarUrl.searchParams.set("url", pageUrl);
  calendarUrl.searchParams.set("date", String(targetAt.getUTCFullYear()));

  const response = await fetch(calendarUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (MovieGameBot/1.0)",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Wayback calendarcaptures lookup failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as WaybackCalendarCapturesResponse;
  return getClosestWaybackSnapshot(payload, pageUrl, targetAt, maxDistanceHours);
}

async function fetchWaybackGross(pageUrl: string, targetAt: Date, maxDistanceHours: number): Promise<{
  cumulativeWorldwideGrossUsd: number;
  asOfDate: string;
  sourceUrl: string;
  providerName: string;
  estimated: boolean;
  raw: unknown;
}> {
  const match = await resolveWaybackSnapshot(pageUrl, targetAt, maxDistanceHours);
  if (!match) {
    throw new Error(`No archived Box Office Mojo snapshot found within ${maxDistanceHours}h of ${targetAt.toISOString()}`);
  }

  const response = await fetch(match.archivedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (MovieGameBot/1.0)",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Wayback snapshot fetch failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const parsed = extractWorldwideGrossFromHtml(html);

  return {
    cumulativeWorldwideGrossUsd: parsed.gross,
    asOfDate: match.capturedAt,
    sourceUrl: pageUrl,
    providerName: "wayback-archive",
    estimated: false,
    raw: {
      archivedUrl: match.archivedUrl,
      archivedTimestamp: match.timestamp,
      distanceMs: match.distanceMs,
      parsedFrom: parsed.parsedFrom,
    },
  };
}

function buildStoredSnapshot(
  input:
    | {
        cumulativeWorldwideGrossUsd: number;
        asOfDate: string;
        sourceUrl: string;
        providerName: string;
        estimated: boolean;
        raw: unknown;
      }
    | {
        cumulativeWorldwideGrossUsd: number;
        asOfDate: string;
        notReleasedYet: true;
        releaseDate: string | null;
      },
  capturedAt: Date,
): Record<string, unknown> {
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

function withStoredSnapshot(rawSource: unknown, key: string, snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    ...asObjectRecord(rawSource),
    [key]: snapshot,
  };
}

async function loadCandidateRows(options: WaybackBackfillOptions): Promise<BackfillCandidateRow[]> {
  return prisma.movieWeekStat.findMany({
    where: {
      ...(options.leagueId ? { leagueId: options.leagueId } : {}),
      ...(options.weekId ? { weekId: options.weekId } : {}),
      ...(options.movieId ? { movieId: options.movieId } : {}),
    },
    select: {
      id: true,
      leagueId: true,
      weekId: true,
      dataStatus: true,
      rawSource: true,
      movie: {
        select: {
          id: true,
          title: true,
          externalTmdbMovieId: true,
          theatricalReleaseDate: true,
        },
      },
      week: {
        select: {
          id: true,
          index: true,
          startAt: true,
          endAt: true,
        },
      },
      league: {
        select: {
          id: true,
          seasonYear: true,
          timezone: true,
        },
      },
    },
    orderBy: [{ leagueId: "asc" }, { weekId: "asc" }, { movieId: "asc" }],
  });
}

export async function backfillMonthlyBoxOfficeSnapshotsFromWayback(
  options: WaybackBackfillOptions = {},
): Promise<WaybackBackfillSummary> {
  const now = new Date();
  const maxDistanceHours = options.maxDistanceHours ?? DEFAULT_MAX_DISTANCE_HOURS;
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const rows = await loadCandidateRows(options);
  const failures: WaybackBackfillSummary["failures"] = [];
  const touchedWeeks = new Set<string>();

  let candidateRows = 0;
  let updatedRows = 0;
  let skippedRows = 0;

  for (const row of rows) {
    if (!needsWaybackBackfill(row, now, force)) {
      skippedRows += 1;
      continue;
    }

    candidateRows += 1;

    const { startAt, endAt } = getWeekBoundsClampedToSeason(
      row.week.startAt,
      row.week.endAt,
      row.league.seasonYear,
      row.league.timezone,
    );

    const sourceUrl =
      getExistingBoxOfficeSourceUrl(row.rawSource) ??
      (await getBoxOfficeMojoTitleUrlForMovie({
        tmdbMovieId: row.movie.externalTmdbMovieId,
        title: row.movie.title,
        releaseDate: row.movie.theatricalReleaseDate,
      }));

    if (!sourceUrl && row.movie.theatricalReleaseDate && row.movie.theatricalReleaseDate.getTime() <= endAt.getTime()) {
      failures.push({
        statId: row.id,
        movieTitle: row.movie.title,
        reason: "Could not resolve Box Office Mojo URL for Wayback lookup",
      });
      continue;
    }

    const openingExists = !force && getStoredBoxOfficeSnapshot(row.rawSource, BOX_OFFICE_OPENING_SNAPSHOT_KEY);
    const closingExists = !force && getStoredBoxOfficeSnapshot(row.rawSource, BOX_OFFICE_CLOSING_SNAPSHOT_KEY);
    let nextRawSource = asObjectRecord(row.rawSource);
    let changed = false;

    try {
      if (!openingExists) {
        const snapshot =
          row.movie.theatricalReleaseDate && row.movie.theatricalReleaseDate.getTime() > startAt.getTime()
            ? buildStoredSnapshot(
                {
                  cumulativeWorldwideGrossUsd: 0,
                  asOfDate: startAt.toISOString(),
                  notReleasedYet: true,
                  releaseDate: row.movie.theatricalReleaseDate.toISOString(),
                },
                now,
              )
            : buildStoredSnapshot(await fetchWaybackGross(sourceUrl ?? "", startAt, maxDistanceHours), now);

        nextRawSource = withStoredSnapshot(nextRawSource, BOX_OFFICE_OPENING_SNAPSHOT_KEY, snapshot);
        changed = true;
      }

      if (!closingExists) {
        const snapshot =
          row.movie.theatricalReleaseDate && row.movie.theatricalReleaseDate.getTime() > endAt.getTime()
            ? buildStoredSnapshot(
                {
                  cumulativeWorldwideGrossUsd: 0,
                  asOfDate: endAt.toISOString(),
                  notReleasedYet: true,
                  releaseDate: row.movie.theatricalReleaseDate.toISOString(),
                },
                now,
              )
            : buildStoredSnapshot(await fetchWaybackGross(sourceUrl ?? "", endAt, maxDistanceHours), now);

        nextRawSource = withStoredSnapshot(nextRawSource, BOX_OFFICE_CLOSING_SNAPSHOT_KEY, snapshot);
        changed = true;
      }
    } catch (error) {
      failures.push({
        statId: row.id,
        movieTitle: row.movie.title,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!changed) {
      skippedRows += 1;
      continue;
    }

    if (!dryRun) {
      await prisma.movieWeekStat.update({
        where: { id: row.id },
        data: {
          rawSource: nextRawSource as Prisma.InputJsonValue,
          snapshotAt: now,
        },
      });
    }

    touchedWeeks.add(`${row.leagueId}:${row.weekId}`);
    updatedRows += 1;
  }

  if (!dryRun) {
    for (const key of touchedWeeks) {
      const [leagueId, weekId] = key.split(":");
      const row = rows.find((item) => item.leagueId === leagueId && item.weekId === weekId);
      if (!row) {
        continue;
      }

      if (row.week.endAt.getTime() < now.getTime()) {
        await finalizeWeekScoring(leagueId, weekId);
      } else {
        await refreshWeekScoring(leagueId, weekId, now);
      }
    }
  }

  return {
    scannedRows: rows.length,
    candidateRows,
    updatedRows,
    recomputedWeeks: dryRun ? 0 : touchedWeeks.size,
    skippedRows,
    failures,
  };
}

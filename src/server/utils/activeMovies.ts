import { DateTime } from "luxon";

export interface TheatricalWindow {
  startAt: Date;
  endAt: Date;
}

function eligibilityBounds(seasonYear: number): { start: DateTime; end: DateTime } {
  const start = DateTime.utc(seasonYear, 1, 1, 0, 0, 0);
  const end = DateTime.utc(seasonYear, 12, 31, 23, 59, 59);
  return { start, end };
}

export function getActiveTheatricalWindowForSeason(
  seasonYear: number,
): TheatricalWindow {
  const { start, end } = eligibilityBounds(seasonYear);
  return {
    startAt: start.toUTC().toJSDate(),
    endAt: end.toUTC().toJSDate(),
  };
}

export function toIsoDate(date: Date): string {
  return DateTime.fromJSDate(date).toUTC().toISODate() ?? "";
}

import { DateTime, IANAZone } from "luxon";

export interface LeagueWeekWindow {
  index: number;
  startAt: Date;
  endAt: Date;
}

export interface MonthlyCycleTimes {
  periodStartAt: Date;
  periodEndAt: Date;
  scoringStartAt: Date;
  nominationStartAt: Date;
  nominationEndAt: Date;
  waiverPoolPublishAt: Date;
  claimsStartAt: Date;
  waiverProcessAt: Date | null;
  lineupLockAt: Date;
  cycleEndAt: Date;
}

export function isValidIanaTimezone(timezone: string): boolean {
  return IANAZone.isValidZone(timezone);
}

export function assertValidTimezone(timezone: string): void {
  if (!isValidIanaTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

export function buildSeasonWeeks(seasonYear: number, timezone: string): LeagueWeekWindow[] {
  assertValidTimezone(timezone);

  return Array.from({ length: 12 }, (_, idx) => {
    const monthStart = DateTime.fromObject(
      { year: seasonYear, month: idx + 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
      { zone: timezone },
    ).startOf("month");
    const monthEnd = monthStart.endOf("month");

    return {
      index: idx + 1,
      startAt: monthStart.toUTC().toJSDate(),
      endAt: monthEnd.toUTC().toJSDate(),
    };
  });
}

export function findCurrentWeek<T extends { startAt: Date; endAt: Date }>(
  weeks: T[],
  timezone: string,
  now = DateTime.now().setZone(timezone),
): T | null {
  assertValidTimezone(timezone);
  const instant = now.toUTC();
  return (
    weeks.find((week) => {
      const start = DateTime.fromJSDate(week.startAt).toUTC();
      const end = DateTime.fromJSDate(week.endAt).toUTC();
      return instant >= start && instant <= end;
    }) ?? null
  );
}

export function getWeekBoundsClampedToSeason(
  weekStartAt: Date,
  weekEndAt: Date,
  seasonYear: number,
  timezone: string,
): { startAt: Date; endAt: Date } {
  assertValidTimezone(timezone);
  const seasonStart = DateTime.fromObject(
    { year: seasonYear, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
    { zone: timezone },
  );
  const seasonEnd = DateTime.fromObject(
    { year: seasonYear, month: 12, day: 31, hour: 23, minute: 59, second: 59, millisecond: 999 },
    { zone: timezone },
  );

  const periodStart = DateTime.fromJSDate(weekStartAt).setZone(timezone);
  const periodEnd = DateTime.fromJSDate(weekEndAt).setZone(timezone);

  const startAt = periodStart < seasonStart ? seasonStart : periodStart;
  const endAt = periodEnd > seasonEnd ? seasonEnd : periodEnd;

  return {
    startAt: startAt.toUTC().toJSDate(),
    endAt: endAt.toUTC().toJSDate(),
  };
}

function firstWeekdayOfMonth(monthStart: DateTime, weekday: number): DateTime {
  let cursor = monthStart.startOf("month");
  while (cursor.weekday !== weekday) {
    cursor = cursor.plus({ days: 1 });
  }
  return cursor.startOf("day");
}

export function resolveMonthlyCycleTimes(periodStartAt: Date, timezone: string): MonthlyCycleTimes {
  assertValidTimezone(timezone);

  const periodStart = DateTime.fromJSDate(periodStartAt).setZone(timezone).startOf("month");
  const periodEnd = periodStart.endOf("month");
  const previousMonthStart = periodStart.minus({ months: 1 }).startOf("month");
  const nominationStart = previousMonthStart.set({ day: 25, hour: 0, minute: 0, second: 0, millisecond: 0 });
  const nominationEnd = periodStart.minus({ milliseconds: 1 });
  const waiverPoolPublishAt = periodStart.startOf("day");
  const firstThursdayNoon = firstWeekdayOfMonth(periodStart, 4).set({
    hour: 12,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const firstFridayLock = firstWeekdayOfMonth(periodStart, 5).set({
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 999,
  });

  return {
    periodStartAt: periodStart.toUTC().toJSDate(),
    periodEndAt: periodEnd.toUTC().toJSDate(),
    scoringStartAt: periodStart.toUTC().toJSDate(),
    nominationStartAt: nominationStart.toUTC().toJSDate(),
    nominationEndAt: nominationEnd.toUTC().toJSDate(),
    waiverPoolPublishAt: waiverPoolPublishAt.toUTC().toJSDate(),
    claimsStartAt: waiverPoolPublishAt.toUTC().toJSDate(),
    waiverProcessAt: periodStart.month === 1 ? null : firstThursdayNoon.toUTC().toJSDate(),
    lineupLockAt: firstFridayLock.toUTC().toJSDate(),
    cycleEndAt: periodEnd.toUTC().toJSDate(),
  };
}

export function isLineupLockedForPeriod(periodStartAt: Date, timezone: string, nowInput?: Date): boolean {
  const cycle = resolveMonthlyCycleTimes(periodStartAt, timezone);
  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).toUTC();
  const lockAt = DateTime.fromJSDate(cycle.lineupLockAt).toUTC();
  const periodEnd = DateTime.fromJSDate(cycle.periodEndAt).toUTC();
  return now > lockAt && now <= periodEnd;
}

export function isNominationWindowOpenForPeriod(periodStartAt: Date, timezone: string, nowInput?: Date): boolean {
  const cycle = resolveMonthlyCycleTimes(periodStartAt, timezone);
  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).toUTC();
  const start = DateTime.fromJSDate(cycle.nominationStartAt).toUTC();
  const end = DateTime.fromJSDate(cycle.nominationEndAt).toUTC();
  return now >= start && now <= end;
}

export function isWaiverClaimsWindowOpenForPeriod(periodStartAt: Date, timezone: string, nowInput?: Date): boolean {
  const cycle = resolveMonthlyCycleTimes(periodStartAt, timezone);
  if (!cycle.waiverProcessAt) {
    return false;
  }

  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).toUTC();
  const start = DateTime.fromJSDate(cycle.claimsStartAt).toUTC();
  const end = DateTime.fromJSDate(cycle.waiverProcessAt).toUTC();
  return now >= start && now < end;
}

export function isWaiverPoolPublishedForPeriod(periodStartAt: Date, timezone: string, nowInput?: Date): boolean {
  const cycle = resolveMonthlyCycleTimes(periodStartAt, timezone);
  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).toUTC();
  return now >= DateTime.fromJSDate(cycle.waiverPoolPublishAt).toUTC();
}

export function formatMonthLabel(value: Date, timezone: string): string {
  return DateTime.fromJSDate(value).setZone(timezone).toFormat("LLLL");
}

// Backwards-compatible wrappers while the rest of the app still uses week-based naming.
export function resolveMatchupWindowForWeek(weekStartAt: Date, timezone: string): { startAt: Date; endAt: Date } {
  const cycle = resolveMonthlyCycleTimes(weekStartAt, timezone);
  return {
    startAt: cycle.scoringStartAt,
    endAt: cycle.periodEndAt,
  };
}

export function isMatchupActive(timezone: string, nowInput?: Date): boolean {
  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).setZone(timezone);
  const periodStart = now.startOf("month").toUTC().toJSDate();
  return isLineupLockedForPeriod(periodStart, timezone, nowInput);
}

export function isNominationWindowOpen(timezone: string, nowInput?: Date): boolean {
  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).setZone(timezone);
  const targetPeriodStart =
    now.day >= 25 ? now.plus({ months: 1 }).startOf("month").toUTC().toJSDate() : now.startOf("month").toUTC().toJSDate();
  return isNominationWindowOpenForPeriod(targetPeriodStart, timezone, nowInput);
}

export function isWaiverClaimsWindowOpen(timezone: string, nowInput?: Date): boolean {
  const now = (nowInput ? DateTime.fromJSDate(nowInput) : DateTime.now()).setZone(timezone);
  return isWaiverClaimsWindowOpenForPeriod(now.startOf("month").toUTC().toJSDate(), timezone, nowInput);
}

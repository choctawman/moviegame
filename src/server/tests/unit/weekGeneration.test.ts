import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { buildSeasonWeeks } from "@/server/utils/time";

describe("buildSeasonWeeks", () => {
  it("creates 12 calendar-month periods covering Jan 1 through Dec 31", () => {
    const timezone = "America/New_York";
    const periods = buildSeasonWeeks(2026, timezone);

    expect(periods).toHaveLength(12);

    const jan1 = DateTime.fromObject({ year: 2026, month: 1, day: 1 }, { zone: timezone });
    const dec31 = DateTime.fromObject({ year: 2026, month: 12, day: 31, hour: 23, minute: 59 }, { zone: timezone });

    const firstPeriodStart = DateTime.fromJSDate(periods[0].startAt).setZone(timezone);
    const lastPeriodEnd = DateTime.fromJSDate(periods[periods.length - 1].endAt).setZone(timezone);

    expect(firstPeriodStart.hasSame(jan1, "day")).toBe(true);
    expect(lastPeriodEnd.hasSame(dec31, "day")).toBe(true);
  });

  it("handles leap years without gaps", () => {
    const timezone = "America/Los_Angeles";
    const periods = buildSeasonWeeks(2028, timezone);
    const feb29 = DateTime.fromObject({ year: 2028, month: 2, day: 29, hour: 12 }, { zone: timezone });

    const containsLeapDay = periods.some((period) => {
      const start = DateTime.fromJSDate(period.startAt).setZone(timezone);
      const end = DateTime.fromJSDate(period.endAt).setZone(timezone);
      return feb29 >= start && feb29 <= end;
    });

    expect(containsLeapDay).toBe(true);
  });
});

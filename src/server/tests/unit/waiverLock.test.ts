import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  isLineupLockedForPeriod,
  isNominationWindowOpenForPeriod,
  isWaiverClaimsWindowOpenForPeriod,
} from "@/server/utils/time";

describe("monthly cycle windows", () => {
  it("supports nomination, claims, and lineup lock windows", () => {
    const tz = "America/New_York";
    const aprilStart = DateTime.fromISO("2026-04-01T00:00:00", { zone: tz }).toJSDate();

    const nominationOpen = DateTime.fromISO("2026-03-26T10:00:00", { zone: tz }).toJSDate();
    const claimsOpen = DateTime.fromISO("2026-04-02T09:00:00", { zone: tz }).toJSDate();
    const claimsClosed = DateTime.fromISO("2026-04-02T12:01:00", { zone: tz }).toJSDate();
    const beforeLock = DateTime.fromISO("2026-04-03T20:00:00", { zone: tz }).toJSDate();
    const afterLock = DateTime.fromISO("2026-04-04T00:00:00", { zone: tz }).toJSDate();

    expect(isNominationWindowOpenForPeriod(aprilStart, tz, nominationOpen)).toBe(true);
    expect(isWaiverClaimsWindowOpenForPeriod(aprilStart, tz, claimsOpen)).toBe(true);
    expect(isWaiverClaimsWindowOpenForPeriod(aprilStart, tz, claimsClosed)).toBe(false);
    expect(isLineupLockedForPeriod(aprilStart, tz, beforeLock)).toBe(false);
    expect(isLineupLockedForPeriod(aprilStart, tz, afterLock)).toBe(true);
  });
});

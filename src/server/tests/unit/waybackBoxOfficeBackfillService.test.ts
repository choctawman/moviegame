import { describe, expect, it } from "vitest";

import {
  getClosestWaybackSnapshot,
  parseWaybackTimestamp,
} from "@/server/services/waybackBoxOfficeBackfillService";

describe("waybackBoxOfficeBackfillService", () => {
  it("parses 14-digit wayback timestamps", () => {
    expect(parseWaybackTimestamp("20260301060504")?.toISOString()).toBe("2026-03-01T06:05:04.000Z");
  });

  it("returns null for malformed wayback timestamps", () => {
    expect(parseWaybackTimestamp("2026-03-01")).toBeNull();
  });

  it("accepts the closest archived snapshot within the configured distance", () => {
    expect(
      getClosestWaybackSnapshot(
        {
          items: [
            [303162005, 200, 0],
            [304123220, 200, 1],
          ],
        },
        "https://www.boxofficemojo.com/title/tt1234567/",
        new Date("2026-03-01T06:00:00.000Z"),
        72,
      ),
    ).toMatchObject({
      originalUrl: "https://www.boxofficemojo.com/title/tt1234567/",
      timestamp: "20260303162005",
      capturedAt: "2026-03-03T16:20:05.000Z",
    });
  });

  it("rejects archived snapshots outside the configured distance window", () => {
    expect(
      getClosestWaybackSnapshot(
        {
          items: [[305060504, 200, 0]],
        },
        "https://www.boxofficemojo.com/title/tt1234567/",
        new Date("2026-03-01T06:00:00.000Z"),
        24,
      ),
    ).toBeNull();
  });
});

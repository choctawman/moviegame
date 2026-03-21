import { Decimal } from "@prisma/client/runtime/library";
import { describe, expect, it } from "vitest";

import {
  calculateBoxOfficePoints,
  calculateMonthlyGrossFromCumulative,
  calculateRtPoints,
  getStoredBoxOfficeSnapshot,
  isReleasedByAsOf,
  isReleasedDuringWindow,
  resolveMatchupResult,
} from "@/server/services/scoringService";

describe("scoring", () => {
  it("calculates decimal box office points", () => {
    expect(calculateBoxOfficePoints(12_345_678)).toBe(12.35);
  });

  it("subtracts already-assigned earlier months from the current cumulative gross", () => {
    expect(calculateMonthlyGrossFromCumulative(120_000_000, 0, 95_000_000)).toBe(25_000_000);
    expect(calculateMonthlyGrossFromCumulative(120_000_000, 80_000_000, 95_000_000)).toBe(25_000_000);
  });

  it("reads stored month-boundary snapshots from rawSource", () => {
    expect(
      getStoredBoxOfficeSnapshot(
        {
          boxOfficeOpeningSnapshot: {
            cumulativeWorldwideGrossUsd: 85_000_000,
            asOfDate: "2026-03-01T06:00:00.000Z",
            capturedAt: "2026-03-01T06:00:30.000Z",
            sourceUrl: "https://example.com/movie",
          },
        },
        "boxOfficeOpeningSnapshot",
      ),
    ).toMatchObject({
      cumulativeWorldwideGrossUsd: 85_000_000,
      asOfDate: "2026-03-01T06:00:00.000Z",
      capturedAt: "2026-03-01T06:00:30.000Z",
      sourceUrl: "https://example.com/movie",
    });
  });

  it("ignores malformed stored boundary snapshots", () => {
    expect(
      getStoredBoxOfficeSnapshot(
        {
          boxOfficeClosingSnapshot: {
            cumulativeWorldwideGrossUsd: "85000000",
            asOfDate: "2026-03-31T05:59:59.999Z",
          },
        },
        "boxOfficeClosingSnapshot",
      ),
    ).toBeNull();
  });

  it("adds RT points from critics + audience", () => {
    expect(calculateRtPoints(80, 90)).toBe(170);
  });

  it("allows zero gross but RT contribution", () => {
    expect(calculateBoxOfficePoints(0)).toBe(0);
    expect(calculateRtPoints(65, 90)).toBe(155);
  });

  it("counts critics-only RT scores", () => {
    expect(calculateRtPoints(97, null)).toBe(97);
  });

  it("counts audience-only RT scores", () => {
    expect(calculateRtPoints(null, 83)).toBe(83);
  });

  it("returns zero only when both RT scores are missing", () => {
    expect(calculateRtPoints(null, null)).toBe(0);
  });

  it("uses RT average as tie-breaker and can resolve to tie", () => {
    expect(resolveMatchupResult(new Decimal(100), new Decimal(100), new Decimal(85), new Decimal(82))).toBe("HOME_WIN");
    expect(resolveMatchupResult(new Decimal(100), new Decimal(100), new Decimal(80), new Decimal(80))).toBe("TIE");
  });

  it("does not count a movie before its release date", () => {
    expect(isReleasedByAsOf(new Date("2026-02-10T00:00:00.000Z"), new Date("2026-02-01T05:59:59.999Z"))).toBe(false);
    expect(isReleasedByAsOf(new Date("2026-02-10T00:00:00.000Z"), new Date("2026-02-10T00:00:00.000Z"))).toBe(true);
  });

  it("treats movies released during the active month as current-month box office", () => {
    expect(
      isReleasedDuringWindow(
        new Date("2026-03-06T00:00:00.000Z"),
        new Date("2026-03-01T06:00:00.000Z"),
        new Date("2026-03-07T18:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isReleasedDuringWindow(
        new Date("2026-02-20T00:00:00.000Z"),
        new Date("2026-03-01T06:00:00.000Z"),
        new Date("2026-03-07T18:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

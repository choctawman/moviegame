import { describe, expect, it } from "vitest";

import { getActiveTheatricalWindowForSeason, toIsoDate } from "@/server/utils/activeMovies";

describe("getActiveTheatricalWindowForSeason", () => {
  it("includes the full season year starting on January 1", () => {
    const window = getActiveTheatricalWindowForSeason(2026);

    expect(toIsoDate(window.startAt)).toBe("2026-01-01");
    expect(toIsoDate(window.endAt)).toBe("2026-12-31");
  });
});

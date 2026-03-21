import { describe, expect, it } from "vitest";

import { BENCH_SLOT_COUNT, ROLE_SLOT_LIMITS } from "@/server/services/constants";

describe("roster slot limits", () => {
  it("has exactly 7 starter slots", () => {
    const totalSlots = Object.values(ROLE_SLOT_LIMITS).reduce((sum, count) => sum + count, 0);
    expect(totalSlots).toBe(7);
  });

  it("has exactly 5 bench slots", () => {
    expect(BENCH_SLOT_COUNT).toBe(5);
  });

  it("has exactly 12 draftable slots", () => {
    const starterSlots = Object.values(ROLE_SLOT_LIMITS).reduce((sum, count) => sum + count, 0);
    expect(starterSlots + BENCH_SLOT_COUNT).toBe(12);
  });

  it("has exactly 2 supporting slots", () => {
    expect(ROLE_SLOT_LIMITS.SUPPORTING).toBe(2);
  });
});

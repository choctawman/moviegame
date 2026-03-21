import { describe, expect, it } from "vitest";

import { getNextAutopickRole, selectAutopickCandidate } from "@/server/services/draftAutopick";

describe("autopick", () => {
  it("chooses next unfilled role in deterministic role order", () => {
    const nextRole = getNextAutopickRole([
      { role: "LEADING_ACTOR", fantasyPlayerId: "a" },
      { role: "LEADING_ACTOR", fantasyPlayerId: null },
      { role: "LEADING_ACTRESS", fantasyPlayerId: null },
      { role: "SUPPORTING", fantasyPlayerId: null },
      { role: "SUPPORTING", fantasyPlayerId: null },
      { role: "DIRECTOR", fantasyPlayerId: null },
      { role: "BENCH", fantasyPlayerId: null },
    ]);

    expect(nextRole).toBe("LEADING_ACTOR");
  });

  it("moves to bench once all starter roles are filled", () => {
    const nextRole = getNextAutopickRole([
      { role: "LEADING_ACTOR", fantasyPlayerId: "a1" },
      { role: "LEADING_ACTOR", fantasyPlayerId: "a2" },
      { role: "LEADING_ACTRESS", fantasyPlayerId: "b1" },
      { role: "LEADING_ACTRESS", fantasyPlayerId: "b2" },
      { role: "SUPPORTING", fantasyPlayerId: "c1" },
      { role: "SUPPORTING", fantasyPlayerId: "c2" },
      { role: "DIRECTOR", fantasyPlayerId: "d1" },
      { role: "BENCH", fantasyPlayerId: null },
    ]);

    expect(nextRole).toBe("BENCH");
  });

  it("sorts by earliest release date then name then id", () => {
    const picked = selectAutopickCandidate([
      {
        fantasyPlayerId: "c",
        role: "LEADING_ACTOR",
        personName: "Zane",
        earliestReleaseDate: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        fantasyPlayerId: "a",
        role: "LEADING_ACTOR",
        personName: "Alice",
        earliestReleaseDate: new Date("2026-03-01T00:00:00.000Z"),
      },
      {
        fantasyPlayerId: "b",
        role: "LEADING_ACTOR",
        personName: "Aaron",
        earliestReleaseDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    ]);

    expect(picked?.fantasyPlayerId).toBe("b");
  });
});

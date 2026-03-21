import { describe, expect, it } from "vitest";

import { compareFaabClaims, pickWinningFaabClaim } from "@/server/services/waiverResolver";

describe("waiver resolution", () => {
  it("awards a player to the highest bid", () => {
    const winner = pickWinningFaabClaim([
      {
        id: "c1",
        teamId: "team-a",
        addFantasyPlayerId: "fp-1",
        priorityIndex: 0,
        bidAmount: 12,
        targetRosterSlotId: "slot-1",
        createdAt: "2026-03-06T12:00:00.000Z",
        recordWins: 2,
        recordLosses: 1,
        recordTies: 0,
      },
      {
        id: "c2",
        teamId: "team-b",
        addFantasyPlayerId: "fp-1",
        priorityIndex: 0,
        bidAmount: 27,
        targetRosterSlotId: "slot-2",
        createdAt: "2026-03-06T12:01:00.000Z",
        recordWins: 0,
        recordLosses: 3,
        recordTies: 0,
      },
    ]);

    expect(winner?.id).toBe("c2");
  });

  it("breaks tied bids by worse matchup record before submission time", () => {
    const sorted = [
      {
        id: "c1",
        teamId: "team-a",
        addFantasyPlayerId: "fp-1",
        priorityIndex: 0,
        bidAmount: 18,
        targetRosterSlotId: "slot-1",
        createdAt: "2026-03-06T12:01:00.000Z",
        recordWins: 3,
        recordLosses: 1,
        recordTies: 0,
      },
      {
        id: "c2",
        teamId: "team-b",
        addFantasyPlayerId: "fp-1",
        priorityIndex: 0,
        bidAmount: 18,
        targetRosterSlotId: "slot-2",
        createdAt: "2026-03-06T12:02:00.000Z",
        recordWins: 1,
        recordLosses: 3,
        recordTies: 0,
      },
    ].sort(compareFaabClaims);

    expect(sorted.map((claim) => claim.id)).toEqual(["c2", "c1"]);
  });

  it("breaks exact record ties by earliest submission", () => {
    const sorted = [
      {
        id: "c1",
        teamId: "team-a",
        addFantasyPlayerId: "fp-1",
        priorityIndex: 0,
        bidAmount: 18,
        targetRosterSlotId: "slot-1",
        createdAt: "2026-03-06T12:02:00.000Z",
        recordWins: 2,
        recordLosses: 2,
        recordTies: 0,
      },
      {
        id: "c2",
        teamId: "team-b",
        addFantasyPlayerId: "fp-1",
        priorityIndex: 0,
        bidAmount: 18,
        targetRosterSlotId: "slot-2",
        createdAt: "2026-03-06T12:01:00.000Z",
        recordWins: 2,
        recordLosses: 2,
        recordTies: 0,
      },
    ].sort(compareFaabClaims);

    expect(sorted.map((claim) => claim.id)).toEqual(["c2", "c1"]);
  });
});

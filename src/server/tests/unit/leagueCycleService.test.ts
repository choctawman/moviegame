import { describe, expect, it } from "vitest";

import { buildMatchupSummaryBody, resolveDailyStatsRefreshDate } from "@/server/services/leagueCycleService";
import { buildSeasonWeeks } from "@/server/utils/time";

describe("resolveDailyStatsRefreshDate", () => {
  it("does not enqueue before local noon", () => {
    const timezone = "America/Chicago";
    const weeks = buildSeasonWeeks(2026, timezone).map((week) => ({ ...week, id: `week-${week.index}` }));

    expect(
      resolveDailyStatsRefreshDate(
        { timezone, weeks },
        new Date("2026-03-07T17:59:59.000Z"),
      ),
    ).toBeNull();
  });

  it("enqueues once the league reaches local noon", () => {
    const timezone = "America/Chicago";
    const weeks = buildSeasonWeeks(2026, timezone).map((week) => ({ ...week, id: `week-${week.index}` }));

    expect(
      resolveDailyStatsRefreshDate(
        { timezone, weeks },
        new Date("2026-03-07T18:00:00.000Z"),
      ),
    ).toBe("2026-03-07");
  });
});

describe("buildMatchupSummaryBody", () => {
  it("summarizes winners plus top and bottom scorers", () => {
    const body = buildMatchupSummaryBody({
      matchups: [
        {
          homeTeamName: "Opening Weekend",
          awayTeamName: "Commissioner Team",
          homeScoreTotal: 117.25,
          awayScoreTotal: 101.5,
          homeRtAvg: 82.4,
          awayRtAvg: 79.1,
          result: "HOME_WIN",
        },
        {
          homeTeamName: "Critics Cut",
          awayTeamName: "Lucky Losers",
          homeScoreTotal: 96,
          awayScoreTotal: 96,
          homeRtAvg: 88,
          awayRtAvg: 81,
          result: "HOME_WIN",
        },
      ],
      teamPerformances: [
        { teamName: "Opening Weekend", totalPoints: 117.25 },
        { teamName: "Commissioner Team", totalPoints: 101.5 },
        { teamName: "Critics Cut", totalPoints: 96 },
        { teamName: "Lucky Losers", totalPoints: 96 },
      ],
      playerPerformances: [
        { playerName: "Greta Gerwig", teamName: "Opening Weekend", totalPoints: 41.25 },
        { playerName: "Christopher Nolan", teamName: "Critics Cut", totalPoints: 37 },
        { playerName: "Florence Pugh", teamName: "Lucky Losers", totalPoints: 33.5 },
        { playerName: "Dakota Johnson", teamName: "Commissioner Team", totalPoints: 2 },
        { playerName: "Sydney Sweeney", teamName: "Commissioner Team", totalPoints: 0 },
        { playerName: "Aaron Taylor-Johnson", teamName: "Lucky Losers", totalPoints: 4.75 },
      ],
    });

    expect(body).toContain("Results:");
    expect(body).toContain("Opening Weekend beat Commissioner Team 117.25-101.50.");
    expect(body).toContain("Critics Cut beat Lucky Losers 96.00-96.00 on RT tiebreak.");
    expect(body).toContain("Highest team score: Opening Weekend with 117.25.");
    expect(body).toContain(
      "Top scorers: Greta Gerwig (Opening Weekend, 41.25); Christopher Nolan (Critics Cut, 37.00); Florence Pugh (Lucky Losers, 33.50).",
    );
    expect(body).toContain(
      "Lowest scorers: Sydney Sweeney (Commissioner Team, 0.00); Dakota Johnson (Commissioner Team, 2.00); Aaron Taylor-Johnson (Lucky Losers, 4.75).",
    );
  });

  it("falls back cleanly when no matchups were finalized", () => {
    const body = buildMatchupSummaryBody({
      matchups: [],
      teamPerformances: [],
      playerPerformances: [],
    });

    expect(body).toBe("No matchups finalized.");
  });
});

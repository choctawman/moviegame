import { describe, expect, it } from "vitest";

import {
  addCreditToFameSignal,
  addDirectedMovieToDirectorFameSignal,
  computeDirectorFameScore,
  computeFameScore,
  createEmptyDirectorFameSignal,
  createEmptyFameSignal,
} from "@/server/utils/fameScore";

describe("fameScore", () => {
  it("counts credit buckets correctly", () => {
    const signal = createEmptyFameSignal();
    addCreditToFameSignal(signal, { creditType: "CAST", billingOrder: 0, job: null });
    addCreditToFameSignal(signal, { creditType: "CAST", billingOrder: 1, job: null });
    addCreditToFameSignal(signal, { creditType: "CAST", billingOrder: 4, job: null });
    addCreditToFameSignal(signal, { creditType: "CAST", billingOrder: 9, job: null });
    addCreditToFameSignal(signal, { creditType: "CREW", billingOrder: null, job: "Director" });
    addCreditToFameSignal(signal, { creditType: "CREW", billingOrder: null, job: "Producer" });

    expect(signal).toEqual({
      leadTopBilledCount: 1,
      coLeadCount: 1,
      prominentSupportingCount: 1,
      otherCastCount: 1,
      directorCount: 1,
    });
  });

  it("uses both popularity and role history", () => {
    const leadHeavy = createEmptyFameSignal();
    addCreditToFameSignal(leadHeavy, { creditType: "CAST", billingOrder: 0, job: null });
    addCreditToFameSignal(leadHeavy, { creditType: "CAST", billingOrder: 0, job: null });

    const trendyButThin = createEmptyFameSignal();
    addCreditToFameSignal(trendyButThin, { creditType: "CAST", billingOrder: 1, job: null });
    addCreditToFameSignal(trendyButThin, { creditType: "CAST", billingOrder: 3, job: null });

    const leadHeavyScore = computeFameScore(16, leadHeavy);
    const trendyButThinScore = computeFameScore(30, trendyButThin);

    expect(leadHeavyScore).toBeGreaterThan(trendyButThinScore);
  });

  it("handles missing popularity", () => {
    const signal = createEmptyFameSignal();
    addCreditToFameSignal(signal, { creditType: "CREW", billingOrder: null, job: "Director" });

    expect(computeFameScore(null, signal)).toBeGreaterThan(0);
    expect(computeFameScore(undefined, signal)).toBeGreaterThan(0);
  });

  it("prefers directors with stronger casts over actor-directors with weak projects", () => {
    const actorDirector = createEmptyDirectorFameSignal();
    addDirectedMovieToDirectorFameSignal(actorDirector, { castFameScore: 4 });

    const establishedDirector = createEmptyDirectorFameSignal();
    addDirectedMovieToDirectorFameSignal(establishedDirector, { castFameScore: 18 });

    const actorDirectorScore = computeDirectorFameScore(28, actorDirector);
    const establishedDirectorScore = computeDirectorFameScore(9, establishedDirector);

    expect(establishedDirectorScore).toBeGreaterThan(actorDirectorScore);
  });

  it("ignores extra movies when the strongest cast does not improve", () => {
    const oneMovie = createEmptyDirectorFameSignal();
    addDirectedMovieToDirectorFameSignal(oneMovie, { castFameScore: 10 });

    const twoMovies = createEmptyDirectorFameSignal();
    addDirectedMovieToDirectorFameSignal(twoMovies, { castFameScore: 10 });
    addDirectedMovieToDirectorFameSignal(twoMovies, { castFameScore: 8 });

    expect(computeDirectorFameScore(8, twoMovies)).toBe(computeDirectorFameScore(8, oneMovie));
  });

  it("treats cast strength as more important than extra directing volume", () => {
    const weakerButMoreMovies = createEmptyDirectorFameSignal();
    addDirectedMovieToDirectorFameSignal(weakerButMoreMovies, { castFameScore: 8 });
    addDirectedMovieToDirectorFameSignal(weakerButMoreMovies, { castFameScore: 8 });

    const strongerCast = createEmptyDirectorFameSignal();
    addDirectedMovieToDirectorFameSignal(strongerCast, { castFameScore: 20 });

    expect(computeDirectorFameScore(8, strongerCast)).toBeGreaterThan(
      computeDirectorFameScore(8, weakerButMoreMovies),
    );
  });
});

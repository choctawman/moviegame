export interface FameSignal {
  leadTopBilledCount: number;
  coLeadCount: number;
  prominentSupportingCount: number;
  otherCastCount: number;
  directorCount: number;
}

export interface DirectorFameSignal {
  strongestDirectedMovieCastFame: number;
}

export function createEmptyFameSignal(): FameSignal {
  return {
    leadTopBilledCount: 0,
    coLeadCount: 0,
    prominentSupportingCount: 0,
    otherCastCount: 0,
    directorCount: 0,
  };
}

export function createEmptyDirectorFameSignal(): DirectorFameSignal {
  return {
    strongestDirectedMovieCastFame: 0,
  };
}

export function addCreditToFameSignal(
  signal: FameSignal,
  credit: { creditType: "CAST" | "CREW"; billingOrder: number | null; job: string | null },
): void {
  if (credit.creditType === "CAST") {
    if (credit.billingOrder === 0) {
      signal.leadTopBilledCount += 1;
      return;
    }
    if (credit.billingOrder === 1) {
      signal.coLeadCount += 1;
      return;
    }
    if (credit.billingOrder != null && credit.billingOrder <= 5) {
      signal.prominentSupportingCount += 1;
      return;
    }
    signal.otherCastCount += 1;
    return;
  }

  if (credit.creditType === "CREW" && credit.job === "Director") {
    signal.directorCount += 1;
  }
}

export function computeFameScore(tmdbPopularity: number | null | undefined, signal: FameSignal): number {
  const safePopularity =
    typeof tmdbPopularity === "number" && Number.isFinite(tmdbPopularity) ? Math.max(0, tmdbPopularity) : null;

  // Popularity can be noisy and spike for niche reasons; log scaling avoids single-metric domination.
  const popularityComponent = safePopularity == null ? 0 : Math.log1p(safePopularity) * 4;
  const roleComponent =
    signal.leadTopBilledCount * 5 +
    signal.coLeadCount * 2 +
    signal.prominentSupportingCount * 0.5 +
    signal.otherCastCount * 0.1 +
    signal.directorCount * 3;

  return popularityComponent + roleComponent;
}

export function addDirectedMovieToDirectorFameSignal(
  signal: DirectorFameSignal,
  movie: { castFameScore: number },
): void {
  signal.strongestDirectedMovieCastFame = Math.max(signal.strongestDirectedMovieCastFame, Math.max(0, movie.castFameScore));
}

export function computeDirectorFameScore(
  tmdbPopularity: number | null | undefined,
  signal: DirectorFameSignal,
): number {
  const safePopularity =
    typeof tmdbPopularity === "number" && Number.isFinite(tmdbPopularity) ? Math.max(0, tmdbPopularity) : null;

  // Director ranking should care mostly about the strongest cast they can attract.
  // A busy year should not inflate fame, and actor popularity should leak in very lightly.
  const popularityComponent = safePopularity == null ? 0 : Math.log1p(safePopularity) * 0.9;
  const castComponent = signal.strongestDirectedMovieCastFame * 0.75;

  return popularityComponent + castComponent;
}

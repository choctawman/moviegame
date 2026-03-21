export interface PreviousSeasonPointsWindow {
  previousSeasonYear: number;
  startAt: Date;
  cutoffAt: Date;
}

export function getPreviousSeasonPointsWindow(currentSeasonYear: number): PreviousSeasonPointsWindow {
  const previousSeasonYear = currentSeasonYear - 1;
  return {
    previousSeasonYear,
    startAt: new Date(Date.UTC(previousSeasonYear, 0, 1, 0, 0, 0, 0)),
    cutoffAt: new Date(Date.UTC(previousSeasonYear, 11, 31, 23, 59, 59, 999)),
  };
}

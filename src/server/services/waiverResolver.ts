export interface FaabWaiverClaimInput {
  id: string;
  teamId: string;
  addFantasyPlayerId: string;
  priorityIndex: number;
  bidAmount: number;
  targetRosterSlotId: string | null;
  createdAt: Date | string;
  recordWins: number;
  recordLosses: number;
  recordTies: number;
}

function createdAtMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function compareTeamRecordsForWaiverPriority(a: FaabWaiverClaimInput, b: FaabWaiverClaimInput): number {
  if (a.recordWins !== b.recordWins) {
    return a.recordWins - b.recordWins;
  }

  if (a.recordTies !== b.recordTies) {
    return a.recordTies - b.recordTies;
  }

  if (a.recordLosses !== b.recordLosses) {
    return b.recordLosses - a.recordLosses;
  }

  return 0;
}

export function compareFaabClaims(a: FaabWaiverClaimInput, b: FaabWaiverClaimInput): number {
  if (a.bidAmount !== b.bidAmount) {
    return b.bidAmount - a.bidAmount;
  }

  const recordDelta = compareTeamRecordsForWaiverPriority(a, b);
  if (recordDelta !== 0) {
    return recordDelta;
  }

  const createdAtDelta = createdAtMs(a.createdAt) - createdAtMs(b.createdAt);
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return a.id.localeCompare(b.id);
}

export function pickWinningFaabClaim(claims: FaabWaiverClaimInput[]): FaabWaiverClaimInput | null {
  if (claims.length === 0) {
    return null;
  }

  return [...claims].sort(compareFaabClaims)[0] ?? null;
}

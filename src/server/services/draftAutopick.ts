import type { FantasyRole } from "@prisma/client";

import { AUTOPICK_ROLE_ORDER, type DraftableRosterRole } from "@/server/services/constants";

export interface AutoPickRosterSlot {
  role: FantasyRole;
  fantasyPlayerId: string | null;
}

export interface AutoPickCandidate {
  fantasyPlayerId: string;
  role: FantasyRole;
  personName: string;
  earliestReleaseDate: Date | null;
}

export function getNextAutopickRole(slots: AutoPickRosterSlot[]): DraftableRosterRole | null {
  return AUTOPICK_ROLE_ORDER.find((role) => slots.some((slot) => slot.role === role && !slot.fantasyPlayerId)) ?? null;
}

export function rankAutoPickCandidates(candidates: AutoPickCandidate[]): AutoPickCandidate[] {
  return [...candidates].sort((a, b) => {
    const aTime = a.earliestReleaseDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.earliestReleaseDate?.getTime() ?? Number.MAX_SAFE_INTEGER;

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    const nameCmp = a.personName.localeCompare(b.personName);
    if (nameCmp !== 0) {
      return nameCmp;
    }

    return a.fantasyPlayerId.localeCompare(b.fantasyPlayerId);
  });
}

export function selectAutopickCandidate(candidates: AutoPickCandidate[]): AutoPickCandidate | null {
  return rankAutoPickCandidates(candidates)[0] ?? null;
}

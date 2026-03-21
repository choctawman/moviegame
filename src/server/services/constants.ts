import type { FantasyRole } from "@prisma/client";

export const LEAGUE_TEAM_LIMIT = 6;

export const ACTIVE_FANTASY_ROLES = ["LEADING_ACTOR", "LEADING_ACTRESS", "SUPPORTING", "DIRECTOR"] as const;

export type ActiveFantasyRole = (typeof ACTIVE_FANTASY_ROLES)[number];
export type DraftableRosterRole = ActiveFantasyRole | "BENCH";
export const ACTIVE_FANTASY_ROLES_LIST: FantasyRole[] = [...ACTIVE_FANTASY_ROLES];
export const DRAFTABLE_ROSTER_ROLES: DraftableRosterRole[] = [...ACTIVE_FANTASY_ROLES, "BENCH"];

export function isActiveFantasyRole(role: FantasyRole): role is ActiveFantasyRole {
  return ACTIVE_FANTASY_ROLES.includes(role as ActiveFantasyRole);
}

export const ROLE_SLOT_LIMITS: Record<ActiveFantasyRole, number> = {
  LEADING_ACTOR: 2,
  LEADING_ACTRESS: 2,
  SUPPORTING: 2,
  DIRECTOR: 1,
};

export const BENCH_SLOT_COUNT = 5;

export const AUTOPICK_ROLE_ORDER: DraftableRosterRole[] = [
  "LEADING_ACTOR",
  "LEADING_ACTRESS",
  "SUPPORTING",
  "DIRECTOR",
  "BENCH",
];

export const AUCTION_DEFAULTS = {
  MIN_INCREMENT: 1,
  NOMINATION_SECONDS: 30,
  EXTEND_TO_SECONDS: 10,
};

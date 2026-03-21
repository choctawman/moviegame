import { DraftStatus, DraftType, FantasyRole, LeagueStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ApiError } from "@/server/api/http";
import { ACTIVE_FANTASY_ROLES_LIST, AUCTION_DEFAULTS, DRAFTABLE_ROSTER_ROLES, LEAGUE_TEAM_LIMIT } from "@/server/services/constants";
import { getNextAutopickRole, selectAutopickCandidate } from "@/server/services/draftAutopick";
import { addPlayerToRosterSlot, validateCanAddPlayerToTeam } from "@/server/services/rosterService";
import { generateSeasonSchedule } from "@/server/services/scheduleService";

const CLOCK_KEY_PREFIX = "draft:clock";
const AUCTION_STATE_PREFIX = "draft:auction";

function roleMatchesCredit(role: FantasyRole, credit: { creditType: string; billingOrder: number | null; job: string | null }): boolean {
  if (role === "LEADING_ACTOR" || role === "LEADING_ACTRESS") {
    return credit.creditType === "CAST" && credit.billingOrder != null && credit.billingOrder <= 1;
  }
  if (role === "SUPPORTING") {
    return credit.creditType === "CAST" && credit.billingOrder != null && credit.billingOrder >= 2;
  }
  if (role === "DIRECTOR") {
    return credit.creditType === "CREW" && credit.job === "Director";
  }
  return false;
}

function draftClockKey(leagueId: string): string {
  return `${CLOCK_KEY_PREFIX}:${leagueId}`;
}

function auctionStateKey(leagueId: string): string {
  return `${AUCTION_STATE_PREFIX}:${leagueId}`;
}

async function setDraftClock(leagueId: string, seconds: number): Promise<void> {
  await redis.connect().catch(() => undefined);
  const endsAt = Date.now() + seconds * 1000;
  await redis.set(draftClockKey(leagueId), String(endsAt));
}

async function getDraftClockRemaining(leagueId: string): Promise<number> {
  await redis.connect().catch(() => undefined);
  const endsAtRaw = await redis.get(draftClockKey(leagueId));
  if (!endsAtRaw) {
    return 0;
  }
  const endsAt = Number(endsAtRaw);
  return Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
}

function getRoundAndOverall(pickCount: number, teamCount: number): { round: number; overallPick: number } {
  const overallPick = pickCount + 1;
  const round = Math.ceil(overallPick / teamCount);
  return { round, overallPick };
}

function getSnakeTeamOrder(teamIds: string[], round: number): string[] {
  return round % 2 === 1 ? [...teamIds] : [...teamIds].reverse();
}

async function getDraftWithTeams(leagueId: string) {
  const draft = await prisma.draft.findUnique({
    where: { leagueId },
    include: {
      picks: {
        orderBy: { overallPick: "asc" },
      },
      nominations: {
        orderBy: { nominatedAt: "asc" },
      },
      league: {
        include: {
          settings: true,
          teams: {
            include: {
              rosterSlots: true,
            },
            orderBy: { id: "asc" },
          },
        },
      },
    },
  });

  if (!draft) {
    throw new ApiError(404, "Draft not found");
  }

  return draft;
}

async function getCurrentPickingTeam(leagueId: string): Promise<{ teamId: string; overallPick: number; round: number }> {
  const draft = await getDraftWithTeams(leagueId);
  if (draft.type !== DraftType.SNAKE) {
    throw new ApiError(400, "Current picking team is only valid for snake draft");
  }

  const teamIds = draft.league.teams.map((team) => team.id);
  if (teamIds.length !== LEAGUE_TEAM_LIMIT) {
    throw new ApiError(400, `Snake draft requires ${LEAGUE_TEAM_LIMIT} teams`);
  }

  const { overallPick, round } = getRoundAndOverall(draft.picks.length, teamIds.length);
  const order = getSnakeTeamOrder(teamIds, round);
  const teamId = order[(overallPick - 1) % teamIds.length];

  return { teamId, overallPick, round };
}

async function pickIntoRosterSlot(
  tx: Prisma.TransactionClient,
  leagueId: string,
  teamId: string,
  fantasyPlayerId: string,
): Promise<string> {
  const placement = await validateCanAddPlayerToTeam(leagueId, teamId, fantasyPlayerId, null, tx);
  await addPlayerToRosterSlot(placement.openSlotId, fantasyPlayerId, tx);
  return placement.openSlotId;
}

async function isDraftComplete(leagueId: string): Promise<boolean> {
  const openSlot = await prisma.rosterSlot.findFirst({
    where: {
      team: { leagueId },
      role: { in: DRAFTABLE_ROSTER_ROLES },
      fantasyPlayerId: null,
    },
  });

  return !openSlot;
}

async function findAutoPickCandidate(leagueId: string, teamId: string): Promise<string> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      league: true,
      rosterSlots: true,
    },
  });

  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const nextRole = getNextAutopickRole(team.rosterSlots);

  if (!nextRole) {
    throw new ApiError(400, "No open roster slot found for auto-pick");
  }

  const ownedPlayers = await prisma.rosterSlot.findMany({
    where: {
      team: { leagueId },
      fantasyPlayerId: { not: null },
    },
    select: {
      fantasyPlayerId: true,
    },
  });

  const ownedSet = new Set(ownedPlayers.map((slot) => slot.fantasyPlayerId).filter(Boolean) as string[]);
  const eligibleMovieIds = new Set(
    (
      await prisma.leagueEligibleMovie.findMany({
        where: { leagueId },
        select: { movieId: true },
      })
    ).map((row) => row.movieId),
  );

  const candidates = await prisma.fantasyPlayer.findMany({
    where: {
      role: nextRole === "BENCH" ? { in: ACTIVE_FANTASY_ROLES_LIST } : nextRole,
      id: { notIn: Array.from(ownedSet) },
    },
    include: {
      person: {
        include: {
          credits: {
            include: {
              movie: true,
            },
          },
        },
      },
    },
  });

  const winner = selectAutopickCandidate(
    candidates.map((candidate) => {
      const releases = candidate.person.credits
        .filter((credit) => roleMatchesCredit(candidate.role, credit))
        .filter((credit) => eligibleMovieIds.has(credit.movieId))
        .map((credit) => credit.movie.theatricalReleaseDate)
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime());

      return {
        fantasyPlayerId: candidate.id,
        role: candidate.role,
        personName: candidate.person.name,
        earliestReleaseDate: releases[0] ?? null,
      };
    }),
  );
  if (!winner) {
    throw new ApiError(400, "No draftable player found for auto-pick");
  }

  return winner.fantasyPlayerId;
}

async function saveAuctionState(
  leagueId: string,
  state: { nominationId: string; highBid: number; highBidTeamId: string; endsAt: number },
): Promise<void> {
  await redis.connect().catch(() => undefined);
  await redis.set(auctionStateKey(leagueId), JSON.stringify(state));
}

async function getAuctionState(
  leagueId: string,
): Promise<{ nominationId: string; highBid: number; highBidTeamId: string; endsAt: number } | null> {
  await redis.connect().catch(() => undefined);
  const raw = await redis.get(auctionStateKey(leagueId));
  return raw ? (JSON.parse(raw) as { nominationId: string; highBid: number; highBidTeamId: string; endsAt: number }) : null;
}

export const draftStateService = {
  async startDraft(leagueId: string, type?: DraftType) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { settings: true, teams: true },
    });

    if (!league || !league.settings) {
      throw new ApiError(404, "League not found");
    }

    if (league.teams.length !== LEAGUE_TEAM_LIMIT) {
      throw new ApiError(400, `Draft requires exactly ${LEAGUE_TEAM_LIMIT} teams`);
    }

    const draft = await prisma.draft.upsert({
      where: { leagueId },
      update: {
        type: type ?? league.settings.draftType,
        status: DraftStatus.LIVE,
        startedAt: new Date(),
      },
      create: {
        leagueId,
        type: type ?? league.settings.draftType,
        status: DraftStatus.LIVE,
        startedAt: new Date(),
      },
    });

    await prisma.league.update({
      where: { id: leagueId },
      data: { status: LeagueStatus.DRAFTING },
    });

    await setDraftClock(leagueId, league.settings.pickTimerSeconds);

    return draft;
  },

  async getState(leagueId: string) {
    const draft = await getDraftWithTeams(leagueId);

    let currentPick: { teamId: string; overallPick: number; round: number } | null = null;
    if (draft.type === DraftType.SNAKE && draft.status === DraftStatus.LIVE) {
      currentPick = await getCurrentPickingTeam(leagueId);
    }

    return {
      draft,
      currentPick,
      secondsRemaining: await getDraftClockRemaining(leagueId),
    };
  },

  async makePick({ leagueId, fantasyPlayerId }: { leagueId: string; fantasyPlayerId: string; autoPicked?: boolean }) {
    const draft = await getDraftWithTeams(leagueId);

    if (draft.status !== DraftStatus.LIVE) {
      throw new ApiError(400, "Draft is not live");
    }

    if (draft.type !== DraftType.SNAKE) {
      throw new ApiError(400, "Use bid flow for auction drafts");
    }

    const { teamId, overallPick, round } = await getCurrentPickingTeam(leagueId);

    const pick = await prisma.$transaction(async (tx) => {
      const slotId = await pickIntoRosterSlot(tx, leagueId, teamId, fantasyPlayerId);

      const created = await tx.draftPick.create({
        data: {
          draftId: draft.id,
          overallPick,
          round,
          teamId,
          fantasyPlayerId,
          autoPicked: false,
        },
      });

      await tx.transaction.create({
        data: {
          leagueId,
          type: "ADD",
          teamId,
          fantasyPlayerId,
          rosterSlotId: slotId,
          meta: {
            source: "draft",
          },
        },
      });

      return created;
    });

    await setDraftClock(leagueId, draft.league.settings?.pickTimerSeconds ?? 180);

    if (await isDraftComplete(leagueId)) {
      const existingMatchups = await prisma.matchup.count({ where: { leagueId } });
      if (existingMatchups === 0) {
        await generateSeasonSchedule(leagueId);
      }

      await prisma.draft.update({
        where: { leagueId },
        data: {
          status: DraftStatus.COMPLETE,
          endedAt: new Date(),
        },
      });

      await prisma.league.update({
        where: { id: leagueId },
        data: { status: LeagueStatus.IN_SEASON },
      });
    }

    return pick;
  },

  async autoPick(leagueId: string) {
    const { teamId } = await getCurrentPickingTeam(leagueId);
    const fantasyPlayerId = await findAutoPickCandidate(leagueId, teamId);

    const draft = await getDraftWithTeams(leagueId);
    const { overallPick, round } = await getCurrentPickingTeam(leagueId);

    const pick = await prisma.$transaction(async (tx) => {
      const slotId = await pickIntoRosterSlot(tx, leagueId, teamId, fantasyPlayerId);

      const created = await tx.draftPick.create({
        data: {
          draftId: draft.id,
          overallPick,
          round,
          teamId,
          fantasyPlayerId,
          autoPicked: true,
        },
      });

      await tx.transaction.create({
        data: {
          leagueId,
          type: "ADD",
          teamId,
          fantasyPlayerId,
          rosterSlotId: slotId,
          meta: {
            source: "autopick",
          },
        },
      });

      return created;
    });

    await setDraftClock(leagueId, draft.league.settings?.pickTimerSeconds ?? 180);
    return pick;
  },

  async pause(leagueId: string) {
    await prisma.draft.update({
      where: { leagueId },
      data: {
        status: DraftStatus.PAUSED,
      },
    });
  },

  async resume(leagueId: string) {
    const draft = await prisma.draft.update({
      where: { leagueId },
      data: {
        status: DraftStatus.LIVE,
      },
      include: {
        league: { include: { settings: true } },
      },
    });

    await setDraftClock(leagueId, draft.league.settings?.pickTimerSeconds ?? 180);
  },

  async forcePick({ leagueId, teamId, fantasyPlayerId }: { leagueId: string; teamId: string; fantasyPlayerId: string }) {
    const draft = await getDraftWithTeams(leagueId);
    const pickCount = draft.picks.length;
    const { overallPick, round } = getRoundAndOverall(pickCount, draft.league.teams.length);

    const pick = await prisma.$transaction(async (tx) => {
      const slotId = await pickIntoRosterSlot(tx, leagueId, teamId, fantasyPlayerId);

      const created = await tx.draftPick.create({
        data: {
          draftId: draft.id,
          overallPick,
          round,
          teamId,
          fantasyPlayerId,
          autoPicked: false,
        },
      });

      await tx.transaction.create({
        data: {
          leagueId,
          type: "ADD",
          teamId,
          fantasyPlayerId,
          rosterSlotId: slotId,
          meta: {
            source: "force-pick",
          },
        },
      });

      return created;
    });

    await setDraftClock(leagueId, draft.league.settings?.pickTimerSeconds ?? 180);
    return pick;
  },

  async undoPick(leagueId: string) {
    const draft = await getDraftWithTeams(leagueId);
    const lastPick = draft.picks[draft.picks.length - 1];
    if (!lastPick) {
      throw new ApiError(400, "No picks to undo");
    }

    await prisma.$transaction(async (tx) => {
      await tx.draftPick.delete({ where: { id: lastPick.id } });

      const slot = await tx.rosterSlot.findFirst({
        where: {
          teamId: lastPick.teamId,
          fantasyPlayerId: lastPick.fantasyPlayerId,
        },
        orderBy: {
          slotIndex: "desc",
        },
      });

      if (slot) {
        await tx.rosterSlot.update({
          where: { id: slot.id },
          data: { fantasyPlayerId: null },
        });
      }
    });
  },

  async nominate({
    leagueId,
    fantasyPlayerId,
    nominatingTeamId,
  }: {
    leagueId: string;
    fantasyPlayerId: string;
    nominatingTeamId: string;
  }) {
    const draft = await getDraftWithTeams(leagueId);
    if (draft.type !== DraftType.AUCTION) {
      throw new ApiError(400, "Draft is not auction type");
    }

    const current = await getAuctionState(leagueId);
    if (current && current.endsAt > Date.now()) {
      throw new ApiError(400, "Current nomination still active");
    }

    const nominationTeamId = draft.league.teams.find((team) => team.id === nominatingTeamId)?.id;
    if (!nominationTeamId) {
      throw new ApiError(400, "Invalid nominating team");
    }

    const nomination = await prisma.auctionNomination.create({
      data: {
        draftId: draft.id,
        nominatingTeamId: nominationTeamId,
        fantasyPlayerId,
      },
    });

    await saveAuctionState(leagueId, {
      nominationId: nomination.id,
      highBid: 1,
      highBidTeamId: nominationTeamId,
      endsAt: Date.now() + AUCTION_DEFAULTS.NOMINATION_SECONDS * 1000,
    });

    return nomination;
  },

  async bid({
    leagueId,
    nominationId,
    amount,
    bidTeamId,
  }: {
    leagueId: string;
    nominationId: string;
    amount: number;
    bidTeamId: string;
  }) {
    const draft = await getDraftWithTeams(leagueId);
    if (draft.type !== DraftType.AUCTION) {
      throw new ApiError(400, "Draft is not auction type");
    }

    const auctionState = await getAuctionState(leagueId);
    if (!auctionState || auctionState.nominationId !== nominationId) {
      throw new ApiError(400, "Nomination is not active");
    }

    if (amount < auctionState.highBid + AUCTION_DEFAULTS.MIN_INCREMENT) {
      throw new ApiError(400, `Minimum next bid is ${auctionState.highBid + AUCTION_DEFAULTS.MIN_INCREMENT}`);
    }

    if (!draft.league.teams.some((team) => team.id === bidTeamId)) {
      throw new ApiError(400, "Invalid bidding team");
    }

    await prisma.auctionBid.create({
      data: {
        nominationId,
        teamId: bidTeamId,
        amount,
      },
    });

    let endsAt = auctionState.endsAt;
    const remainingSeconds = Math.floor((auctionState.endsAt - Date.now()) / 1000);
    if (remainingSeconds <= AUCTION_DEFAULTS.EXTEND_TO_SECONDS) {
      endsAt = Date.now() + AUCTION_DEFAULTS.EXTEND_TO_SECONDS * 1000;
    }

    await saveAuctionState(leagueId, {
      nominationId,
      highBid: amount,
      highBidTeamId: bidTeamId,
      endsAt,
    });

    return {
      nominationId,
      highBid: amount,
      highBidTeamId: bidTeamId,
      secondsRemaining: Math.max(0, Math.floor((endsAt - Date.now()) / 1000)),
    };
  },

  async runAutoPickIfExpired(leagueId: string) {
    const remaining = await getDraftClockRemaining(leagueId);
    if (remaining <= 0) {
      return this.autoPick(leagueId);
    }
    return null;
  },
};

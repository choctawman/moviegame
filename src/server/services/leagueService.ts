import { DraftType, LeagueStatus, MemberRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ApiError } from "@/server/api/http";
import { LEAGUE_TEAM_LIMIT } from "@/server/services/constants";
import { createDefaultRosterSlots } from "@/server/services/rosterService";
import { generateSeasonSchedule } from "@/server/services/scheduleService";
import { generateLeagueWeeks } from "@/server/services/weekService";

interface CreateLeagueInput {
  name: string;
  seasonYear: number;
  timezone: string;
  commissionerUserId: string;
}

export async function createLeague(input: CreateLeagueInput) {
  const league = await prisma.$transaction(async (tx) => {
    const createdLeague = await tx.league.create({
      data: {
        name: input.name,
        seasonYear: input.seasonYear,
        timezone: input.timezone,
        commissionerUserId: input.commissionerUserId,
        status: LeagueStatus.PRE_DRAFT,
        settings: {
          create: {
            draftType: DraftType.SNAKE,
          },
        },
      },
    });

    await tx.leagueMember.create({
      data: {
        leagueId: createdLeague.id,
        userId: input.commissionerUserId,
        role: MemberRole.COMMISSIONER,
      },
    });

    return createdLeague;
  });

  await generateLeagueWeeks(league.id, league.seasonYear, league.timezone);

  return league;
}

interface AddTeamInput {
  leagueId: string;
  ownerUserId: string;
  name: string;
}

export async function addTeamToLeague({ leagueId, ownerUserId, name }: AddTeamInput) {
  return prisma.$transaction(async (tx) => {
    const league = await tx.league.findUnique({ where: { id: leagueId } });
    if (!league) {
      throw new ApiError(404, "League not found");
    }

    if (league.status !== "PRE_DRAFT") {
      throw new ApiError(400, "Cannot add teams after draft has started");
    }

    const existingTeams = await tx.team.count({ where: { leagueId } });
    if (existingTeams >= LEAGUE_TEAM_LIMIT) {
      throw new ApiError(400, "League already has maximum number of teams");
    }

    const team = await tx.team.create({
      data: {
        leagueId,
        ownerUserId,
        name,
      },
    });

    await createDefaultRosterSlots(team.id, tx);

    const existingMembership = await tx.leagueMember.findUnique({
      where: {
        leagueId_userId: {
          leagueId,
          userId: ownerUserId,
        },
      },
    });

    await tx.leagueMember.upsert({
      where: {
        leagueId_userId: {
          leagueId,
          userId: ownerUserId,
        },
      },
      update: {
        teamId: team.id,
        role: existingMembership?.role === "COMMISSIONER" ? "COMMISSIONER" : "PLAYER",
      },
      create: {
        leagueId,
        userId: ownerUserId,
        teamId: team.id,
        role: "PLAYER",
      },
    });

    const teams = await tx.team.findMany({
      where: { leagueId },
      orderBy: { id: "asc" },
      select: { id: true },
    });

    await tx.waiverPriority.upsert({
      where: { leagueId },
      update: { orderedTeamIds: teams.map((item) => item.id) },
      create: {
        leagueId,
        orderedTeamIds: teams.map((item) => item.id),
      },
    });

    return team;
  });
}

export async function transitionLeagueToInSeason(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: true },
  });

  if (!league) {
    throw new ApiError(404, "League not found");
  }

  if (league.teams.length !== LEAGUE_TEAM_LIMIT) {
    throw new ApiError(400, `League needs ${LEAGUE_TEAM_LIMIT} teams before season can start`);
  }

  await generateSeasonSchedule(leagueId);

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      status: LeagueStatus.IN_SEASON,
    },
  });
}

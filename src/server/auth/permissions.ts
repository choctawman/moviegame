import { prisma } from "@/lib/prisma";
import { ApiError } from "@/server/api/http";

export async function requireLeagueMembership(userId: string, leagueId: string) {
  const member = await prisma.leagueMember.findUnique({
    where: {
      leagueId_userId: {
        leagueId,
        userId,
      },
    },
  });

  if (!member) {
    throw new ApiError(403, "Not a member of this league");
  }

  return member;
}

export async function requireLeagueCommissioner(userId: string, leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
  });

  if (!league) {
    throw new ApiError(404, "League not found");
  }

  if (league.commissionerUserId !== userId) {
    throw new ApiError(403, "Commissioner permission required");
  }

  return league;
}

export async function requireTeamOwner(userId: string, teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });

  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  if (team.ownerUserId !== userId) {
    throw new ApiError(403, "Team owner permission required");
  }

  return team;
}

export async function requireTeamOwnerOrLeagueCommissioner(userId: string, teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      league: {
        select: {
          commissionerUserId: true,
        },
      },
    },
  });

  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  if (team.ownerUserId !== userId && team.league.commissionerUserId !== userId) {
    throw new ApiError(403, "Team owner or commissioner permission required");
  }

  return team;
}

export async function requireLeagueCommissionerForTeam(userId: string, teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      league: true,
    },
  });

  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  if (team.league.commissionerUserId !== userId) {
    throw new ApiError(403, "Commissioner permission required");
  }

  return team;
}

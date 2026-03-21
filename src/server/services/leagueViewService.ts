import { prisma } from "@/lib/prisma";
import { normalizeLeagueViewTeamId } from "@/lib/leagueView";

interface LeagueViewTeamSummary {
  id: string;
  name: string;
}

export interface LeagueViewContext {
  membership: {
    teamId: string | null;
  };
  isCommissioner: boolean;
  teams: LeagueViewTeamSummary[];
  activeTeamId: string | null;
  previewTeamId: string | null;
  isPreviewing: boolean;
}

export async function resolveLeagueViewContext({
  leagueId,
  userId,
  requestedTeamId,
}: {
  leagueId: string;
  userId: string;
  requestedTeamId?: string | null;
}): Promise<LeagueViewContext | null> {
  const [membership, league, teams] = await Promise.all([
    prisma.leagueMember.findUnique({
      where: {
        leagueId_userId: {
          leagueId,
          userId,
        },
      },
      select: {
        teamId: true,
      },
    }),
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { commissionerUserId: true },
    }),
    prisma.team.findMany({
      where: { leagueId },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!membership || !league) {
    return null;
  }

  const isCommissioner = league.commissionerUserId === userId;
  const normalizedRequestedTeamId = normalizeLeagueViewTeamId(requestedTeamId);
  const hasRequestedTeam = Boolean(normalizedRequestedTeamId && teams.some((team) => team.id === normalizedRequestedTeamId));
  const requestedPreviewTeamId = isCommissioner && hasRequestedTeam ? normalizedRequestedTeamId : null;
  const previewTeamId = requestedPreviewTeamId && requestedPreviewTeamId !== membership.teamId ? requestedPreviewTeamId : null;

  return {
    membership,
    isCommissioner,
    teams,
    activeTeamId: previewTeamId ?? membership.teamId,
    previewTeamId,
    isPreviewing: previewTeamId != null,
  };
}

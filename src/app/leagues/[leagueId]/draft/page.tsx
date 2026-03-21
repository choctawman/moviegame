import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { DraftRoomManager } from "@/components/DraftRoomManager";
import { LeagueViewSwitcher } from "@/components/LeagueViewSwitcher";
import { tmdbImageUrl } from "@/lib/tmdbImage";
import { getSessionUser } from "@/server/auth/session";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { resolveLeagueViewContext } from "@/server/services/leagueViewService";

export default async function DraftRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ viewTeamId?: string }>;
}) {
  const { leagueId } = await params;
  const { viewTeamId } = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const [viewContext, league, draft] = await Promise.all([
    resolveLeagueViewContext({
      leagueId,
      userId: user.id,
      requestedTeamId: viewTeamId,
    }),
    prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        teams: {
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
      },
    }),
    prisma.draft.findUnique({
      where: { leagueId },
      include: {
        picks: {
          include: {
            team: true,
            fantasyPlayer: { include: { person: true } },
          },
          orderBy: { overallPick: "asc" },
        },
      },
    }),
  ]);

  if (!viewContext || !league) {
    redirect("/");
  }
  const { activeTeamId, isCommissioner, isPreviewing, teams } = viewContext;
  const availablePlayers = await prisma.fantasyPlayer.findMany({
    where: {
      role: { in: ACTIVE_FANTASY_ROLES_LIST },
      person: {
        credits: {
          some: {
            movie: {
              eligibleLeagues: {
                some: { leagueId },
              },
            },
          },
        },
      },
      rosterSlots: {
        none: {
          team: { leagueId },
        },
      },
    },
    include: { person: true },
    orderBy: [{ role: "asc" }, { person: { name: "asc" } }],
    take: 1000,
  });

  return (
    <AppShell
      title="Draft Room"
      headerActions={isCommissioner ? <LeagueViewSwitcher teams={teams} activeTeamId={activeTeamId} isPreviewing={isPreviewing} /> : null}
    >
      <DraftRoomManager
        leagueId={leagueId}
        teams={league.teams}
        canCommissioner={league.commissionerUserId === user.id && !isPreviewing}
        currentTeamId={activeTeamId}
        readOnly={isPreviewing}
        initialDraft={
          draft
            ? {
                id: draft.id,
                type: draft.type,
                status: draft.status,
              }
            : null
        }
        initialPicks={
          draft?.picks.map((pick) => ({
            id: pick.id,
            overallPick: pick.overallPick,
            round: pick.round,
            teamId: pick.team.id,
            teamName: pick.team.name,
            playerName: pick.fantasyPlayer.person.name,
            playerRole: pick.fantasyPlayer.role,
            profileImageUrl: tmdbImageUrl(pick.fantasyPlayer.person.profilePath, "w185"),
            autoPicked: pick.autoPicked,
          })) ?? []
        }
        initialAvailablePlayers={availablePlayers.map((player) => ({
          id: player.id,
          name: player.person.name,
          role: player.role,
          profileImageUrl: tmdbImageUrl(player.person.profilePath, "w185"),
          isAvailable: true,
        }))}
      />
    </AppShell>
  );
}

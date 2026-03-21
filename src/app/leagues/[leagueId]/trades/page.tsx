import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { LeagueViewSwitcher } from "@/components/LeagueViewSwitcher";
import { TradesManager } from "@/components/TradesManager";
import { getSessionUser } from "@/server/auth/session";
import { DRAFTABLE_ROSTER_ROLES } from "@/server/services/constants";
import { resolveLeagueViewContext } from "@/server/services/leagueViewService";

export default async function TradesPage({
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

  const [viewContext, teams, tradeablePlayers, trades] = await Promise.all([
    resolveLeagueViewContext({
      leagueId,
      userId: user.id,
      requestedTeamId: viewTeamId,
    }),
    prisma.team.findMany({
      where: { leagueId },
      select: { id: true, name: true, waiverBudget: true },
      orderBy: { name: "asc" },
    }),
    prisma.rosterSlot.findMany({
      where: {
        team: { leagueId },
        role: { in: DRAFTABLE_ROSTER_ROLES },
        fantasyPlayerId: { not: null },
      },
      include: {
        team: { select: { id: true, name: true } },
        fantasyPlayer: {
          include: {
            person: true,
          },
        },
      },
      orderBy: [{ team: { name: "asc" } }, { role: "asc" }, { slotIndex: "asc" }],
    }),
    prisma.trade.findMany({
      where: { leagueId },
      include: {
        approveVotes: {
          select: {
            teamId: true,
          },
        },
        proposerTeam: true,
        recipientTeam: true,
        vetoVotes: {
          select: {
            teamId: true,
          },
        },
        items: {
          include: {
            fantasyPlayer: { include: { person: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
  ]);

  if (!viewContext) {
    redirect("/");
  }

  const { activeTeamId, isCommissioner, isPreviewing, teams: viewTeams } = viewContext;

  return (
    <AppShell
      title="Trades"
      headerActions={isCommissioner ? <LeagueViewSwitcher teams={viewTeams} activeTeamId={activeTeamId} isPreviewing={isPreviewing} /> : null}
    >
      <TradesManager
        leagueId={leagueId}
        currentTeamId={activeTeamId}
        readOnly={isPreviewing}
        teams={teams}
        tradeablePlayers={tradeablePlayers.flatMap((slot) => {
          if (!slot.fantasyPlayer) {
            return [];
          }

          return [
            {
              teamId: slot.team.id,
              teamName: slot.team.name,
              fantasyPlayerId: slot.fantasyPlayerId!,
              playerName: slot.fantasyPlayer.person.name,
              role: slot.role as (typeof DRAFTABLE_ROSTER_ROLES)[number],
              slotIndex: slot.slotIndex,
            },
          ];
        })}
        trades={trades.map((trade) => ({
          id: trade.id,
          status: trade.status,
          proposerTeamId: trade.proposerTeamId,
          proposerTeamName: trade.proposerTeam.name,
          recipientTeamId: trade.recipientTeamId,
          recipientTeamName: trade.recipientTeam.name,
          reviewEndsAt: trade.reviewEndsAt?.toISOString() ?? null,
          updatedAt: trade.updatedAt.toISOString(),
          approveVoteTeamIds: trade.approveVotes.map((vote) => vote.teamId),
          vetoVoteTeamIds: trade.vetoVotes.map((vote) => vote.teamId),
          items: trade.items.map((item) => ({
            id: item.id,
            fromTeamId: item.fromTeamId,
            fantasyPlayerId: item.fantasyPlayerId,
            playerName: item.fantasyPlayer?.person.name ?? null,
            role: item.rosterSlotRole ?? null,
            slotIndex: item.rosterSlotIndex ?? null,
            faabAmount: item.faabAmount ?? null,
          })),
        }))}
      />
    </AppShell>
  );
}

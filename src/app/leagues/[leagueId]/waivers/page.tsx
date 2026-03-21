import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { LeagueViewSwitcher } from "@/components/LeagueViewSwitcher";
import { WaiverManager } from "@/components/WaiverManager";
import { getSessionUser } from "@/server/auth/session";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { resolveLeagueViewContext } from "@/server/services/leagueViewService";
import { getWaiverStatus } from "@/server/services/waiverService";

export default async function WaiversPage({
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

  const viewContext = await resolveLeagueViewContext({
    leagueId,
    userId: user.id,
    requestedTeamId: viewTeamId,
  });
  if (!viewContext) {
    redirect("/");
  }

  const { activeTeamId, isCommissioner, isPreviewing, teams } = viewContext;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true },
  });
  if (!league) {
    redirect("/");
  }

  const status = await getWaiverStatus(leagueId);
  if (!status.waiverWeekId) {
    return (
      <AppShell title="Waivers">
        <Card>
          <p className="text-sm text-slate-600">No monthly waiver period is available right now.</p>
        </Card>
      </AppShell>
    );
  }

  const [activeTeam, claims, nominationOptions, nominations] = await Promise.all([
    activeTeamId
      ? prisma.team.findUnique({
          where: { id: activeTeamId },
          include: {
            rosterSlots: {
              include: {
                fantasyPlayer: {
                  include: { person: true },
                },
              },
              orderBy: [{ role: "asc" }, { slotIndex: "asc" }],
            },
          },
        })
      : Promise.resolve(null),
    prisma.waiverClaim.findMany({
      where: { leagueId, weekId: status.waiverWeekId },
      include: {
        team: true,
        addFantasyPlayer: { include: { person: true } },
        targetRosterSlot: true,
      },
      orderBy: [{ priorityIndex: "asc" }, { createdAt: "asc" }],
    }),
    prisma.fantasyPlayer.findMany({
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
      include: {
        person: true,
      },
      orderBy: [{ role: "asc" }, { person: { name: "asc" } }],
      take: 1000,
    }),
    prisma.waiverNomination.findMany({
      where: { leagueId, weekId: status.waiverWeekId },
      include: {
        nominatingTeam: true,
        fantasyPlayer: {
          include: {
            person: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);

  const myClaims = claims
    .filter((claim) => claim.teamId === activeTeamId)
    .map((claim) => ({
      id: claim.id,
      status: claim.status,
      priorityIndex: claim.priorityIndex,
      addFantasyPlayerId: claim.addFantasyPlayerId,
      addPlayerName: claim.addFantasyPlayer.person.name,
      bidAmount: claim.bidAmount,
      targetRosterSlotId: claim.targetRosterSlotId ?? "",
      createdAt: claim.createdAt.toISOString(),
    }));

  const myNomination = nominations.find((nomination) => nomination.nominatingTeamId === activeTeamId) ?? null;
  const waiverPoolPlayers = Array.from(
    new Map(
      nominations.map((nomination) => [
        nomination.fantasyPlayerId,
        {
          id: nomination.fantasyPlayerId,
          name: nomination.fantasyPlayer.person.name,
          role: nomination.fantasyPlayer.role,
        },
      ]),
    ).values(),
  );

  const rosterSlots =
    activeTeam?.rosterSlots
      .map((slot) => ({
        id: slot.id,
        role: slot.role,
        slotIndex: slot.slotIndex,
        playerName: slot.fantasyPlayer?.person.name ?? "Empty",
      })) ?? [];

  return (
    <AppShell
      title="Waivers"
      headerActions={isCommissioner ? <LeagueViewSwitcher teams={teams} activeTeamId={activeTeamId} isPreviewing={isPreviewing} /> : null}
    >
      {activeTeamId && activeTeam ? (
        <WaiverManager
          leagueId={leagueId}
          teamBudget={activeTeam.waiverBudget}
          readOnly={isPreviewing}
          claimsOpen={status.claimsOpen}
          nominationsOpen={status.nominationsOpen}
          nextNominationProcessingTime={status.nextNominationProcessingTime}
          nextWaiverProcessingTime={status.nextWaiverProcessingTime}
          nextLineupLockTime={status.nextLineupLockTime}
          waiverPeriodLabel={status.waiverPeriodLabel}
          januaryWaiversSkipped={status.januaryWaiversSkipped}
          nominationOptions={nominationOptions.map((player) => ({
            id: player.id,
            name: player.person.name,
            role: player.role,
          }))}
          waiverPoolPlayers={waiverPoolPlayers}
          nominations={nominations.map((nomination) => ({
            id: nomination.id,
            teamId: nomination.nominatingTeamId,
            teamName: nomination.nominatingTeam.name,
            fantasyPlayerId: nomination.fantasyPlayerId,
            playerName: nomination.fantasyPlayer.person.name,
            role: nomination.fantasyPlayer.role,
          }))}
          myNominationFantasyPlayerId={myNomination?.fantasyPlayerId ?? null}
          waiverPoolPublished={status.waiverPoolPublished}
          rosterSlots={rosterSlots}
          myClaims={myClaims}
        />
      ) : (
        <Card>
          <p className="text-sm text-slate-600">Join a team in this league to submit nominations and waiver claims.</p>
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-semibold">All Claims For {status.waiverPeriodLabel}</h3>
        {claims.length === 0 ? (
          <p className="text-sm text-slate-500">No waiver claims yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {claims.map((claim) => (
              <li key={claim.id} className="rounded-lg bg-slate-50 p-2">
                <p className="font-semibold">{claim.team.name}</p>
                <p>
                  Add {claim.addFantasyPlayer.person.name} for ${claim.bidAmount}
                </p>
                <p className="text-xs text-slate-500">Status: {claim.status}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}

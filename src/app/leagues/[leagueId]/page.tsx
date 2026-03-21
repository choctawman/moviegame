import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { appendLeagueView, normalizeLeagueViewTeamId } from "@/lib/leagueView";
import { InviteManager } from "@/components/InviteManager";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { FantasyLeagueTabs } from "@/components/FantasyLeagueTabs";
import { LeagueViewSwitcher } from "@/components/LeagueViewSwitcher";
import { LeagueLinks } from "@/components/LeagueLinks";
import { RealDataSyncCard } from "@/components/RealDataSyncCard";
import { NotificationFeed } from "@/components/NotificationFeed";
import { getSessionUser } from "@/server/auth/session";
import { getLeagueIngestionStatus } from "@/server/services/ingestionService";

export const dynamic = "force-dynamic";

export default async function LeagueHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ inviteToken?: string; viewTeamId?: string }>;
}) {
  const { leagueId } = await params;
  const { inviteToken, viewTeamId } = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      teams: {
        orderBy: { name: "asc" },
        include: {
          owner: {
            select: {
              email: true,
            },
          },
        },
      },
      weeks: { orderBy: { index: "asc" } },
      members: true,
    },
  });

  if (!league) {
    return <div>League not found</div>;
  }

  const membership = league.members.find((item) => item.userId === user.id) ?? null;
  const isCommissioner = league.commissionerUserId === user.id;
  const isMember = membership != null;
  const requestedViewTeamId = normalizeLeagueViewTeamId(viewTeamId);
  const previewTeamId =
    isMember && isCommissioner && requestedViewTeamId && requestedViewTeamId !== membership?.teamId && league.teams.some((team) => team.id === requestedViewTeamId)
      ? requestedViewTeamId
      : null;
  const activeTeamId = previewTeamId ?? membership?.teamId ?? null;

  const invites = isCommissioner
    ? await prisma.leagueInvite.findMany({
        where: { leagueId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          usedAt: true,
          usedById: true,
        },
      })
    : [];
  const ingestionStatus = isMember ? await getLeagueIngestionStatus(leagueId) : null;
  const notifications = isMember
    ? await prisma.notification.findMany({
        where: { userId: user.id, leagueId },
        orderBy: { createdAt: "desc" },
        take: 8,
      })
    : [];
  const standings = [...league.teams].sort((a, b) => {
    if (b.recordWins !== a.recordWins) {
      return b.recordWins - a.recordWins;
    }
    if (b.recordTies !== a.recordTies) {
      return b.recordTies - a.recordTies;
    }
    return a.recordLosses - b.recordLosses;
  });
  const activeOrNextWeek = league.weeks.find((week) => week.endAt >= new Date()) ?? league.weeks[league.weeks.length - 1] ?? null;

  return (
    <AppShell
      title={league.name}
      hideHeaderText={isMember}
      headerActions={
        isMember && isCommissioner ? (
          <LeagueViewSwitcher
            teams={league.teams.map((team) => ({ id: team.id, name: team.name }))}
            activeTeamId={activeTeamId}
            isPreviewing={previewTeamId != null}
          />
        ) : null
      }
    >
      {isMember ? (
        <FantasyLeagueTabs
          leagueId={leagueId}
          teamId={activeTeamId}
          active="LEAGUE"
          matchHref={activeOrNextWeek ? `/leagues/${leagueId}/matchups/${activeOrNextWeek.id}` : `/leagues/${leagueId}/schedule`}
          viewTeamId={previewTeamId}
        />
      ) : null}

      <section>
        <Card>
          <h2 className="text-xl font-semibold text-white">Standings</h2>
          <div className="mt-4 space-y-3">
            {standings.map((team, index) => {
              const isMyTeam = activeTeamId === team.id;
              return (
                <Link
                  key={team.id}
                  href={appendLeagueView(`/teams/${team.id}/roster`, previewTeamId)}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
                    isMyTeam
                      ? "border-white/20 bg-slate-900/80"
                      : "border-white/10 bg-slate-950/70 hover:bg-slate-900/80"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-slate-900/80 text-sm font-semibold text-white">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white">{team.name}</p>
                      <p className="text-sm text-slate-400">
                        {team.recordWins}-{team.recordLosses}-{team.recordTies}
                        {isMyTeam ? " • Your team" : ""}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-slate-300">{team.recordWins}W</span>
                </Link>
              );
            })}
          </div>
        </Card>
      </section>

      {!isMember ? (
        <Card>
          <InviteManager
            leagueId={leagueId}
            isCommissioner={isCommissioner}
            isMember={false}
            inviteToken={inviteToken}
            initialInvites={invites.map((invite) => ({
              ...invite,
              createdAt: invite.createdAt.toISOString(),
              expiresAt: invite.expiresAt.toISOString(),
              usedAt: invite.usedAt?.toISOString() ?? null,
            }))}
          />
        </Card>
      ) : (
        <>
          <LeagueLinks leagueId={leagueId} viewTeamId={previewTeamId} />

          {(isCommissioner || inviteToken) && (
            <Card>
              <InviteManager
                leagueId={leagueId}
                isCommissioner={isCommissioner}
                isMember
                inviteToken={inviteToken}
                defaultTeamName={membership?.teamId ? "My Team" : `${user.email.split("@")[0]}'s Team`}
                initialInvites={invites.map((invite) => ({
                  ...invite,
                  createdAt: invite.createdAt.toISOString(),
                  expiresAt: invite.expiresAt.toISOString(),
                  usedAt: invite.usedAt?.toISOString() ?? null,
                }))}
              />
            </Card>
          )}

          {ingestionStatus ? (
            <Card>
              <RealDataSyncCard leagueId={leagueId} isCommissioner={isCommissioner} initialStatus={ingestionStatus} />
            </Card>
          ) : null}

          <NotificationFeed
            title="League Notifications"
            notifications={notifications.map((notification) => ({
              id: notification.id,
              title: notification.title,
              body: notification.body,
              createdAt: notification.createdAt.toISOString(),
            }))}
          />
        </>
      )}
    </AppShell>
  );
}

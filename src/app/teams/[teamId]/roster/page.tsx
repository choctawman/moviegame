import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { FantasyLeagueTabs } from "@/components/FantasyLeagueTabs";
import { LeagueViewSwitcher } from "@/components/LeagueViewSwitcher";
import { RosterManager } from "@/components/RosterManager";
import { TeamPager } from "@/components/TeamPager";
import { tmdbImageUrl } from "@/lib/tmdbImage";
import { getSessionUser } from "@/server/auth/session";
import { resolveLeagueViewContext } from "@/server/services/leagueViewService";
import { getCurrentWeekForLeague } from "@/server/services/leagueQueryService";
import { getWaiverStatus } from "@/server/services/waiverService";

function teamInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function displayName(email: string): string {
  return email.split("@")[0] || "Team Owner";
}

function rotateTeamsToAnchor<T extends { id: string }>(teams: T[], anchorTeamId: string | null): T[] {
  if (!anchorTeamId || !teams.some((team) => team.id === anchorTeamId)) {
    return teams;
  }

  return [...teams.filter((team) => team.id === anchorTeamId), ...teams.filter((team) => team.id !== anchorTeamId)];
}

function formatPeriodPoints(pointsBoxOffice: unknown, pointsRt: number | null | undefined): string {
  const boxOffice = Number(pointsBoxOffice ?? 0);
  const rt = Number(pointsRt ?? 0);
  const total = boxOffice + rt;
  return Number.isFinite(total) ? total.toFixed(2) : "0.00";
}

export default async function TeamRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ viewTeamId?: string }>;
}) {
  const { teamId } = await params;
  const { viewTeamId } = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      league: true,
      owner: {
        select: {
          email: true,
          name: true,
        },
      },
      rosterSlots: {
        orderBy: [{ role: "asc" }, { slotIndex: "asc" }],
        include: {
          fantasyPlayer: {
            include: { person: true },
          },
        },
      },
    },
  });

  if (!team) {
    return <div>Team not found</div>;
  }

  const viewContext = await resolveLeagueViewContext({
    leagueId: team.leagueId,
    userId: user.id,
    requestedTeamId: viewTeamId,
  });
  if (!viewContext) {
    redirect("/");
  }

  const { activeTeamId, isCommissioner, isPreviewing, previewTeamId, teams: leagueTeams } = viewContext;
  const [waiverStatus, currentWeek, nextWeek, teams] = await Promise.all([
    getWaiverStatus(team.leagueId),
    getCurrentWeekForLeague(team.leagueId),
    prisma.week.findFirst({
      where: {
        leagueId: team.leagueId,
        endAt: {
          gte: new Date(),
        },
      },
      orderBy: { startAt: "asc" },
      select: { id: true },
    }),
    prisma.team.findMany({
      where: { leagueId: team.leagueId },
      select: { id: true, name: true, ownerUserId: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const lineupOverrideActive = Boolean(currentWeek && team.lineupUnlockWeekId === currentWeek.id);
  const lineupLocked = waiverStatus.lineupLocked && !lineupOverrideActive;
  const canManage = !isPreviewing && (team.ownerUserId === user.id || (isCommissioner && (!waiverStatus.lineupLocked || lineupOverrideActive)));
  const ownerName = team.owner.name ?? displayName(team.owner.email);
  const orderedTeams = rotateTeamsToAnchor(teams, activeTeamId);
  const previousWeek = currentWeek
    ? await prisma.week.findFirst({
        where: {
          leagueId: team.leagueId,
          index: currentWeek.index - 1,
        },
        select: { id: true },
      })
    : null;
  const playerIds = team.rosterSlots
    .map((slot) => slot.fantasyPlayer?.id ?? null)
    .filter(Boolean) as string[];
  const scoreRows =
    currentWeek && playerIds.length > 0
      ? await prisma.fantasyPlayerWeekScore.findMany({
          where: {
            fantasyPlayerId: { in: playerIds },
            weekId: {
              in: [currentWeek.id, previousWeek?.id].filter(Boolean) as string[],
            },
          },
          select: {
            fantasyPlayerId: true,
            weekId: true,
            pointsBoxOffice: true,
            pointsRt: true,
          },
        })
      : [];
  const scoreMap = new Map<string, { current: string; previous: string | null }>();

  for (const playerId of playerIds) {
    const currentScore = scoreRows.find((row) => row.fantasyPlayerId === playerId && row.weekId === currentWeek?.id);
    const previousScore = scoreRows.find((row) => row.fantasyPlayerId === playerId && row.weekId === previousWeek?.id);
    scoreMap.set(playerId, {
      current: formatPeriodPoints(currentScore?.pointsBoxOffice, currentScore?.pointsRt),
      previous: previousScore ? formatPeriodPoints(previousScore.pointsBoxOffice, previousScore.pointsRt) : "0.00",
    });
  }

  return (
    <AppShell
      title={team.name}
      hideHeaderText
      headerActions={isCommissioner ? <LeagueViewSwitcher teams={leagueTeams} activeTeamId={activeTeamId} isPreviewing={isPreviewing} /> : null}
    >
      <FantasyLeagueTabs
        leagueId={team.leagueId}
        teamId={activeTeamId}
        active="TEAM"
        matchHref={nextWeek ? `/leagues/${team.leagueId}/matchups/${nextWeek.id}` : `/leagues/${team.leagueId}/schedule`}
        viewTeamId={previewTeamId}
      />
      <TeamPager
        teams={orderedTeams.map(({ id, name }) => ({ id, name }))}
        currentTeamId={team.id}
        anchorTeamId={activeTeamId}
        viewTeamId={previewTeamId}
      />

      <section className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-white/10 bg-slate-900/80 text-base font-semibold text-white">
            {teamInitials(team.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold text-white">{team.name}</p>
            <p className="truncate text-sm text-slate-400">{ownerName}</p>
          </div>
        </div>
      </section>

      <RosterManager
        leagueId={team.leagueId}
        teamId={team.id}
        canManage={canManage}
        readOnly={isPreviewing}
        lineupLocked={lineupLocked}
        nextLineupLockTime={waiverStatus.nextLineupLockTime}
        canCommissionerOverride={!isPreviewing && isCommissioner && (waiverStatus.lineupLocked || lineupOverrideActive)}
        commissionerOverrideActive={lineupOverrideActive}
        summary={{
          record: `${team.recordWins}-${team.recordLosses}-${team.recordTies}`,
          seasonYear: team.league.seasonYear,
        }}
        slots={team.rosterSlots.map((slot) => ({
          id: slot.id,
          role: slot.role,
          slotIndex: slot.slotIndex,
          playerName: slot.fantasyPlayer?.person.name ?? null,
          playerRole: slot.fantasyPlayer?.role ?? null,
          playerImageUrl: tmdbImageUrl(slot.fantasyPlayer?.person.profilePath, "w185"),
          fantasyPlayerId: slot.fantasyPlayer?.id ?? null,
          currentMonthPoints: slot.fantasyPlayer?.id ? scoreMap.get(slot.fantasyPlayer.id)?.current ?? "0.00" : null,
          previousMonthPoints: slot.fantasyPlayer?.id ? scoreMap.get(slot.fantasyPlayer.id)?.previous ?? null : null,
        }))}
      />
    </AppShell>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { tmdbImageUrl } from "@/lib/tmdbImage";
import { appendLeagueView } from "@/lib/leagueView";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { FantasyLeagueTabs } from "@/components/FantasyLeagueTabs";
import { LeagueViewSwitcher } from "@/components/LeagueViewSwitcher";
import { MatchupCarousel } from "@/components/MatchupCarousel";
import { MonthMatchupPicker } from "@/components/MonthMatchupPicker";
import { ACTIVE_FANTASY_ROLES, ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { getSessionUser } from "@/server/auth/session";
import { resolveLeagueViewContext } from "@/server/services/leagueViewService";
import { formatMonthLabel } from "@/server/utils/time";

const SLOT_ORDER = ACTIVE_FANTASY_ROLES.flatMap((role) =>
  role === "DIRECTOR" ? [`${role}:1`] : [`${role}:1`, `${role}:2`],
);

function formatScore(value: unknown): string {
  if (value == null) {
    return "0.00";
  }
  if (typeof value === "object" && value && "toNumber" in value && typeof (value as { toNumber: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber().toFixed(2);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function formatSlotLabel(role: string, slotIndex: number): string {
  if (role === "LEADING_ACTOR") {
    return slotIndex === 1 ? "Actor 1" : "Actor 2";
  }
  if (role === "LEADING_ACTRESS") {
    return slotIndex === 1 ? "Actress 1" : "Actress 2";
  }
  if (role === "SUPPORTING") {
    return "Supporting";
  }
  if (role === "DIRECTOR") {
    return "Director";
  }
  return role;
}

function formatRecord(team: { recordWins: number; recordLosses: number; recordTies: number }) {
  return `${team.recordWins}-${team.recordLosses}-${team.recordTies}`;
}

function formatPlayerWeekPoints(pointsBoxOffice: unknown, pointsRt: number | null | undefined): string {
  const boxOffice = Number(pointsBoxOffice ?? 0);
  const rt = Number(pointsRt ?? 0);
  const total = boxOffice + rt;
  return Number.isFinite(total) ? total.toFixed(2) : "0.00";
}

function rotateToFront<T>(items: T[], index: number): T[] {
  if (index <= 0 || index >= items.length) {
    return items;
  }

  return [...items.slice(index), ...items.slice(0, index)];
}

function orientMatchupToCurrentTeam<
  T extends {
    homeTeam: { id: string };
    awayTeam: { id: string };
    slotComparisons: Array<{ home: unknown; away: unknown }>;
  },
>(matchup: T, currentTeamId: string | null): T {
  if (!currentTeamId || matchup.homeTeam.id === currentTeamId || matchup.awayTeam.id !== currentTeamId) {
    return matchup;
  }

  return {
    ...matchup,
    homeTeam: matchup.awayTeam,
    awayTeam: matchup.homeTeam,
    slotComparisons: matchup.slotComparisons.map((comparison) => ({
      ...comparison,
      home: comparison.away,
      away: comparison.home,
    })),
  };
}

export default async function LeagueMatchupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string; weekId: string }>;
  searchParams: Promise<{ viewTeamId?: string }>;
}) {
  const { leagueId, weekId } = await params;
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
  const { activeTeamId, isCommissioner, isPreviewing, previewTeamId, teams } = viewContext;

  const week = await prisma.week.findUnique({
    where: { id: weekId },
    include: {
      matchups: {
        where: { leagueId },
        orderBy: { id: "asc" },
        include: {
          homeTeam: {
            include: {
              rosterSlots: {
                where: { role: { in: ACTIVE_FANTASY_ROLES_LIST } },
                orderBy: [{ role: "asc" }, { slotIndex: "asc" }],
                include: {
                  fantasyPlayer: {
                    include: {
                      person: true,
                      playerWeekScores: {
                        where: { leagueId, weekId },
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          },
          awayTeam: {
            include: {
              rosterSlots: {
                where: { role: { in: ACTIVE_FANTASY_ROLES_LIST } },
                orderBy: [{ role: "asc" }, { slotIndex: "asc" }],
                include: {
                  fantasyPlayer: {
                    include: {
                      person: true,
                      playerWeekScores: {
                        where: { leagueId, weekId },
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!week) {
    return <div>Month not found</div>;
  }

  const [league, allWeeks] = await Promise.all([
    prisma.league.findUnique({
    where: { id: leagueId },
    select: { timezone: true },
    }),
    prisma.week.findMany({
      where: { leagueId },
      orderBy: { index: "asc" },
      select: { id: true, index: true, startAt: true },
    }),
  ]);
  if (!league) {
    return <div>League not found</div>;
  }

  const matchupCards = week.matchups.map((matchup) => {
    const homeSlots = new Map<string, (typeof matchup.homeTeam.rosterSlots)[number]>(
      matchup.homeTeam.rosterSlots.map((slot) => [`${slot.role}:${slot.slotIndex}`, slot]),
    );
    const awaySlots = new Map<string, (typeof matchup.awayTeam.rosterSlots)[number]>(
      matchup.awayTeam.rosterSlots.map((slot) => [`${slot.role}:${slot.slotIndex}`, slot]),
    );

    const slotComparisons = SLOT_ORDER.map((slotKey) => {
      const homeSlot = homeSlots.get(slotKey) ?? null;
      const awaySlot = awaySlots.get(slotKey) ?? null;
      const [role, slotIndexRaw] = slotKey.split(":");
      const slotIndex = Number(slotIndexRaw);

      return {
        slotKey,
        slotLabel: formatSlotLabel(role, slotIndex),
        home: {
          slotKey,
          slotLabel: formatSlotLabel(role, slotIndex),
          playerName: homeSlot?.fantasyPlayer?.person.name ?? null,
          playerImageUrl: tmdbImageUrl(homeSlot?.fantasyPlayer?.person.profilePath, "w185"),
          weekPoints: formatPlayerWeekPoints(
            homeSlot?.fantasyPlayer?.playerWeekScores[0]?.pointsBoxOffice,
            homeSlot?.fantasyPlayer?.playerWeekScores[0]?.pointsRt,
          ),
          fantasyPlayerId: homeSlot?.fantasyPlayer?.id ?? null,
        },
        away: {
          slotKey,
          slotLabel: formatSlotLabel(role, slotIndex),
          playerName: awaySlot?.fantasyPlayer?.person.name ?? null,
          playerImageUrl: tmdbImageUrl(awaySlot?.fantasyPlayer?.person.profilePath, "w185"),
          weekPoints: formatPlayerWeekPoints(
            awaySlot?.fantasyPlayer?.playerWeekScores[0]?.pointsBoxOffice,
            awaySlot?.fantasyPlayer?.playerWeekScores[0]?.pointsRt,
          ),
          fantasyPlayerId: awaySlot?.fantasyPlayer?.id ?? null,
        },
      };
    });

    return {
      id: matchup.id,
      homeTeam: {
        id: matchup.homeTeam.id,
        name: matchup.homeTeam.name,
        record: formatRecord(matchup.homeTeam),
        score: formatScore(matchup.homeScoreTotal),
      },
      awayTeam: {
        id: matchup.awayTeam.id,
        name: matchup.awayTeam.name,
        record: formatRecord(matchup.awayTeam),
        score: formatScore(matchup.awayScoreTotal),
      },
      slotComparisons,
    };
  });
  const orientedMatchupCards = matchupCards.map((matchup) => orientMatchupToCurrentTeam(matchup, activeTeamId));
  const currentTeamMatchupIndex = activeTeamId
    ? orientedMatchupCards.findIndex(
        (matchup) => matchup.homeTeam.id === activeTeamId || matchup.awayTeam.id === activeTeamId,
      )
    : -1;
  const orderedMatchupCards = rotateToFront(orientedMatchupCards, currentTeamMatchupIndex);

  return (
    <AppShell
      title="Matchups"
      hideHeaderText
      headerActions={isCommissioner ? <LeagueViewSwitcher teams={teams} activeTeamId={activeTeamId} isPreviewing={isPreviewing} /> : null}
    >
      <FantasyLeagueTabs
        leagueId={leagueId}
        teamId={activeTeamId}
        active="MATCH"
        matchHref={`/leagues/${leagueId}/matchups/${week.id}`}
        viewTeamId={previewTeamId}
      />
      <div className="flex justify-end">
        <MonthMatchupPicker
          leagueId={leagueId}
          currentWeekId={week.id}
          viewTeamId={previewTeamId}
          weeks={allWeeks.map((item) => ({
            id: item.id,
            index: item.index,
            label: formatMonthLabel(item.startAt, league.timezone),
          }))}
        />
      </div>

      {matchupCards.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">No matchups scheduled for this month yet.</p>
          <Link href={appendLeagueView(`/leagues/${leagueId}/draft`, previewTeamId)} className="mt-3 inline-block rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950">
            Go to Draft Room
          </Link>
        </Card>
      ) : (
        <MatchupCarousel leagueId={leagueId} matchups={orderedMatchupCards} viewTeamId={previewTeamId} />
      )}
    </AppShell>
  );
}

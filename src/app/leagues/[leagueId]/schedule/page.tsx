import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { appendLeagueView } from "@/lib/leagueView";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { LeagueViewSwitcher } from "@/components/LeagueViewSwitcher";
import { getSessionUser } from "@/server/auth/session";
import { resolveLeagueViewContext } from "@/server/services/leagueViewService";
import { formatMonthLabel, resolveMatchupWindowForWeek } from "@/server/utils/time";

function formatDate(value: Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default async function LeagueSchedulePage({
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
  const { activeTeamId, isCommissioner, isPreviewing, previewTeamId, teams: viewTeams } = viewContext;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { timezone: true },
  });
  if (!league) {
    redirect("/");
  }

  const weeks = await prisma.week.findMany({
    where: { leagueId },
    include: {
      matchups: {
        include: {
          homeTeam: true,
          awayTeam: true,
        },
      },
    },
    orderBy: { index: "asc" },
  });

  const currentWeekIndex =
    weeks.find((week) => {
      const now = new Date().getTime();
      return week.startAt.getTime() <= now && now <= week.endAt.getTime();
    })?.index ?? null;

  return (
    <AppShell
      title="Schedule"
      headerActions={isCommissioner ? <LeagueViewSwitcher teams={viewTeams} activeTeamId={activeTeamId} isPreviewing={isPreviewing} /> : null}
    >
      {weeks.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">No monthly schedule generated yet.</p>
        </Card>
      ) : null}

      {weeks.map((week) => {
        const hasMatchups = week.matchups.length > 0;
        const completed = week.matchups.filter((matchup) => matchup.result != null).length;
        const matchupWindow = resolveMatchupWindowForWeek(week.startAt, league.timezone);

        return (
          <Card key={week.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{formatMonthLabel(week.startAt, league.timezone)}</h2>
                <p className="text-xs text-slate-500">Month {week.index}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(week.startAt)} - {formatDate(week.endAt)}
                </p>
                <p className="text-xs text-slate-500">
                  Monthly scoring: {formatDate(matchupWindow.startAt)} - {formatDate(matchupWindow.endAt)}
                </p>
              </div>
              {currentWeekIndex === week.index ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Current</span>
              ) : null}
            </div>

            {hasMatchups ? (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  {week.matchups.length} matchup{week.matchups.length === 1 ? "" : "s"} • {completed} finalized
                </p>
                <Link href={appendLeagueView(`/leagues/${leagueId}/matchups/${week.id}`, previewTeamId)} className="mt-3 inline-block rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
                  View {formatMonthLabel(week.startAt, league.timezone)} Matchups
                </Link>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Matchups will appear after the draft is complete.</p>
            )}
          </Card>
        );
      })}
    </AppShell>
  );
}

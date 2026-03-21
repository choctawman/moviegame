import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { appendLeagueView, normalizeLeagueViewTeamId } from "@/lib/leagueView";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";

export default async function LeagueStandingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ viewTeamId?: string }>;
}) {
  const { leagueId } = await params;
  const { viewTeamId } = await searchParams;
  const normalizedViewTeamId = normalizeLeagueViewTeamId(viewTeamId);
  const teams = await prisma.team.findMany({
    where: { leagueId },
    orderBy: [{ recordWins: "desc" }, { recordTies: "desc" }, { recordLosses: "asc" }],
  });

  return (
    <AppShell title="Standings">
      <Card>
        {teams.length === 0 ? (
          <p className="text-sm text-slate-600">No teams joined yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {teams.map((team, idx) => (
              <li key={team.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-2">
                <span>
                  {idx + 1}.{" "}
                  <Link href={appendLeagueView(`/teams/${team.id}/roster`, normalizedViewTeamId)} className="underline">
                    {team.name}
                  </Link>
                </span>
                <span>
                  {team.recordWins}-{team.recordLosses}-{team.recordTies}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}

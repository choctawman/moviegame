import Link from "next/link";

import { appendLeagueView } from "@/lib/leagueView";

type FantasyLeagueTabKey = "MATCH" | "TEAM" | "PLAYERS" | "LEAGUE";

const TAB_LABELS: Record<FantasyLeagueTabKey, string> = {
  MATCH: "Match",
  TEAM: "Team",
  PLAYERS: "Players",
  LEAGUE: "League",
};

export function FantasyLeagueTabs({
  leagueId,
  teamId,
  active,
  matchHref,
  viewTeamId,
}: {
  leagueId: string;
  teamId: string | null;
  active: FantasyLeagueTabKey;
  matchHref?: string;
  viewTeamId?: string | null;
}) {
  const hrefByTab: Record<FantasyLeagueTabKey, string> = {
    MATCH: appendLeagueView(matchHref ?? `/leagues/${leagueId}/schedule`, viewTeamId),
    TEAM: appendLeagueView(teamId ? `/teams/${teamId}/roster` : `/leagues/${leagueId}`, viewTeamId),
    PLAYERS: appendLeagueView(`/leagues/${leagueId}/player-pool`, viewTeamId),
    LEAGUE: appendLeagueView(`/leagues/${leagueId}`, viewTeamId),
  };

  return (
    <nav
      aria-label="Fantasy league sections"
      className="border-b border-white/10"
    >
      <div className="grid w-full grid-cols-4 gap-4 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as FantasyLeagueTabKey[]).map((tab) => {
          const isActive = tab === active;
          return (
            <Link
              key={tab}
              href={hrefByTab[tab]}
              aria-current={isActive ? "page" : undefined}
              className={`border-b-2 px-1 py-3 text-center text-sm font-medium ${
                isActive
                  ? "border-white text-white"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              {TAB_LABELS[tab]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

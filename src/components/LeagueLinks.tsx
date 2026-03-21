import Link from "next/link";

import { appendLeagueView } from "@/lib/leagueView";

const LINKS = [
  { path: "rules", label: "Rules" },
  { path: "draft", label: "Draft" },
  { path: "data-health", label: "Data Health" },
];

export function LeagueLinks({ leagueId, viewTeamId }: { leagueId: string; viewTeamId?: string | null }) {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
      {LINKS.map((link) => (
        <Link
          key={link.path}
          href={appendLeagueView(`/leagues/${leagueId}${link.path ? `/${link.path}` : ""}`, viewTeamId)}
          className="group rounded-[1.5rem] border border-cyan-400/12 bg-slate-950/70 p-4 shadow-[0_18px_40px_rgba(2,6,23,0.28)] backdrop-blur hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-slate-900/80"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-cyan-200/65">
              {link.path || "home"}
            </span>
            <span className="text-cyan-300 transition group-hover:translate-x-0.5">→</span>
          </div>
          <div className="mt-4">
            <p className="text-lg font-semibold text-white">{link.label}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

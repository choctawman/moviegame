"use client";

import { useRouter } from "next/navigation";

import { appendLeagueView } from "@/lib/leagueView";

export function MonthMatchupPicker({
  leagueId,
  currentWeekId,
  weeks,
  viewTeamId,
}: {
  leagueId: string;
  currentWeekId: string;
  weeks: Array<{ id: string; label: string; index: number }>;
  viewTeamId?: string | null;
}) {
  const router = useRouter();

  return (
    <label className="inline-flex items-center rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white">
      <select
        value={currentWeekId}
        onChange={(event) => router.push(appendLeagueView(`/leagues/${leagueId}/matchups/${event.target.value}`, viewTeamId))}
        className="border-0 bg-transparent pr-6 text-sm text-white outline-none"
        aria-label="Select month"
      >
        {weeks.map((week) => (
          <option key={week.id} value={week.id}>
            Month {week.index} · {week.label}
          </option>
        ))}
      </select>
    </label>
  );
}

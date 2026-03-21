"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { setLeagueViewTeamParam } from "@/lib/leagueView";

export function LeagueViewSwitcher({
  teams,
  activeTeamId,
  isPreviewing,
}: {
  teams: Array<{ id: string; name: string }>;
  activeTeamId: string | null;
  isPreviewing: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (rootRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function updateViewTeam(viewTeamId: string) {
    const nextSearchParams = setLeagueViewTeamParam(searchParams, viewTeamId || null);
    const nextQuery = nextSearchParams.toString();
    setOpen(false);
    router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
          isPreviewing
            ? "border-amber-300/40 bg-amber-300/15 text-amber-100"
            : "border-white/10 bg-slate-900/80 text-slate-200 hover:border-white/20"
        }`}
      >
        God Mode
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.6rem)] z-30 w-72 rounded-[1.4rem] border border-amber-300/20 bg-slate-950/95 p-3 shadow-2xl shadow-black/40 backdrop-blur">
          <select
            value={isPreviewing ? activeTeamId ?? "" : ""}
            onChange={(event) => updateViewTeam(event.target.value)}
            className="w-full rounded-2xl border border-amber-100/20 bg-slate-900/80 px-4 py-3 text-sm text-white"
          >
            <option value="">My account view</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>

          {isPreviewing ? (
            <button
              type="button"
              onClick={() => updateViewTeam("")}
              className="mt-2 w-full rounded-2xl border border-amber-100/20 bg-amber-50/10 px-4 py-3 text-sm font-semibold text-amber-100"
            >
              Use My View
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

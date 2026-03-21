"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface SlotItem {
  id: string;
  role: string;
  slotIndex: number;
  playerName: string | null;
  playerRole: string | null;
  playerImageUrl: string | null;
  fantasyPlayerId: string | null;
  currentMonthPoints: string | null;
  previousMonthPoints: string | null;
}

interface RosterManagerProps {
  leagueId: string;
  teamId: string;
  canManage: boolean;
  readOnly?: boolean;
  lineupLocked: boolean;
  nextLineupLockTime: string;
  canCommissionerOverride: boolean;
  commissionerOverrideActive: boolean;
  summary: {
    record: string;
    seasonYear: number;
  };
  slots: SlotItem[];
}

interface MoveOption {
  slotId: string;
  label: string;
  direction: "from" | "to";
}

const BENCH_MOVE_TARGET = "__bench__";

const lineupLockFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return lineupLockFormatter.format(date);
}

function canPlayerFitSlot(playerRole: string, slotRole: string): boolean {
  if (slotRole === "BENCH") {
    return playerRole !== "PRODUCER";
  }
  return playerRole === slotRole;
}

function slotLabel(role: string, slotIndex: number): string {
  if (role === "LEADING_ACTOR") {
    return `Actor ${slotIndex}`;
  }
  if (role === "LEADING_ACTRESS") {
    return `Actress ${slotIndex}`;
  }
  if (role === "SUPPORTING") {
    return slotIndex === 1 ? "Supporting" : `Supporting ${slotIndex}`;
  }
  if (role === "DIRECTOR") {
    return "Director";
  }
  if (role === "BENCH") {
    return `Bench ${slotIndex}`;
  }
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slotTileLines(role: string, slotIndex: number): string[] {
  if (role === "LEADING_ACTOR") {
    return ["Actor", String(slotIndex)];
  }
  if (role === "LEADING_ACTRESS") {
    return ["Actress", String(slotIndex)];
  }
  if (role === "SUPPORTING") {
    return slotIndex === 1 ? ["Support"] : ["Support", String(slotIndex)];
  }
  if (role === "DIRECTOR") {
    return ["Director"];
  }
  if (role === "BENCH") {
    return ["Bench", String(slotIndex)];
  }
  return slotLabel(role, slotIndex).split(" ");
}

function playerInitials(name: string | null): string {
  if (!name) {
    return "--";
  }
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function compactName(name: string | null): string {
  if (!name) {
    return "Empty";
  }

  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) {
    return name;
  }

  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function moveSourceLabel(slot: SlotItem): string {
  const name = compactName(slot.playerName);
  return slot.role === "BENCH" ? `${name} - Bench` : `${name} - ${slotLabel(slot.role, slot.slotIndex)}`;
}

export function RosterManager({
  leagueId,
  teamId,
  canManage,
  readOnly = false,
  lineupLocked,
  nextLineupLockTime,
  canCommissionerOverride,
  commissionerOverrideActive,
  summary,
  slots,
}: RosterManagerProps) {
  const router = useRouter();
  const [openMoveMenuSlotId, setOpenMoveMenuSlotId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const starters = useMemo(() => slots.filter((slot) => slot.role !== "BENCH"), [slots]);
  const bench = useMemo(() => slots.filter((slot) => slot.role === "BENCH"), [slots]);
  const moveOptionsBySlotId = useMemo(() => {
    const options = new Map<string, MoveOption[]>();

    for (const slot of slots) {
      const nextOptions: MoveOption[] = [];

      if (slot.playerRole) {
        for (const toSlot of slots) {
          if (toSlot.id === slot.id || toSlot.role === "BENCH") {
            continue;
          }
          if (!canPlayerFitSlot(slot.playerRole, toSlot.role)) {
            continue;
          }
          if (toSlot.playerRole && !canPlayerFitSlot(toSlot.playerRole, slot.role)) {
            continue;
          }

          nextOptions.push({
            slotId: toSlot.id,
            label: slotLabel(toSlot.role, toSlot.slotIndex),
            direction: "to",
          });
        }

        if (slot.role !== "BENCH") {
          nextOptions.push({
            slotId: BENCH_MOVE_TARGET,
            label: "Bench",
            direction: "to",
          });
        }
      } else {
        for (const fromSlot of slots) {
          if (!fromSlot.playerRole || fromSlot.id === slot.id) {
            continue;
          }
          if (!canPlayerFitSlot(fromSlot.playerRole, slot.role)) {
            continue;
          }

          nextOptions.push({
            slotId: fromSlot.id,
            label: moveSourceLabel(fromSlot),
            direction: "from",
          });
        }
      }

      options.set(slot.id, nextOptions);
    }

    return options;
  }, [slots]);

  useEffect(() => {
    if (!openMoveMenuSlotId) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        setOpenMoveMenuSlotId(null);
        return;
      }
      if (event.target.closest(`[data-move-menu-root="${openMoveMenuSlotId}"]`)) {
        return;
      }
      setOpenMoveMenuSlotId(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMoveMenuSlotId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openMoveMenuSlotId]);

  async function submitMove(fromSlotId: string, toSlotId: string) {
    if (submitting) {
      return;
    }

    setError(null);

    if (readOnly) {
      setError("Preview mode is read-only.");
      return;
    }

    setSubmitting(true);
    const response = await fetch(`/api/teams/${teamId}/roster`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fromRosterSlotId: fromSlotId, toRosterSlotId: toSlotId }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSubmitting(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not move player");
      return;
    }

    setOpenMoveMenuSlotId(null);
    router.refresh();
  }

  async function submitLineupOverride(unlocked: boolean) {
    if (overrideSubmitting) {
      return;
    }

    setError(null);

    if (readOnly) {
      setError("Preview mode is read-only.");
      return;
    }

    setOverrideSubmitting(true);
    const response = await fetch(`/api/teams/${teamId}/lineup-override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ unlocked }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setOverrideSubmitting(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not update lineup lock");
      return;
    }

    router.refresh();
  }

  function renderSlot(slot: SlotItem) {
    const playerHref = slot.fantasyPlayerId ? `/fantasy-players/${slot.fantasyPlayerId}?leagueId=${leagueId}` : "#";
    const tileLines = slotTileLines(slot.role, slot.slotIndex);
    const moveOptions = moveOptionsBySlotId.get(slot.id) ?? [];
    const canOpenMoveMenu = Boolean(
      canManage && !lineupLocked && !submitting && moveOptions.length > 0,
    );
    const isMenuOpen = openMoveMenuSlotId === slot.id;
    const tileClassName = `flex min-h-16 flex-col items-center justify-center rounded-lg border px-2 py-2 text-center ${
      isMenuOpen
        ? "border-white/30 bg-white/10 text-white"
        : canOpenMoveMenu
          ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
          : "border-cyan-400/20 bg-slate-900/80 text-cyan-100"
    }`;

    return (
      <div
        key={slot.id}
        className={`relative w-full rounded-lg border p-3 text-left transition ${
          isMenuOpen ? "border-white/30 bg-slate-900/80" : "border-white/10 bg-slate-950/70"
        }`}
      >
        <div className="grid grid-cols-[4.75rem_auto_minmax(0,1fr)_auto] items-center gap-3">
          <div data-move-menu-root={slot.id} className="relative">
            {canOpenMoveMenu ? (
              <>
                <button
                  type="button"
                  onClick={() => setOpenMoveMenuSlotId((current) => (current === slot.id ? null : slot.id))}
                  className={`${tileClassName} w-full transition hover:border-cyan-300/40 hover:bg-cyan-500/15`}
                  aria-expanded={isMenuOpen}
                  aria-haspopup="menu"
                >
                  {tileLines.map((line) => (
                    <span key={line} className="text-[11px] font-semibold uppercase tracking-[0.24em] leading-tight">
                      {line}
                    </span>
                  ))}
                </button>

                {isMenuOpen ? (
                  <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 min-w-[10rem] rounded-lg border border-white/10 bg-slate-950/95 p-1 shadow-2xl shadow-black/40 backdrop-blur">
                    {moveOptions.map((option) => (
                      <button
                        key={`${option.direction}:${option.slotId}`}
                        type="button"
                        onClick={() =>
                          void submitMove(
                            option.direction === "from" ? option.slotId : slot.id,
                            option.direction === "from" ? slot.id : option.slotId,
                          )
                        }
                        className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className={tileClassName}>
                {tileLines.map((line) => (
                  <span key={line} className="text-[11px] font-semibold uppercase tracking-[0.24em] leading-tight">
                    {line}
                  </span>
                ))}
              </div>
            )}
          </div>

          {slot.fantasyPlayerId ? (
            <Link href={playerHref}>
              {slot.playerImageUrl ? (
                <Image
                  src={slot.playerImageUrl}
                  alt={slot.playerName ? `${slot.playerName} photo` : "Roster slot"}
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-lg border border-white/10 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 text-sm font-semibold text-slate-300">
                  {playerInitials(slot.playerName)}
                </div>
              )}
            </Link>
          ) : slot.playerImageUrl ? (
            <Image
              src={slot.playerImageUrl}
              alt={slot.playerName ? `${slot.playerName} photo` : "Roster slot"}
              width={64}
              height={64}
              className="h-16 w-16 rounded-lg border border-white/10 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 text-sm font-semibold text-slate-300">
              {playerInitials(slot.playerName)}
            </div>
          )}

          <div className="min-w-0">
            <div className="min-w-0">
              {slot.fantasyPlayerId ? (
                <Link
                  href={playerHref}
                  className="block truncate text-lg font-semibold text-white"
                >
                  {compactName(slot.playerName)}
                </Link>
              ) : (
                <p className="truncate text-lg font-semibold text-white">Empty</p>
              )}
              <p className="text-sm text-slate-400">
                {slot.playerRole ? slotLabel(slot.playerRole, 1) : "Open"}
              </p>
            </div>
          </div>

          {slot.playerName ? (
            <div className="text-right">
              <p className="text-lg font-semibold text-white">{slot.currentMonthPoints ?? "0.00"}</p>
              <p className="text-xs text-slate-500">Prev {slot.previousMonthPoints ?? "0.00"}</p>
            </div>
          ) : (
            <div />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {readOnly ? (
        <p className="rounded-[1.4rem] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          Preview mode is read-only. Roster moves stay disabled while you are viewing another team&apos;s app.
        </p>
      ) : null}

      <section className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300">
              {summary.record}
            </span>
            <span
              className={`rounded-md px-2 py-1 text-xs ${
                lineupLocked ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {commissionerOverrideActive ? "Unlocked" : lineupLocked ? "Locked" : "Open"}
            </span>
            <span className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300">
              {summary.seasonYear}
            </span>
          </div>
          {canCommissionerOverride ? (
            <button
              type="button"
              onClick={() => void submitLineupOverride(!commissionerOverrideActive)}
              disabled={overrideSubmitting}
              className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white transition hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {commissionerOverrideActive ? "Relock lineup" : "Unlock lineup"}
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-slate-400">Next lock: {formatDateTime(nextLineupLockTime)}</p>
        {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-2xl font-semibold text-white">Starters</h3>
          <span className="text-sm text-slate-400">
            {starters.filter((slot) => slot.playerName).length}/{starters.length}
          </span>
        </div>
        <div className="space-y-3">{starters.map((slot) => renderSlot(slot))}</div>
      </section>

      {bench.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-2xl font-semibold text-white">Bench</h3>
            <span className="text-sm text-slate-400">
              {bench.filter((slot) => slot.playerName).length}/{bench.length}
            </span>
          </div>
          <div className="space-y-3">{bench.map((slot) => renderSlot(slot))}</div>
        </section>
      ) : null}
    </div>
  );
}

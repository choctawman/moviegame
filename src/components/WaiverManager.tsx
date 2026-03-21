"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface PlayerOption {
  id: string;
  name: string;
  role: string;
}

interface RosterSlotOption {
  id: string;
  role: string;
  slotIndex: number;
  playerName: string;
}

interface NominationItem {
  id: string;
  teamId: string;
  teamName: string;
  fantasyPlayerId: string;
  playerName: string;
  role: string;
}

interface MyClaim {
  id: string;
  status: string;
  priorityIndex: number;
  addFantasyPlayerId: string;
  addPlayerName: string;
  bidAmount: number;
  targetRosterSlotId: string;
  createdAt: string;
}

interface WaiverManagerProps {
  leagueId: string;
  teamBudget: number;
  readOnly?: boolean;
  claimsOpen: boolean;
  nominationsOpen: boolean;
  nextNominationProcessingTime: string;
  nextWaiverProcessingTime: string | null;
  nextLineupLockTime: string;
  waiverPeriodLabel: string;
  januaryWaiversSkipped: boolean;
  nominationOptions: PlayerOption[];
  waiverPoolPlayers: PlayerOption[];
  nominations: NominationItem[];
  myNominationFantasyPlayerId: string | null;
  waiverPoolPublished: boolean;
  rosterSlots: RosterSlotOption[];
  myClaims: MyClaim[];
}

interface ClaimDraftRow {
  id: string;
  addFantasyPlayerId: string;
  bidAmount: string;
  targetRosterSlotId: string;
}

function formatDateTime(isoDate: string | null): string {
  if (!isoDate) {
    return "TBD";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString();
}

function formatRoleLabel(role: string): string {
  if (role === "LEADING_ACTOR") {
    return "Actor";
  }
  if (role === "LEADING_ACTRESS") {
    return "Actress";
  }
  if (role === "SUPPORTING") {
    return "Supporting";
  }
  if (role === "DIRECTOR") {
    return "Director";
  }
  if (role === "BENCH") {
    return "Bench";
  }
  return role;
}

function formatSlotLabel(role: string, slotIndex: number): string {
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
  return role;
}

function createRow(): ClaimDraftRow {
  return {
    id: crypto.randomUUID(),
    addFantasyPlayerId: "",
    bidAmount: "",
    targetRosterSlotId: "",
  };
}

export function WaiverManager({
  leagueId,
  teamBudget,
  readOnly = false,
  claimsOpen,
  nominationsOpen,
  nextNominationProcessingTime,
  nextWaiverProcessingTime,
  nextLineupLockTime,
  waiverPeriodLabel,
  januaryWaiversSkipped,
  nominationOptions,
  waiverPoolPlayers,
  nominations,
  myNominationFantasyPlayerId,
  waiverPoolPublished,
  rosterSlots,
  myClaims,
}: WaiverManagerProps) {
  const router = useRouter();
  const [nominationFantasyPlayerId, setNominationFantasyPlayerId] = useState(myNominationFantasyPlayerId ?? "");
  const pendingClaims = myClaims.filter((claim) => claim.status === "PENDING");
  const [rows, setRows] = useState<ClaimDraftRow[]>(
    pendingClaims.length > 0
      ? [...pendingClaims]
          .sort((a, b) => a.priorityIndex - b.priorityIndex)
          .map((claim) => ({
            id: claim.id,
            addFantasyPlayerId: claim.addFantasyPlayerId,
            bidAmount: String(claim.bidAmount),
            targetRosterSlotId: claim.targetRosterSlotId,
          }))
      : [createRow()],
  );
  const [submittingNomination, setSubmittingNomination] = useState(false);
  const [submittingClaims, setSubmittingClaims] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const playerById = useMemo(() => new Map(waiverPoolPlayers.map((player) => [player.id, player])), [waiverPoolPlayers]);
  const slotById = useMemo(() => new Map(rosterSlots.map((slot) => [slot.id, slot])), [rosterSlots]);

  function eligibleSlots(addFantasyPlayerId: string): RosterSlotOption[] {
    const player = playerById.get(addFantasyPlayerId);
    if (!player) {
      return rosterSlots;
    }
    return rosterSlots.filter((slot) => slot.role === "BENCH" || slot.role === player.role);
  }

  function updateRow(id: string, patch: Partial<ClaimDraftRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, createRow()]);
  }

  function removeRow(id: string) {
    setRows((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length > 0 ? next : [createRow()];
    });
  }

  function moveRow(id: string, direction: -1 | 1) {
    setRows((current) => {
      const index = current.findIndex((row) => row.id === id);
      if (index < 0) {
        return current;
      }
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const clone = [...current];
      const [item] = clone.splice(index, 1);
      clone.splice(target, 0, item);
      return clone;
    });
  }

  async function onSubmitNomination(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (readOnly) {
      setError("Preview mode is read-only.");
      return;
    }

    if (!nominationFantasyPlayerId) {
      setError("Select a player.");
      return;
    }

    setSubmittingNomination(true);
    const response = await fetch(`/api/leagues/${leagueId}/waivers/nominations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fantasyPlayerId: nominationFantasyPlayerId }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSubmittingNomination(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not save nomination");
      return;
    }

    setInfo("Nomination saved.");
    router.refresh();
  }

  async function onSubmitClaims(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (readOnly) {
      setError("Preview mode is read-only.");
      return;
    }

    const claims = rows
      .filter((row) => row.addFantasyPlayerId && row.bidAmount && row.targetRosterSlotId)
      .map((row) => ({
        addFantasyPlayerId: row.addFantasyPlayerId,
        bidAmount: Number(row.bidAmount),
        targetRosterSlotId: row.targetRosterSlotId,
      }));

    if (claims.length === 0) {
      setError("Add at least one bid.");
      return;
    }

    setSubmittingClaims(true);
    const response = await fetch(`/api/leagues/${leagueId}/waivers/claims`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ claims }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSubmittingClaims(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not save bids");
      return;
    }

    setInfo("Bids saved.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[1.6rem] border border-cyan-400/12 bg-slate-950/70 p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Budget</p>
          <p className="mt-3 text-3xl font-semibold text-white">${teamBudget}</p>
        </div>
        <div className="rounded-[1.6rem] border border-cyan-400/12 bg-slate-950/70 p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Month</p>
          <p className="mt-3 text-2xl font-semibold text-white">{waiverPeriodLabel}</p>
        </div>
        <div className="rounded-[1.6rem] border border-cyan-400/12 bg-slate-950/70 p-4">
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${claimsOpen ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.06] text-slate-300"}`}>
              Bids {claimsOpen ? "Open" : "Closed"}
            </span>
            <span className={`rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${nominationsOpen ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.06] text-slate-300"}`}>
              Nominations {nominationsOpen ? "Open" : "Closed"}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-300">Next process: {formatDateTime(nextWaiverProcessingTime)}</p>
          <p className="mt-1 text-sm text-slate-400">Next lock: {formatDateTime(nextLineupLockTime)}</p>
        </div>
      </section>

      {readOnly ? (
        <p className="rounded-[1.4rem] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          Preview mode is read-only. This shows the selected team&apos;s waiver screen without submitting nominations or bids.
        </p>
      ) : null}

      <form onSubmit={onSubmitNomination} className="space-y-3 rounded-[1.8rem] border border-cyan-400/12 bg-slate-950/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-white">Nominate</h2>
          <span className="text-sm text-slate-400">{formatDateTime(nextNominationProcessingTime)}</span>
        </div>
        <select
          value={nominationFantasyPlayerId}
          onChange={(event) => setNominationFantasyPlayerId(event.target.value)}
          disabled={readOnly}
          className="w-full rounded-2xl border px-4 py-3 text-sm"
        >
          <option value="">Select player</option>
          {nominationOptions.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name} ({formatRoleLabel(player.role)})
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={readOnly || submittingNomination || nominationOptions.length === 0 || !nominationsOpen}
          className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          {submittingNomination ? "Saving..." : "Save nomination"}
        </button>
      </form>

      <section className="space-y-3 rounded-[1.8rem] border border-cyan-400/12 bg-slate-950/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-white">Waiver pool</h2>
          <span className="text-sm text-slate-400">{nominations.length}</span>
        </div>
        {januaryWaiversSkipped ? (
          <p className="text-sm text-amber-300">January is skipped.</p>
        ) : nominations.length === 0 ? (
          <p className="text-sm text-slate-400">No nominations yet.</p>
        ) : (
          <div className="space-y-2">
            {nominations.map((nomination) => (
              <div key={nomination.id} className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{nomination.playerName}</p>
                    <p className="text-sm text-slate-400">
                      {formatRoleLabel(nomination.role)} · {nomination.teamName}
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-400/15 bg-cyan-400/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                    Nominated
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <form onSubmit={onSubmitClaims} className="space-y-3 rounded-[1.8rem] border border-cyan-400/12 bg-slate-950/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-white">Bids</h2>
          <button
            type="button"
            onClick={addRow}
            disabled={readOnly}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-slate-100"
          >
            Add bid
          </button>
        </div>

        {!waiverPoolPublished ? <p className="text-sm text-slate-400">Pool publishes on the 1st.</p> : null}

        <div className="space-y-3">
          {rows.map((row, index) => {
            const player = playerById.get(row.addFantasyPlayerId) ?? null;
            const slotOptions = eligibleSlots(row.addFantasyPlayerId);
            const targetSlot = slotById.get(row.targetRosterSlotId) ?? null;
            const replacingName = targetSlot?.playerName && targetSlot.playerName !== "Empty" ? targetSlot.playerName : null;

            return (
              <div key={row.id} className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full border border-cyan-400/15 bg-cyan-400/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                    {index + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => moveRow(row.id, -1)}
                      disabled={readOnly || index === 0}
                      className="rounded-lg border border-white/10 px-2 py-1 text-sm text-slate-200 disabled:opacity-40"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(row.id, 1)}
                      disabled={readOnly || index === rows.length - 1}
                      className="rounded-lg border border-white/10 px-2 py-1 text-sm text-slate-200 disabled:opacity-40"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={readOnly}
                      className="rounded-lg border border-white/10 px-2 py-1 text-sm text-slate-200"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  <select
                    value={row.addFantasyPlayerId}
                    onChange={(event) => updateRow(row.id, { addFantasyPlayerId: event.target.value, targetRosterSlotId: "" })}
                    disabled={readOnly}
                    className="w-full rounded-2xl border px-4 py-3 text-sm"
                  >
                    <option value="">Player</option>
                    {waiverPoolPlayers.map((poolPlayer) => (
                      <option key={poolPlayer.id} value={poolPlayer.id}>
                        {poolPlayer.name} ({formatRoleLabel(poolPlayer.role)})
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                    <input
                      type="number"
                      min={1}
                      max={teamBudget}
                      value={row.bidAmount}
                      onChange={(event) => updateRow(row.id, { bidAmount: event.target.value })}
                      disabled={readOnly}
                      placeholder="$"
                      className="rounded-2xl border px-4 py-3 text-sm"
                    />
                    <select
                      value={row.targetRosterSlotId}
                      onChange={(event) => updateRow(row.id, { targetRosterSlotId: event.target.value })}
                      disabled={readOnly}
                      className="w-full rounded-2xl border px-4 py-3 text-sm"
                    >
                      <option value="">Slot</option>
                      {slotOptions.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {formatSlotLabel(slot.role, slot.slotIndex)} · {slot.playerName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {player ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-sm text-slate-200">
                        {formatRoleLabel(player.role)}
                      </span>
                      {replacingName ? (
                        <span className="rounded-full border border-amber-300/15 bg-amber-300/10 px-3 py-1 text-sm text-amber-100">
                          Drop {replacingName}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={readOnly || submittingClaims || !claimsOpen || !waiverPoolPublished}
          className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          {submittingClaims ? "Saving..." : "Save bids"}
        </button>

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        {info ? <p className="text-sm text-emerald-300">{info}</p> : null}
      </form>

      {myClaims.length > 0 ? (
        <section className="space-y-3 rounded-[1.8rem] border border-cyan-400/12 bg-slate-950/70 p-4">
          <h2 className="text-xl font-semibold text-white">Saved order</h2>
          <div className="space-y-2">
            {[...myClaims]
              .sort((a, b) => a.priorityIndex - b.priorityIndex)
              .map((claim) => (
                <div key={claim.id} className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">
                      {claim.priorityIndex + 1}. {claim.addPlayerName}
                    </p>
                    <span className="text-sm text-cyan-200">${claim.bidAmount}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {formatSlotLabel(slotById.get(claim.targetRosterSlotId)?.role ?? "BENCH", slotById.get(claim.targetRosterSlotId)?.slotIndex ?? 1)}
                    {" · "}
                    {claim.status}
                  </p>
                </div>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

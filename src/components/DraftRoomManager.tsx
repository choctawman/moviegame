"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { LEAGUE_TEAM_LIMIT } from "@/server/services/constants";

type DraftType = "SNAKE" | "AUCTION";
type DraftStatus = "NOT_STARTED" | "LIVE" | "PAUSED" | "COMPLETE";

interface TeamOption {
  id: string;
  name: string;
}

interface PlayerOption {
  id: string;
  name: string;
  role: string;
  profileImageUrl: string | null;
  isAvailable: boolean;
}

interface DraftPickCard {
  id: string;
  overallPick: number;
  round: number;
  teamId: string;
  teamName: string;
  playerName: string;
  playerRole: string;
  profileImageUrl: string | null;
  autoPicked: boolean;
}

interface DraftStatePayload {
  draft: {
    id: string;
    type: DraftType;
    status: DraftStatus;
  };
  currentPick: {
    teamId: string;
    overallPick: number;
    round: number;
  } | null;
  secondsRemaining: number;
}

interface DraftRoomManagerProps {
  leagueId: string;
  teams: TeamOption[];
  canCommissioner: boolean;
  currentTeamId: string | null;
  readOnly?: boolean;
  initialDraft: {
    id: string;
    type: DraftType;
    status: DraftStatus;
  } | null;
  initialPicks: DraftPickCard[];
  initialAvailablePlayers: PlayerOption[];
}

function formatRoleLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function teamInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function playerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function DraftRoomManager({
  leagueId,
  teams,
  canCommissioner,
  currentTeamId,
  readOnly = false,
  initialDraft,
  initialPicks,
  initialAvailablePlayers,
}: DraftRoomManagerProps) {
  const router = useRouter();

  const [draftType, setDraftType] = useState<DraftType>(initialDraft?.type ?? "SNAKE");
  const [state, setState] = useState<DraftStatePayload | null>(
    initialDraft
      ? {
          draft: initialDraft,
          currentPick: null,
          secondsRemaining: 0,
        }
      : null,
  );
  const [availablePlayers, setAvailablePlayers] = useState<PlayerOption[]>(initialAvailablePlayers);
  const [pickPlayerId, setPickPlayerId] = useState("");
  const [search, setSearch] = useState("");
  const [forceTeamId, setForceTeamId] = useState(teams[0]?.id ?? "");
  const [forcePlayerId, setForcePlayerId] = useState("");
  const [auctionNominationPlayerId, setAuctionNominationPlayerId] = useState("");
  const [auctionNominationId, setAuctionNominationId] = useState("");
  const [auctionBidAmount, setAuctionBidAmount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const teamMap = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const currentTeamName = currentTeamId ? teamMap.get(currentTeamId) ?? null : null;

  const refreshDraftState = useCallback(async () => {
    const response = await fetch(`/api/leagues/${leagueId}/draft/state`);
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as DraftStatePayload;
    setState(payload);
  }, [leagueId]);

  async function refreshPlayers() {
    const response = await fetch(`/api/leagues/${leagueId}/player-pool?availableOnly=true`);
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      players: Array<{ id: string; role: string; person: { name: string }; isAvailable: boolean }>;
    };

    const currentImageByPlayerId = new Map(availablePlayers.map((player) => [player.id, player.profileImageUrl]));
    setAvailablePlayers(
      payload.players.map((player) => ({
        id: player.id,
        name: player.person.name,
        role: player.role,
        profileImageUrl: currentImageByPlayerId.get(player.id) ?? null,
        isAvailable: player.isAvailable,
      })),
    );
  }

  async function refreshPicks() {
    router.refresh();
  }

  useEffect(() => {
    if (!initialDraft) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshDraftState();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [initialDraft, refreshDraftState]);

  async function runAction(name: string, fn: () => Promise<Response>) {
    setError(null);
    setInfo(null);

    if (readOnly) {
      setError("Preview mode is read-only.");
      return;
    }

    setLoading(true);

    const response = await fn();
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    setLoading(false);

    if (!response.ok) {
      setError(payload?.error ?? `${name} failed`);
      return;
    }

    setInfo(`${name} complete.`);
    await Promise.all([refreshDraftState(), refreshPlayers(), refreshPicks()]);
  }

  async function startDraft() {
    await runAction("Start draft", () =>
      fetch(`/api/leagues/${leagueId}/draft/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: draftType }),
      }),
    );
  }

  async function pauseDraft() {
    await runAction("Pause draft", () => fetch(`/api/leagues/${leagueId}/draft/pause`, { method: "POST" }));
  }

  async function resumeDraft() {
    await runAction("Resume draft", () => fetch(`/api/leagues/${leagueId}/draft/resume`, { method: "POST" }));
  }

  async function undoPick() {
    await runAction("Undo pick", () => fetch(`/api/leagues/${leagueId}/draft/undo-pick`, { method: "POST" }));
  }

  async function makePick() {
    if (!pickPlayerId) {
      setError("Select a player to pick.");
      return;
    }

    await runAction("Pick", () =>
      fetch(`/api/leagues/${leagueId}/draft/pick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fantasyPlayerId: pickPlayerId }),
      }),
    );

    setPickPlayerId("");
  }

  async function forcePick() {
    if (!forceTeamId || !forcePlayerId) {
      setError("Select team and player for force pick.");
      return;
    }

    await runAction("Force pick", () =>
      fetch(`/api/leagues/${leagueId}/draft/force-pick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: forceTeamId,
          fantasyPlayerId: forcePlayerId,
        }),
      }),
    );
  }

  async function nominateAuctionPlayer() {
    if (!auctionNominationPlayerId) {
      setError("Select a player to nominate.");
      return;
    }

    await runAction("Nominate", () =>
      fetch(`/api/leagues/${leagueId}/draft/nominate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fantasyPlayerId: auctionNominationPlayerId }),
      }),
    );
  }

  async function bidAuction() {
    if (!auctionNominationId || !auctionBidAmount) {
      setError("Enter nomination ID and bid amount.");
      return;
    }

    await runAction("Bid", () =>
      fetch(`/api/leagues/${leagueId}/draft/bid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nominationId: auctionNominationId, amount: auctionBidAmount }),
      }),
    );
  }

  const draftIsLive = state?.draft.status === "LIVE";
  const draftIsPaused = state?.draft.status === "PAUSED";
  const draftStatus = state?.draft.status ?? initialDraft?.status ?? "NOT_STARTED";
  const canStartDraft = canCommissioner && draftStatus === "NOT_STARTED";
  const onTheClockTeamName = state?.currentPick ? teamMap.get(state.currentPick.teamId) ?? state.currentPick.teamId : null;
  const canPickNow =
    canCommissioner ||
    (Boolean(currentTeamId) && Boolean(state?.currentPick) && currentTeamId === state?.currentPick?.teamId);

  const filteredPlayers = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return availablePlayers
      .filter((player) => player.isAvailable)
      .filter((player) => {
        if (!normalized) {
          return true;
        }
        return player.name.toLowerCase().includes(normalized) || player.role.toLowerCase().includes(normalized);
      })
      .slice(0, 24);
  }, [availablePlayers, search]);

  const picksByTeam = useMemo(() => {
    const picks = new Map<string, DraftPickCard[]>();
    for (const team of teams) {
      picks.set(team.id, initialPicks.filter((pick) => pick.teamId === team.id));
    }
    return picks;
  }, [initialPicks, teams]);

  const myPicks = useMemo(() => {
    if (!currentTeamId) {
      return [];
    }
    return initialPicks.filter((pick) => pick.teamId === currentTeamId);
  }, [currentTeamId, initialPicks]);

  const recentPicks = useMemo(() => [...initialPicks].slice(-10).reverse(), [initialPicks]);
  const selectedPlayer = filteredPlayers.find((player) => player.id === pickPlayerId) ?? null;

  return (
    <div className="space-y-4">
      {teams.length < LEAGUE_TEAM_LIMIT ? (
        <div className="rounded-[1.6rem] border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          Draft requires {LEAGUE_TEAM_LIMIT} teams. Current: {teams.length}/{LEAGUE_TEAM_LIMIT}.
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_24rem]">
        <div className="min-w-0 space-y-4">
          <div className="rounded-[2rem] border border-cyan-400/12 bg-slate-950/75 p-5 shadow-[0_28px_80px_rgba(2,6,23,0.42)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-cyan-200/65">Draft Status</p>
                <h2 className="mt-3 text-3xl font-semibold text-white">
                  {onTheClockTeamName ? `${onTheClockTeamName} on the clock` : draftStatus.replaceAll("_", " ")}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Type: {state?.draft.type ?? initialDraft?.type ?? draftType} • Timer: {Math.max(0, state?.secondsRemaining ?? 0)}s
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.04] p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Status</p>
                  <p className="mt-2 text-lg font-semibold text-white">{draftStatus.replaceAll("_", " ")}</p>
                </div>
                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.04] p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Pick</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {state?.currentPick ? `#${state.currentPick.overallPick}` : "--"}
                  </p>
                </div>
                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.04] p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Round</p>
                  <p className="mt-2 text-lg font-semibold text-white">{state?.currentPick?.round ?? "--"}</p>
                </div>
              </div>
            </div>

            <div className="mt-5 max-w-full overflow-x-auto pb-2">
              <div className="flex w-max gap-3">
                {teams.map((team) => {
                  const teamPicks = picksByTeam.get(team.id) ?? [];
                  const latestPick = teamPicks[teamPicks.length - 1] ?? null;
                  const isOnClock = state?.currentPick?.teamId === team.id;
                  const isCurrentTeam = currentTeamId === team.id;

                  return (
                    <div
                      key={team.id}
                      className={`w-44 shrink-0 rounded-[1.4rem] border p-4 ${
                        isOnClock
                          ? "border-cyan-300/40 bg-cyan-400/10"
                          : isCurrentTeam
                            ? "border-violet-300/30 bg-violet-400/10"
                            : "border-white/8 bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-slate-900 text-sm font-semibold text-white">
                          {teamInitials(team.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{team.name}</p>
                          <p className="text-xs text-slate-400">{teamPicks.length} picks made</p>
                        </div>
                      </div>
                      <div className="mt-4">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
                          {isOnClock ? "On the clock" : "Latest pick"}
                        </p>
                        <p className="mt-2 text-sm font-medium text-white">{latestPick?.playerName ?? "Waiting for first pick"}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {latestPick ? `Round ${latestPick.round} • ${formatRoleLabel(latestPick.playerRole)}` : "No selection yet"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {canStartDraft ? (
            <div className="rounded-[1.8rem] border border-cyan-400/12 bg-slate-950/75 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-cyan-200/65">Commissioner Controls</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Start Draft</h3>
                </div>
                <select
                  value={draftType}
                  onChange={(event) => setDraftType(event.target.value as DraftType)}
                  disabled={readOnly}
                  className="rounded-2xl border px-4 py-3 text-sm"
                >
                  <option value="SNAKE">Snake</option>
                  <option value="AUCTION">Auction</option>
                </select>
              </div>
              <button
                type="button"
                onClick={startDraft}
                disabled={readOnly || loading || teams.length < LEAGUE_TEAM_LIMIT}
                className="mt-4 inline-flex rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                Start Draft
              </button>
            </div>
          ) : null}

          {(draftIsLive || draftIsPaused) ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_0.85fr]">
              <div className="rounded-[1.8rem] border border-cyan-400/12 bg-slate-950/75 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-cyan-200/65">Player Board</p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">Available Players</h3>
                  </div>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search player or role"
                    className="w-full rounded-2xl border px-4 py-3 text-sm sm:w-72"
                  />
                </div>

                <div className="mt-4 grid gap-3">
                  {filteredPlayers.map((player) => {
                    const isSelected = player.id === pickPlayerId;
                    return (
                      <button
                        key={player.id}
                        type="button"
                        onClick={() => setPickPlayerId(player.id)}
                        className={`grid items-center gap-3 rounded-[1.4rem] border p-4 text-left sm:grid-cols-[auto_1fr_auto] ${
                          isSelected
                            ? "border-cyan-300/40 bg-cyan-400/10"
                            : "border-white/8 bg-white/[0.03] hover:bg-white/[0.05]"
                        }`}
                      >
                        {player.profileImageUrl ? (
                          <Image
                            src={player.profileImageUrl}
                            alt={`${player.name} photo`}
                            width={56}
                            height={56}
                            className="h-14 w-14 rounded-2xl border border-white/10 object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 text-sm font-semibold text-slate-200">
                            {playerInitials(player.name)}
                          </div>
                        )}
                        <div>
                          <p className="text-lg font-semibold text-white">{player.name}</p>
                          <p className="text-sm text-slate-400">{formatRoleLabel(player.role)}</p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                          Draft
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={makePick}
                    disabled={readOnly || loading || !draftIsLive || !pickPlayerId || !canPickNow}
                    className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
                  >
                    {selectedPlayer ? `Draft ${selectedPlayer.name}` : "Make Pick"}
                  </button>
                  {readOnly ? (
                    <p className="text-sm text-amber-200">Preview mode is read-only.</p>
                  ) : null}
                  {draftIsLive && !canPickNow ? (
                    <p className="text-sm text-slate-400">You can pick when your team is on the clock.</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[1.8rem] border border-cyan-400/12 bg-slate-950/75 p-5">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-cyan-200/65">Draft Actions</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={pauseDraft}
                      disabled={readOnly || loading || !draftIsLive}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      onClick={resumeDraft}
                      disabled={readOnly || loading || !draftIsPaused}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Resume
                    </button>
                  </div>
                  {canCommissioner ? (
                    <>
                      <button
                        type="button"
                        onClick={undoPick}
                        disabled={readOnly || loading}
                        className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        Undo Last Pick
                      </button>

                      <div className="mt-4 space-y-2 rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4">
                        <p className="text-sm font-semibold text-white">Force Pick</p>
                        <select value={forceTeamId} onChange={(event) => setForceTeamId(event.target.value)} disabled={readOnly} className="w-full rounded-2xl border px-4 py-3 text-sm">
                          {teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                        <select value={forcePlayerId} onChange={(event) => setForcePlayerId(event.target.value)} disabled={readOnly} className="w-full rounded-2xl border px-4 py-3 text-sm">
                          <option value="">Select player</option>
                          {availablePlayers.map((player) => (
                            <option key={player.id} value={player.id}>
                              {player.name} ({player.role})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={forcePick}
                          disabled={readOnly || loading || !forcePlayerId}
                          className="w-full rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
                        >
                          Force Pick
                        </button>
                      </div>
                    </>
                  ) : null}

                  {state?.draft.type === "AUCTION" ? (
                    <div className="mt-4 space-y-2 rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-sm font-semibold text-white">Auction Tools</p>
                      <select
                        value={auctionNominationPlayerId}
                        onChange={(event) => setAuctionNominationPlayerId(event.target.value)}
                        disabled={readOnly}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                      >
                        <option value="">Select player to nominate</option>
                        {availablePlayers.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name} ({player.role})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={nominateAuctionPlayer}
                        disabled={readOnly || loading || !auctionNominationPlayerId}
                        className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
                      >
                        Nominate
                      </button>

                      <input
                        value={auctionNominationId}
                        onChange={(event) => setAuctionNominationId(event.target.value)}
                        disabled={readOnly}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                        placeholder="Nomination ID"
                      />
                      <input
                        value={auctionBidAmount}
                        onChange={(event) => setAuctionBidAmount(Number(event.target.value) || 1)}
                        type="number"
                        min={1}
                        disabled={readOnly}
                        className="w-full rounded-2xl border px-4 py-3 text-sm"
                        placeholder="Bid amount"
                      />
                      <button
                        type="button"
                        onClick={bidAuction}
                        disabled={readOnly || loading || !auctionNominationId}
                        className="w-full rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
                      >
                        Submit Bid
                      </button>
                    </div>
                  ) : null}
                </div>

                {error ? <p className="text-sm text-rose-300">{error}</p> : null}
                {info ? <p className="text-sm text-emerald-300">{info}</p> : null}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
          <div className="rounded-[1.9rem] border border-cyan-400/12 bg-slate-950/80 p-5 shadow-[0_24px_70px_rgba(2,6,23,0.4)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-cyan-200/65">Roster Sidebar</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{currentTeamName ?? "League Queue"}</h3>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                {myPicks.length} picks
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {myPicks.length === 0 ? (
                <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-400">
                  Your drafted roster will appear here as picks come in.
                </div>
              ) : (
                myPicks.map((pick) => (
                      <div key={pick.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-3">
                        {pick.profileImageUrl ? (
                          <Image
                            src={pick.profileImageUrl}
                            alt={`${pick.playerName} photo`}
                            width={52}
                            height={52}
                            className="h-14 w-14 rounded-2xl border border-white/10 object-cover"
                          />
                        ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 text-sm font-semibold text-slate-200">
                        {playerInitials(pick.playerName)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{pick.playerName}</p>
                      <p className="text-sm text-slate-400">{formatRoleLabel(pick.playerRole)}</p>
                    </div>
                    <span className="text-sm font-semibold text-cyan-200">#{pick.overallPick}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[1.9rem] border border-cyan-400/12 bg-slate-950/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold text-white">Recent Picks</h3>
              <span className="text-sm text-slate-400">{initialPicks.length} total</span>
            </div>
            <div className="mt-4 space-y-3">
              {recentPicks.length === 0 ? (
                <p className="text-sm text-slate-400">No picks yet.</p>
              ) : (
                recentPicks.map((pick) => (
                  <div key={pick.id} className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-white">#{pick.overallPick} {pick.playerName}</p>
                      {pick.autoPicked ? (
                        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-amber-100">
                          Auto
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      {pick.teamName} • Round {pick.round} • {formatRoleLabel(pick.playerRole)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

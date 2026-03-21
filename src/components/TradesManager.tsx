"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TradeStatus = "PROPOSED" | "ACCEPTED" | "REJECTED" | "CANCELED" | "VETOED" | "COMPLETED";

interface TeamOption {
  id: string;
  name: string;
  waiverBudget: number;
}

interface TradeablePlayer {
  teamId: string;
  teamName: string;
  fantasyPlayerId: string;
  playerName: string;
  role: "LEADING_ACTOR" | "LEADING_ACTRESS" | "SUPPORTING" | "DIRECTOR" | "BENCH";
  slotIndex: number;
}

interface TradeCard {
  id: string;
  status: TradeStatus;
  proposerTeamId: string;
  proposerTeamName: string;
  recipientTeamId: string;
  recipientTeamName: string;
  reviewEndsAt: string | null;
  updatedAt: string;
  approveVoteTeamIds: string[];
  vetoVoteTeamIds: string[];
  items: Array<{
    id: string;
    fromTeamId: string;
    fantasyPlayerId: string | null;
    playerName: string | null;
    role: string | null;
    slotIndex: number | null;
    faabAmount: number | null;
  }>;
}

interface TradesManagerProps {
  leagueId: string;
  currentTeamId: string | null;
  readOnly?: boolean;
  teams: TeamOption[];
  tradeablePlayers: TradeablePlayer[];
  trades: TradeCard[];
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString();
}

function formatRoleLabel(role: string | null): string {
  if (!role) {
    return "";
  }
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTradeItemLabel(item: TradeCard["items"][number]): string {
  if (item.faabAmount != null) {
    return `$${item.faabAmount} FAAB`;
  }

  if (!item.playerName || !item.role || item.slotIndex == null) {
    return "Unknown trade asset";
  }

  return `${item.playerName} (${formatRoleLabel(item.role)} #${item.slotIndex})`;
}

function tradeStatusClassName(status: TradeStatus): string {
  switch (status) {
    case "REJECTED":
      return "text-red-600";
    case "COMPLETED":
      return "text-green-600";
    case "CANCELED":
      return "text-slate-500";
    default:
      return "text-slate-500";
  }
}

function renderTradeItemLabel(item: TradeCard["items"][number], leagueId: string) {
  const label = formatTradeItemLabel(item);

  if (!item.fantasyPlayerId) {
    return label;
  }

  return (
    <Link
      href={`/fantasy-players/${item.fantasyPlayerId}?leagueId=${leagueId}`}
      className="underline decoration-current/40 underline-offset-2 hover:text-slate-300"
    >
      {label}
    </Link>
  );
}

function toggleSelection(values: string[], nextValue: string): string[] {
  return values.includes(nextValue) ? values.filter((value) => value !== nextValue) : [...values, nextValue];
}

function parseFaabValue(rawValue: string): number {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return 0;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : -1;
}

export function TradesManager({
  leagueId,
  currentTeamId,
  readOnly = false,
  teams,
  tradeablePlayers,
  trades,
}: TradesManagerProps) {
  const router = useRouter();

  const [recipientTeamId, setRecipientTeamId] = useState("");
  const [giveFantasyPlayerIds, setGiveFantasyPlayerIds] = useState<string[]>([]);
  const [getFantasyPlayerIds, setGetFantasyPlayerIds] = useState<string[]>([]);
  const [giveFaabAmount, setGiveFaabAmount] = useState("");
  const [getFaabAmount, setGetFaabAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actingTradeId, setActingTradeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const currentTeam = useMemo(
    () => teams.find((team) => team.id === currentTeamId) ?? null,
    [teams, currentTeamId],
  );

  const recipientTeam = useMemo(
    () => teams.find((team) => team.id === recipientTeamId) ?? null,
    [teams, recipientTeamId],
  );

  const myOutgoingOptions = useMemo(
    () => tradeablePlayers.filter((player) => player.teamId === currentTeamId),
    [tradeablePlayers, currentTeamId],
  );

  const incomingOptions = useMemo(
    () => tradeablePlayers.filter((player) => player.teamId === recipientTeamId),
    [tradeablePlayers, recipientTeamId],
  );

  const pendingTrades = useMemo(
    () => trades.filter((trade) => trade.status === "PROPOSED" || trade.status === "ACCEPTED"),
    [trades],
  );

  const pastTrades = useMemo(
    () => trades.filter((trade) => trade.status !== "PROPOSED" && trade.status !== "ACCEPTED"),
    [trades],
  );

  async function onSubmitTrade(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (readOnly) {
      setError("Preview mode is read-only.");
      return;
    }

    if (!currentTeamId || !currentTeam) {
      setError("You need a team in this league to propose trades.");
      return;
    }

    if (!recipientTeamId || !recipientTeam) {
      setError("Select a team to trade with.");
      return;
    }

    const outgoingPlayers = myOutgoingOptions.filter((item) => giveFantasyPlayerIds.includes(item.fantasyPlayerId));
    const incomingPlayers = incomingOptions.filter((item) => getFantasyPlayerIds.includes(item.fantasyPlayerId));
    const outgoingFaab = parseFaabValue(giveFaabAmount);
    const incomingFaab = parseFaabValue(getFaabAmount);

    if (outgoingFaab < 0 || incomingFaab < 0) {
      setError("FAAB amounts must be whole numbers greater than zero.");
      return;
    }

    if (outgoingFaab > currentTeam.waiverBudget) {
      setError(`You only have $${currentTeam.waiverBudget} FAAB available.`);
      return;
    }

    if (incomingFaab > recipientTeam.waiverBudget) {
      setError(`${recipientTeam.name} only has $${recipientTeam.waiverBudget} FAAB available.`);
      return;
    }

    if (outgoingPlayers.length === 0 && outgoingFaab === 0) {
      setError("Add at least one player or FAAB on your side of the trade.");
      return;
    }

    if (incomingPlayers.length === 0 && incomingFaab === 0) {
      setError("Add at least one player or FAAB on the other side of the trade.");
      return;
    }

    setSubmitting(true);

    const response = await fetch(`/api/leagues/${leagueId}/trades`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipientTeamId,
        items: [
          ...outgoingPlayers.map((player) => ({
            fromTeamId: currentTeamId,
            fantasyPlayerId: player.fantasyPlayerId,
            rosterSlotRole: player.role,
            rosterSlotIndex: player.slotIndex,
          })),
          ...incomingPlayers.map((player) => ({
            fromTeamId: recipientTeamId,
            fantasyPlayerId: player.fantasyPlayerId,
            rosterSlotRole: player.role,
            rosterSlotIndex: player.slotIndex,
          })),
          ...(outgoingFaab > 0
            ? [
                {
                  fromTeamId: currentTeamId,
                  faabAmount: outgoingFaab,
                },
              ]
            : []),
          ...(incomingFaab > 0
            ? [
                {
                  fromTeamId: recipientTeamId,
                  faabAmount: incomingFaab,
                },
              ]
            : []),
        ],
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    setSubmitting(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not propose trade");
      return;
    }

    setInfo("Trade proposed.");
    setGiveFantasyPlayerIds([]);
    setGetFantasyPlayerIds([]);
    setGiveFaabAmount("");
    setGetFaabAmount("");
    router.refresh();
  }

  async function runTradeAction(tradeId: string, action: "accept" | "reject" | "cancel" | "approve" | "veto") {
    setError(null);
    setInfo(null);

    if (readOnly) {
      setError("Preview mode is read-only.");
      return;
    }

    setActingTradeId(tradeId);

    const response = await fetch(`/api/trades/${tradeId}/${action}`, { method: "POST" });
    const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;

    setActingTradeId(null);

    if (!response.ok) {
      setError(payload?.error ?? `Could not ${action} trade`);
      return;
    }

    const successMessageByAction = {
      accept: "Trade accepted.",
      reject: "Trade rejected.",
      cancel: "Trade canceled.",
      approve: payload?.message ?? "Approval recorded.",
      veto: payload?.message ?? "Veto vote recorded.",
    } satisfies Record<typeof action, string>;

    setInfo(successMessageByAction[action]);
    router.refresh();
  }

  function renderTradeCard(trade: TradeCard) {
    const isRecipient = trade.recipientTeamId === currentTeamId;
    const isProposer = trade.proposerTeamId === currentTeamId;
    const canAcceptReject = trade.status === "PROPOSED" && isRecipient;
    const canCancel = trade.status === "PROPOSED" && isProposer;
    const eligibleVetoTeamCount = Math.max(teams.length - 2, 0);
    const vetoVotesNeeded = eligibleVetoTeamCount === 0 ? 0 : Math.floor(eligibleVetoTeamCount / 2) + 1;
    const hasCurrentTeamApproved = currentTeamId ? trade.approveVoteTeamIds.includes(currentTeamId) : false;
    const hasCurrentTeamVotedToVeto = currentTeamId ? trade.vetoVoteTeamIds.includes(currentTeamId) : false;
    const hasCurrentTeamReviewed = hasCurrentTeamApproved || hasCurrentTeamVotedToVeto;
    const canReviewTrade =
      trade.status === "ACCEPTED" &&
      Boolean(currentTeamId) &&
      !isRecipient &&
      !isProposer &&
      !hasCurrentTeamReviewed;
    const proposerItems = trade.items.filter((item) => item.fromTeamId === trade.proposerTeamId);
    const recipientItems = trade.items.filter((item) => item.fromTeamId === trade.recipientTeamId);

    return (
      <div key={trade.id} className="rounded-xl border border-slate-200 p-3">
        <p className="font-semibold">
          {trade.proposerTeamName} → {trade.recipientTeamName}
        </p>
        <p className="text-xs text-slate-500">
          Status: <span className={tradeStatusClassName(trade.status)}>{trade.status}</span>
        </p>
        <p className="text-xs text-slate-500">Updated: {formatDateTime(trade.updatedAt)}</p>
        {trade.reviewEndsAt ? (
          <p className="text-xs text-slate-500">Review ends: {formatDateTime(trade.reviewEndsAt)}</p>
        ) : null}
        {trade.status === "ACCEPTED" ? (
          <p className="text-xs text-slate-500">
            Votes: {trade.approveVoteTeamIds.length} approve, {trade.vetoVoteTeamIds.length}/{vetoVotesNeeded} veto
          </p>
        ) : null}
        {trade.status === "ACCEPTED" && hasCurrentTeamApproved ? (
          <p className="text-xs text-slate-500">Your team approved this trade.</p>
        ) : null}
        {trade.status === "ACCEPTED" && hasCurrentTeamVotedToVeto ? (
          <p className="text-xs text-slate-500">Your team voted to veto this trade.</p>
        ) : null}

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div
            className="rounded-lg border p-3"
            style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--border)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {trade.proposerTeamName} sends
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm text-[var(--foreground)]">
              {proposerItems.map((item) => (
                <li key={item.id}>{renderTradeItemLabel(item, leagueId)}</li>
              ))}
            </ul>
          </div>

          <div
            className="rounded-lg border p-3"
            style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--border)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {trade.recipientTeamName} sends
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm text-[var(--foreground)]">
              {recipientItems.map((item) => (
                <li key={item.id}>{renderTradeItemLabel(item, leagueId)}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {canAcceptReject ? (
            <>
              <button
                type="button"
                onClick={() => runTradeAction(trade.id, "accept")}
                disabled={readOnly || actingTradeId === trade.id}
                className="rounded bg-green-700 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => runTradeAction(trade.id, "reject")}
                disabled={readOnly || actingTradeId === trade.id}
                className="rounded bg-red-700 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                Reject
              </button>
            </>
          ) : null}

          {canCancel ? (
            <button
              type="button"
              onClick={() => runTradeAction(trade.id, "cancel")}
              disabled={readOnly || actingTradeId === trade.id}
              className="rounded bg-slate-700 px-3 py-1 text-xs text-white disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}

          {canReviewTrade ? (
            <>
              <button
                type="button"
                onClick={() => runTradeAction(trade.id, "approve")}
                disabled={readOnly || actingTradeId === trade.id}
                className="rounded bg-green-700 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => runTradeAction(trade.id, "veto")}
                disabled={readOnly || actingTradeId === trade.id}
                className="rounded bg-red-700 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                Veto
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {readOnly ? (
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
          Preview mode is read-only. Trade actions stay disabled while you are viewing another team&apos;s app.
        </div>
      ) : null}

      {currentTeamId ? (
        <form onSubmit={onSubmitTrade} className="space-y-4 rounded-xl border border-slate-200 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Propose Trade</h3>
            <p className="text-xs text-slate-500">Build either side with any mix of players and FAAB.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium">Recipient team</label>
            <select
              value={recipientTeamId}
              onChange={(event) => {
                setRecipientTeamId(event.target.value);
                setGetFantasyPlayerIds([]);
                setGetFaabAmount("");
              }}
              disabled={readOnly}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">Select team</option>
              {teams
                .filter((team) => team.id !== currentTeamId)
                .map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} (${team.waiverBudget} FAAB)
                  </option>
                ))}
            </select>
            <p className="text-xs text-slate-500">
              Your FAAB: ${currentTeam?.waiverBudget ?? 0}
              {recipientTeam ? ` | ${recipientTeam.name} FAAB: $${recipientTeam.waiverBudget}` : ""}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-slate-200 p-3">
              <div>
                <h4 className="text-sm font-semibold">You send</h4>
                <p className="text-xs text-slate-500">Select one or more players and optionally include FAAB.</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">Players</p>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {myOutgoingOptions.length === 0 ? (
                    <p className="text-xs text-slate-500">No players available to trade.</p>
                  ) : (
                    myOutgoingOptions.map((player) => {
                      const checked = giveFantasyPlayerIds.includes(player.fantasyPlayerId);
                      return (
                        <label
                          key={player.fantasyPlayerId}
                          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setGiveFantasyPlayerIds((current) => toggleSelection(current, player.fantasyPlayerId))}
                            disabled={readOnly}
                            className="mt-0.5"
                          />
                          <span>
                            {player.playerName}
                            <span className="text-slate-500"> ({formatRoleLabel(player.role)} #{player.slotIndex})</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium" htmlFor="give-faab">
                  FAAB
                </label>
                <input
                  id="give-faab"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={currentTeam?.waiverBudget ?? 0}
                  step={1}
                  value={giveFaabAmount}
                  onChange={(event) => setGiveFaabAmount(event.target.value)}
                  disabled={readOnly}
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 p-3">
              <div>
                <h4 className="text-sm font-semibold">You receive</h4>
                <p className="text-xs text-slate-500">Select players from the other team and/or ask for FAAB.</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">Players</p>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {!recipientTeamId ? (
                    <p className="text-xs text-slate-500">Choose a team first.</p>
                  ) : incomingOptions.length === 0 ? (
                    <p className="text-xs text-slate-500">No tradeable players found on that roster.</p>
                  ) : (
                    incomingOptions.map((player) => {
                      const checked = getFantasyPlayerIds.includes(player.fantasyPlayerId);
                      return (
                        <label
                          key={player.fantasyPlayerId}
                          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setGetFantasyPlayerIds((current) => toggleSelection(current, player.fantasyPlayerId))}
                            disabled={readOnly}
                            className="mt-0.5"
                          />
                          <span>
                            {player.playerName}
                            <span className="text-slate-500"> ({formatRoleLabel(player.role)} #{player.slotIndex})</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium" htmlFor="get-faab">
                  FAAB
                </label>
                <input
                  id="get-faab"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={recipientTeam?.waiverBudget ?? 0}
                  step={1}
                  value={getFaabAmount}
                  onChange={(event) => setGetFaabAmount(event.target.value)}
                  disabled={readOnly || !recipientTeam}
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={readOnly || submitting}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Propose Trade"}
          </button>
        </form>
      ) : (
        <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">
          Join a team in this league to propose trades.
        </div>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {info ? <p className="text-sm text-green-700">{info}</p> : null}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Pending Trades</h3>
        {pendingTrades.length === 0 ? (
          <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">No pending trades.</div>
        ) : (
          pendingTrades.map((trade) => renderTradeCard(trade))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Past Trades</h3>
        {pastTrades.length === 0 ? (
          <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">No past trades.</div>
        ) : (
          pastTrades.map((trade) => renderTradeCard(trade))
        )}
      </div>
    </div>
  );
}

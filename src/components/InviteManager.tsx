"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface InviteSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedById: string | null;
}

interface InviteManagerProps {
  leagueId: string;
  isCommissioner: boolean;
  isMember: boolean;
  inviteToken?: string;
  defaultTeamName?: string;
  initialInvites?: InviteSummary[];
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString();
}

function parseInviteToken(input: string): string {
  try {
    const maybeUrl = new URL(input);
    return maybeUrl.searchParams.get("inviteToken") ?? input;
  } catch {
    return input;
  }
}

export function InviteManager({
  leagueId,
  isCommissioner,
  isMember,
  inviteToken,
  defaultTeamName = "My Team",
  initialInvites = [],
}: InviteManagerProps) {
  const router = useRouter();

  const [expiresInHours, setExpiresInHours] = useState(72);
  const [teamName, setTeamName] = useState(defaultTeamName);
  const [joinTokenInput, setJoinTokenInput] = useState(inviteToken ?? "");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingJoin, setLoadingJoin] = useState(false);
  const [invites, setInvites] = useState<InviteSummary[]>(initialInvites);

  const openInvites = useMemo(() => invites.filter((item) => !item.usedAt), [invites]);

  async function refreshInvites() {
    if (!isCommissioner) {
      return;
    }

    const response = await fetch(`/api/leagues/${leagueId}/invites`, { method: "GET" });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { invites?: InviteSummary[] };
    setInvites(payload.invites ?? []);
  }

  async function onCreateInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setLoadingCreate(true);

    const response = await fetch(`/api/leagues/${leagueId}/invites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresInHours }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { inviteLink?: string; error?: string }
      | null;

    setLoadingCreate(false);

    if (!response.ok || !payload?.inviteLink) {
      setError(payload?.error ?? "Could not create invite link");
      return;
    }

    setCreatedLink(payload.inviteLink);
    setInfo("Invite link created.");
    await refreshInvites();
  }

  async function onCopyLink() {
    if (!createdLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdLink);
      setInfo("Invite link copied to clipboard.");
    } catch {
      setInfo("Copy failed. You can still select and copy the link manually.");
    }
  }

  async function onJoinLeague(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setLoadingJoin(true);

    const parsedToken = parseInviteToken(joinTokenInput.trim());

    const response = await fetch(`/api/leagues/${leagueId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inviteToken: parsedToken,
        teamName,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    setLoadingJoin(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not join league");
      return;
    }

    setInfo("Joined league successfully.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Invites</h2>

      {isCommissioner ? (
        <form onSubmit={onCreateInvite} className="space-y-2 rounded-xl border border-slate-200 p-3">
          <label className="block text-sm font-medium">Invite expiration</label>
          <select
            value={expiresInHours}
            onChange={(event) => setExpiresInHours(Number(event.target.value))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value={24}>24 hours</option>
            <option value={72}>72 hours</option>
            <option value={168}>7 days</option>
          </select>

          <button
            type="submit"
            disabled={loadingCreate}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loadingCreate ? "Creating..." : "Create Invite Link"}
          </button>
        </form>
      ) : null}

      {createdLink ? (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <p className="text-xs text-slate-500">Latest invite link</p>
          <p className="break-all rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{createdLink}</p>
          <button type="button" onClick={onCopyLink} className="w-full rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white">
            Copy Link
          </button>
        </div>
      ) : null}

      {isCommissioner ? (
        <div className="rounded-xl border border-slate-200 p-3">
          <h3 className="mb-2 text-sm font-semibold">Recent invites</h3>
          {invites.length === 0 ? (
            <p className="text-sm text-slate-500">No invites yet.</p>
          ) : (
            <ul className="space-y-2 text-xs text-slate-600">
              {invites.map((invite) => (
                <li key={invite.id} className="rounded-lg bg-slate-50 p-2">
                  <p>Created: {formatDateTime(invite.createdAt)}</p>
                  <p>Expires: {formatDateTime(invite.expiresAt)}</p>
                  <p>Status: {invite.usedAt ? `Used at ${formatDateTime(invite.usedAt)}` : "Open"}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">Open invites: {openInvites.length}</p>
        </div>
      ) : null}

      {!isMember ? (
        <form onSubmit={onJoinLeague} className="space-y-2 rounded-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Join League</h3>
          <label className="block text-xs font-medium">Invite token or full invite link</label>
          <input
            value={joinTokenInput}
            onChange={(event) => setJoinTokenInput(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Paste invite token or link"
            required
          />

          <label className="block text-xs font-medium">Team name</label>
          <input
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />

          <button
            type="submit"
            disabled={loadingJoin}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loadingJoin ? "Joining..." : "Join League"}
          </button>
        </form>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {info ? <p className="text-sm text-green-700">{info}</p> : null}
    </div>
  );
}

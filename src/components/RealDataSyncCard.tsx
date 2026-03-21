"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface RealDataStatus {
  tmdbConfigured: boolean;
  seasonYear: number;
  movieCount: number;
  personCount: number;
  fantasyPlayerCount: number;
  creditCount: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  jobState: string | null;
}

interface RealDataSyncCardProps {
  leagueId: string;
  isCommissioner: boolean;
  initialStatus: RealDataStatus;
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString();
}

function isJobRunning(jobState: string | null): boolean {
  return jobState === "waiting" || jobState === "active" || jobState === "delayed" || jobState === "waiting-children";
}

export function RealDataSyncCard({ leagueId, isCommissioner, initialStatus }: RealDataSyncCardProps) {
  const router = useRouter();
  const [status, setStatus] = useState<RealDataStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const response = await fetch(`/api/leagues/${leagueId}/ingestion/season`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { status?: RealDataStatus };
    if (payload.status) {
      setStatus(payload.status);
    }
  }, [leagueId]);

  useEffect(() => {
    if (!isJobRunning(status.jobState)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshStatus();
      router.refresh();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [refreshStatus, router, status.jobState]);

  async function onStartIngestion() {
    setError(null);
    setInfo(null);
    setLoading(true);

    const response = await fetch(`/api/leagues/${leagueId}/ingestion/season`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;

    setLoading(false);
    if (!response.ok) {
      setError(payload?.error ?? "Could not start ingestion");
      return;
    }

    setInfo(payload?.message ?? "Ingestion queued.");
    await refreshStatus();
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Real Player Data</h2>
      <p className="text-sm text-slate-600">Import real movies and credits for {status.seasonYear} from TMDB.</p>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <p>Movies: {status.movieCount}</p>
        <p>People: {status.personCount}</p>
        <p>Fantasy players: {status.fantasyPlayerCount}</p>
        <p>Credits: {status.creditCount}</p>
        <p className="text-xs text-slate-500">Ingestion job: {status.jobState ?? "idle"}</p>
      </div>

      {status.lastSuccessAt ? <p className="text-xs text-green-700">Last successful import: {formatDateTime(status.lastSuccessAt)}</p> : null}
      {status.lastErrorMessage ? (
        <p className="text-xs text-red-600">
          Last error{status.lastErrorAt ? ` (${formatDateTime(status.lastErrorAt)})` : ""}: {status.lastErrorMessage}
        </p>
      ) : null}

      {!status.tmdbConfigured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          TMDB is not configured yet. Add `TMDB_API_KEY` to `.env`, then restart with `Start Movie Game.command`.
        </div>
      ) : null}

      {isCommissioner ? (
        <button
          type="button"
          onClick={onStartIngestion}
          disabled={loading || !status.tmdbConfigured || isJobRunning(status.jobState)}
          className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Starting..." : isJobRunning(status.jobState) ? "Ingestion Running..." : "Import / Refresh Real Data"}
        </button>
      ) : (
        <p className="text-xs text-slate-500">Only the commissioner can start ingestion.</p>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {info ? <p className="text-sm text-green-700">{info}</p> : null}
    </div>
  );
}

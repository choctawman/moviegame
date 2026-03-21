"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ProviderStatusItem {
  providerName: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

interface WeekStatItem {
  id: string;
  movieId: string;
  movieTitle: string;
  movieUrl: string;
  rottenTomatoesUrl: string | null;
  boxOfficeMojoUrl: string | null;
  weekIndex: number;
  worldwideGrossUsd: string;
  endOfMonthWorldwideGrossUsd: string;
  rtCriticsScore: number | null;
  rtAudienceScore: number | null;
  dataStatus: "SUCCESS" | "FAILED" | "MANUAL_OVERRIDE";
  errorMessage: string | null;
  snapshotAt: string;
  manualOverrideAt: string | null;
  needsManualBoxOfficeReview: boolean;
}

interface SeasonStatItem {
  id: string;
  movieId: string;
  movieTitle: string;
  seasonYear: number;
  worldwideGrossUsd: string;
  rtCriticsScore: number | null;
  rtAudienceScore: number | null;
  dataStatus: "SUCCESS" | "FAILED" | "MANUAL_OVERRIDE";
  errorMessage: string | null;
  snapshotAt: string;
  manualOverrideAt: string | null;
}

interface DataHealthManagerProps {
  leagueId: string;
  isCommissioner: boolean;
  timezone: string;
  selectedWeekLabel: string;
  providerStatuses: ProviderStatusItem[];
  failedWeekStats: WeekStatItem[];
  failedSeasonStats: SeasonStatItem[];
  editableWeekStats: WeekStatItem[];
  editableSeasonStats: SeasonStatItem[];
}

function formatDateTime(value: string | null, timezone: string): string {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(date);
}

function parseNullableInt(raw: FormDataEntryValue | null): number | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInt(raw: FormDataEntryValue | null): number | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function statusClasses(status: "SUCCESS" | "FAILED" | "MANUAL_OVERRIDE"): string {
  if (status === "FAILED") {
    return "border border-rose-400/20 bg-rose-400/10 text-rose-200";
  }
  if (status === "MANUAL_OVERRIDE") {
    return "border border-amber-400/20 bg-amber-400/10 text-amber-200";
  }
  return "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
}

function statusLabel(status: "SUCCESS" | "FAILED" | "MANUAL_OVERRIDE"): string {
  if (status === "FAILED") {
    return "Import Failed";
  }
  if (status === "MANUAL_OVERRIDE") {
    return "Manual Override";
  }
  return "Imported";
}

function parseErrorParts(errorMessage: string | null): string[] {
  if (!errorMessage) {
    return [];
  }
  return errorMessage
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function summarizeActionItems(item: {
  errorMessage: string | null;
  rtCriticsScore: number | null;
  rtAudienceScore: number | null;
  needsManualBoxOfficeReview?: boolean;
}): string[] {
  const parts = parseErrorParts(item.errorMessage);
  const actions = new Set<string>();

  if (item.needsManualBoxOfficeReview) {
    actions.add("Add manual monthly box office value");
  }

  for (const part of parts) {
    if (part.includes("TMDB did not return an IMDb title id")) {
      actions.add("Add manual box office value (IMDb mapping unavailable)");
    }
    if (part.includes("Could not parse WORLDWIDE gross")) {
      actions.add("Add manual box office value");
    }
    if (part.includes("returned no RT scores")) {
      actions.add("RT scores not published yet (shown as '-')");
    }
  }

  if (item.rtCriticsScore == null && item.rtAudienceScore == null && parts.length === 0) {
    actions.add("RT scores not published yet (shown as '-')");
  }

  if (actions.size === 0) {
    return ["Review technical error details"];
  }

  return Array.from(actions);
}

export function DataHealthManager({
  leagueId,
  isCommissioner,
  timezone,
  selectedWeekLabel,
  providerStatuses,
  failedWeekStats,
  failedSeasonStats,
  editableWeekStats,
  editableSeasonStats,
}: DataHealthManagerProps) {
  const router = useRouter();
  const [editableWeekRows, setEditableWeekRows] = useState(editableWeekStats);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingMovieId, setRemovingMovieId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const manualBoxOfficeReviewCount = editableWeekRows.filter((row) => row.needsManualBoxOfficeReview).length;
  const sectionClass = "rounded-xl border border-white/10 bg-slate-950/70 p-4";
  const insetClass = "rounded-xl border border-white/10 bg-slate-900/70 p-3";
  const softInsetClass = "rounded-lg border border-white/10 bg-slate-950/70 p-3";
  const labelClass = "mb-1 block text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-400";
  const inputClass =
    "mt-1 w-full rounded-lg border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40";
  const primaryButtonClass =
    "rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50";
  const dangerButtonClass =
    "rounded-lg border border-rose-400/20 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-50";

  async function submitWeekOverride(event: React.FormEvent<HTMLFormElement>, statId: string) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const endOfMonthGross = parseNonNegativeInt(formData.get("endOfMonthWorldwideGrossUsd"));
    const critics = parseNullableInt(formData.get("rtCriticsScore"));
    const audience = parseNullableInt(formData.get("rtAudienceScore"));

    if (endOfMonthGross == null) {
      setError("End-of-month worldwide box office must be a non-negative whole number.");
      return;
    }

    setSavingId(statId);
    const response = await fetch(`/api/leagues/${leagueId}/data-health/week-stats/${statId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endOfMonthWorldwideGrossUsd: endOfMonthGross,
        rtCriticsScore: critics,
        rtAudienceScore: audience,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSavingId(null);

    if (!response.ok) {
      setError(payload?.error ?? "Could not update monthly score.");
      return;
    }

    setInfo("Month-end total saved. Monthly box office was recalculated automatically.");
    setEditableWeekRows((currentRows) => currentRows.filter((row) => row.id !== statId));
  }

  async function submitSeasonOverride(event: React.FormEvent<HTMLFormElement>, statId: string) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const gross = parseNonNegativeInt(formData.get("worldwideGrossUsd"));
    const critics = parseNullableInt(formData.get("rtCriticsScore"));
    const audience = parseNullableInt(formData.get("rtAudienceScore"));

    if (gross == null) {
      setError("Worldwide gross must be a non-negative whole number.");
      return;
    }

    setSavingId(statId);
    const response = await fetch(`/api/leagues/${leagueId}/data-health/season-stats/${statId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worldwideGrossUsd: gross,
        rtCriticsScore: critics,
        rtAudienceScore: audience,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSavingId(null);

    if (!response.ok) {
      setError(payload?.error ?? "Could not update season score.");
      return;
    }

    setInfo("Season score updated.");
    router.refresh();
  }

  async function removeMovieFromLeague(movieId: string, movieTitle: string) {
    if (!isCommissioner) {
      return;
    }
    const confirmed = window.confirm(
      `Remove "${movieTitle}" from this league? This hides it from draft/player pool/scoring data for this league.`,
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setInfo(null);
    setRemovingMovieId(movieId);

    const response = await fetch(`/api/leagues/${leagueId}/movies/${movieId}`, {
      method: "DELETE",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; weekStatsDeleted?: number } | null;

    setRemovingMovieId(null);
    if (!response.ok) {
      setError(payload?.error ?? "Could not remove movie from league.");
      return;
    }

    setEditableWeekRows((currentRows) => currentRows.filter((row) => row.movieId !== movieId));
    setInfo(`Removed "${movieTitle}" from this league.${typeof payload?.weekStatsDeleted === "number" ? ` Deleted ${payload.weekStatsDeleted} monthly stat rows.` : ""}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-slate-200">Provider Status</h2>
        <div className="space-y-2 text-xs">
          {providerStatuses.map((status) => (
            <div key={status.providerName} className={softInsetClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-white">{status.providerName}</p>
                <span
                  className={`rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${
                    status.lastErrorMessage ? "border border-rose-400/20 bg-rose-400/10 text-rose-200" : "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                  }`}
                >
                  {status.lastErrorMessage ? "Attention" : "Healthy"}
                </span>
              </div>
              <p className="mt-2 text-slate-300">Last success: {formatDateTime(status.lastSuccessAt, timezone)}</p>
              <p className="text-slate-400">Last error: {formatDateTime(status.lastErrorAt, timezone)}</p>
              {status.lastErrorMessage ? <p className="mt-2 text-rose-200">Error: {status.lastErrorMessage}</p> : null}
            </div>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="mb-1 text-base font-semibold text-white">Current Failures</h2>
        <p className="mb-3 text-sm text-slate-300">
          Each card shows what was unavailable and lets commissioners fix values directly.
        </p>
        {failedWeekStats.length === 0 && failedSeasonStats.length === 0 ? (
          <p className="text-sm text-slate-300">No failed rows currently recorded.</p>
        ) : (
          <div className="space-y-3">
            {failedWeekStats.map((row) => {
              const actions = summarizeActionItems(row);
              const errorParts = parseErrorParts(row.errorMessage);

              return (
                <article key={`wf-${row.id}`} className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-slate-100">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      Monthly: Month {row.weekIndex} •{" "}
                      <Link href={`/movies/${row.movieId}?leagueId=${leagueId}`} className="text-cyan-200 underline decoration-cyan-300/60 underline-offset-2">
                        {row.movieTitle}
                      </Link>
                    </p>
                    <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-rose-200">
                      Failed
                    </span>
                  </div>
                  <p className="mb-2 text-xs text-slate-300">Snapshot: {formatDateTime(row.snapshotAt, timezone)}</p>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {actions.map((item) => (
                      <span key={item} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-200">
                        {item}
                      </span>
                    ))}
                  </div>
                  <p className="mb-2 text-xs text-slate-300">
                    Current values: Box Office ${Number(row.worldwideGrossUsd || "0").toLocaleString()} • RT Critics{" "}
                    {row.rtCriticsScore ?? "-"} • RT Audience {row.rtAudienceScore ?? "-"}
                  </p>
                  {isCommissioner ? (
                    <div className={insetClass}>
                      <form onSubmit={(event) => submitWeekOverride(event, row.id)} className="space-y-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className="text-xs text-slate-300">
                            Worldwide Gross (USD)
                            <input
                              name="worldwideGrossUsd"
                              type="number"
                              min={0}
                              step={1}
                              defaultValue={row.worldwideGrossUsd}
                              className={inputClass}
                              disabled={savingId === row.id || removingMovieId === row.movieId}
                            />
                          </label>
                          <label className="text-xs text-slate-300">
                            RT Critics
                            <input
                              name="rtCriticsScore"
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={row.rtCriticsScore ?? ""}
                              className={inputClass}
                              disabled={savingId === row.id || removingMovieId === row.movieId}
                            />
                          </label>
                          <label className="text-xs text-slate-300">
                            RT Audience
                            <input
                              name="rtAudienceScore"
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={row.rtAudienceScore ?? ""}
                              className={inputClass}
                              disabled={savingId === row.id || removingMovieId === row.movieId}
                            />
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="submit"
                            disabled={savingId === row.id || removingMovieId === row.movieId}
                            className={primaryButtonClass}
                          >
                            {savingId === row.id ? "Saving..." : "Save Monthly Fix"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeMovieFromLeague(row.movieId, row.movieTitle)}
                            disabled={savingId === row.id || removingMovieId === row.movieId}
                            className={dangerButtonClass}
                          >
                            {removingMovieId === row.movieId ? "Removing..." : "Remove Movie from League"}
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : null}
                  {errorParts.length > 0 ? (
                    <details className="mt-2 rounded-lg border border-white/10 bg-slate-950/70 p-3 text-xs text-slate-300">
                      <summary className="cursor-pointer font-medium text-white">Technical details</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {errorParts.map((part) => (
                          <li key={part}>{part}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </article>
              );
            })}

            {failedSeasonStats.map((row) => {
              const actions = summarizeActionItems(row);
              const errorParts = parseErrorParts(row.errorMessage);

              return (
                <article key={`sf-${row.id}`} className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-slate-100">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      Previous Season {row.seasonYear} •{" "}
                      <Link href={`/movies/${row.movieId}?leagueId=${leagueId}`} className="text-cyan-200 underline decoration-cyan-300/60 underline-offset-2">
                        {row.movieTitle}
                      </Link>
                    </p>
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-200">
                      Failed
                    </span>
                  </div>
                  <p className="mb-2 text-xs text-slate-300">Snapshot: {formatDateTime(row.snapshotAt, timezone)}</p>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {actions.map((item) => (
                      <span key={item} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-200">
                        {item}
                      </span>
                    ))}
                  </div>
                  <p className="mb-2 text-xs text-slate-300">
                    Current values: Box Office ${Number(row.worldwideGrossUsd || "0").toLocaleString()} • RT Critics{" "}
                    {row.rtCriticsScore ?? "-"} • RT Audience {row.rtAudienceScore ?? "-"}
                  </p>
                  {isCommissioner ? (
                    <div className={insetClass}>
                      <form onSubmit={(event) => submitSeasonOverride(event, row.id)} className="space-y-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className="text-xs text-slate-300">
                            Worldwide Gross (USD)
                            <input
                              name="worldwideGrossUsd"
                              type="number"
                              min={0}
                              step={1}
                              defaultValue={row.worldwideGrossUsd}
                              className={inputClass}
                              disabled={savingId === row.id || removingMovieId === row.movieId}
                            />
                          </label>
                          <label className="text-xs text-slate-300">
                            RT Critics
                            <input
                              name="rtCriticsScore"
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={row.rtCriticsScore ?? ""}
                              className={inputClass}
                              disabled={savingId === row.id || removingMovieId === row.movieId}
                            />
                          </label>
                          <label className="text-xs text-slate-300">
                            RT Audience
                            <input
                              name="rtAudienceScore"
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={row.rtAudienceScore ?? ""}
                              className={inputClass}
                              disabled={savingId === row.id || removingMovieId === row.movieId}
                            />
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="submit"
                            disabled={savingId === row.id || removingMovieId === row.movieId}
                            className={primaryButtonClass}
                          >
                            {savingId === row.id ? "Saving..." : "Save Season Fix"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeMovieFromLeague(row.movieId, row.movieTitle)}
                            disabled={savingId === row.id || removingMovieId === row.movieId}
                            className={dangerButtonClass}
                          >
                            {removingMovieId === row.movieId ? "Removing..." : "Remove Movie from League"}
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : null}
                  {errorParts.length > 0 ? (
                    <details className="mt-2 rounded-lg border border-white/10 bg-slate-950/70 p-3 text-xs text-slate-300">
                      <summary className="cursor-pointer font-medium text-white">Technical details</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {errorParts.map((part) => (
                          <li key={part}>{part}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className={sectionClass}>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-slate-200">Monthly Scores ({selectedWeekLabel})</h2>
        <p className="mb-2 text-sm text-slate-300">Only movies that still need manual month-end box office entry are listed here.</p>
        {manualBoxOfficeReviewCount > 0 ? (
          <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p className="font-semibold">Manual box office review needed for {manualBoxOfficeReviewCount} row{manualBoxOfficeReviewCount === 1 ? "" : "s"}.</p>
            <p className="mt-1 text-amber-50/90">
              Boundary snapshots now automate month scoring going forward. These rows still need help because automatic month-boundary box office could not be trusted or could not be found.
            </p>
          </div>
        ) : null}
        <div className="space-y-2">
          {editableWeekRows.length === 0 ? (
            <p className="text-sm text-slate-300">No monthly rows currently need manual box office entry.</p>
          ) : null}
          {editableWeekRows.map((row) => (
            <form
              key={row.id}
              onSubmit={(event) => submitWeekOverride(event, row.id)}
              className="rounded-xl border border-white/10 bg-slate-900/70 p-3 text-xs"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-medium text-white">
                  Month {row.weekIndex} • {row.movieTitle}
                </p>
                <div className="flex items-center gap-2">
                  {row.needsManualBoxOfficeReview ? (
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-200">
                      Review Box Office
                    </span>
                  ) : null}
                  {row.dataStatus !== "SUCCESS" ? (
                    <span className={`rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${statusClasses(row.dataStatus)}`}>
                      {statusLabel(row.dataStatus)}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="mb-2 text-[11px] text-slate-400">
                Snapshot: {formatDateTime(row.snapshotAt, timezone)}
                {row.manualOverrideAt ? ` • Manual override: ${formatDateTime(row.manualOverrideAt, timezone)}` : ""}
              </p>
              <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
                <Link href={row.movieUrl} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-slate-200">
                  Movie Page
                </Link>
                {row.rottenTomatoesUrl ? (
                  <a
                    href={row.rottenTomatoesUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-slate-200"
                  >
                    Rotten Tomatoes
                  </a>
                ) : null}
                {row.boxOfficeMojoUrl ? (
                  <a
                    href={row.boxOfficeMojoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-slate-200"
                  >
                    Box Office Mojo
                  </a>
                ) : null}
              </div>
              {row.needsManualBoxOfficeReview ? (
                <p className="mb-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                  Enter the movie's cumulative worldwide box office total as of the end of this month. The app will subtract earlier months automatically to derive this month's gross.
                </p>
              ) : null}
              {row.errorMessage ? <p className="mb-2 text-[11px] text-rose-200">Error: {row.errorMessage}</p> : null}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label>
                  <span className={labelClass}>End-of-Month Worldwide Total (USD)</span>
                  <input
                    name="endOfMonthWorldwideGrossUsd"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={row.endOfMonthWorldwideGrossUsd}
                    className={inputClass}
                    disabled={!isCommissioner || savingId === row.id || removingMovieId === row.movieId}
                  />
                </label>
                <label>
                  <span className={labelClass}>RT Critics</span>
                  <input
                    name="rtCriticsScore"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={row.rtCriticsScore ?? ""}
                    className={inputClass}
                    disabled={!isCommissioner || savingId === row.id || removingMovieId === row.movieId}
                  />
                </label>
                <label>
                  <span className={labelClass}>RT Audience</span>
                  <input
                    name="rtAudienceScore"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={row.rtAudienceScore ?? ""}
                    className={inputClass}
                    disabled={!isCommissioner || savingId === row.id || removingMovieId === row.movieId}
                  />
                </label>
              </div>
              {isCommissioner ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={savingId === row.id || removingMovieId === row.movieId}
                    className={primaryButtonClass}
                  >
                    {savingId === row.id ? "Saving..." : "Save Monthly Override"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeMovieFromLeague(row.movieId, row.movieTitle)}
                    disabled={savingId === row.id || removingMovieId === row.movieId}
                    className={dangerButtonClass}
                  >
                    {removingMovieId === row.movieId ? "Removing..." : "Remove Movie from League"}
                  </button>
                </div>
              ) : null}
            </form>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-slate-200">Previous Season Scores</h2>
        <p className="mb-2 text-sm text-slate-300">These values feed Player Pool and player detail last-year points.</p>
        <div className="space-y-2">
          {editableSeasonStats.map((row) => (
            <form
              key={row.id}
              onSubmit={(event) => submitSeasonOverride(event, row.id)}
              className="rounded-xl border border-white/10 bg-slate-900/70 p-3 text-xs"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-medium text-white">
                  {row.seasonYear} • {row.movieTitle}
                </p>
                <span className={`rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${statusClasses(row.dataStatus)}`}>
                  {row.dataStatus.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mb-2 text-[11px] text-slate-400">
                Snapshot: {formatDateTime(row.snapshotAt, timezone)}
                {row.manualOverrideAt ? ` • Manual override: ${formatDateTime(row.manualOverrideAt, timezone)}` : ""}
              </p>
              {row.errorMessage ? <p className="mb-2 text-[11px] text-rose-200">Error: {row.errorMessage}</p> : null}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label>
                  <span className={labelClass}>Worldwide Gross (USD)</span>
                  <input
                    name="worldwideGrossUsd"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={row.worldwideGrossUsd}
                    className={inputClass}
                    disabled={!isCommissioner || savingId === row.id}
                  />
                </label>
                <label>
                  <span className={labelClass}>RT Critics</span>
                  <input
                    name="rtCriticsScore"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={row.rtCriticsScore ?? ""}
                    className={inputClass}
                    disabled={!isCommissioner || savingId === row.id}
                  />
                </label>
                <label>
                  <span className={labelClass}>RT Audience</span>
                  <input
                    name="rtAudienceScore"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={row.rtAudienceScore ?? ""}
                    className={inputClass}
                    disabled={!isCommissioner || savingId === row.id}
                  />
                </label>
              </div>
              {isCommissioner ? (
                <button
                  type="submit"
                  disabled={savingId === row.id}
                  className={`mt-2 ${primaryButtonClass}`}
                >
                  {savingId === row.id ? "Saving..." : "Save Season Override"}
                </button>
              ) : null}
            </form>
          ))}
        </div>
      </section>

      {error ? <p className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
      {info ? <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">{info}</p> : null}
    </div>
  );
}

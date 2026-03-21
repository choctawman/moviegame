"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const FALLBACK_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
];

export function CreateLeagueForm() {
  const router = useRouter();
  const { currentYear, browserTimezone, timezoneOptions } = useMemo(() => {
    const year = new Date().getFullYear();
    const resolvedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
    const supported =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : FALLBACK_TIMEZONES;

    const options = Array.from(new Set([resolvedTimezone, ...supported, ...FALLBACK_TIMEZONES])).sort((a, b) =>
      a.localeCompare(b),
    );

    return {
      currentYear: year,
      browserTimezone: resolvedTimezone,
      timezoneOptions: options,
    };
  }, []);

  const [name, setName] = useState(`${currentYear} Movie League`);
  const [seasonYear, setSeasonYear] = useState(currentYear);
  const [timezone, setTimezone] = useState(browserTimezone);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreateLeague(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    const response = await fetch("/api/leagues", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        seasonYear,
        timezone,
      }),
      signal: controller.signal,
    }).catch(() => null);

    window.clearTimeout(timeoutId);

    if (!response) {
      setLoading(false);
      setError("Request timed out. Please try again.");
      return;
    }

    const payload = (await response.json().catch(() => null)) as
      | { league?: { id: string }; error?: string }
      | null;

    setLoading(false);

    if (!response.ok || !payload?.league?.id) {
      setError(payload?.error ?? "Could not create league");
      return;
    }

    router.push(`/leagues/${payload.league.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onCreateLeague} className="space-y-3">
      <h2 className="text-lg font-semibold">Create League</h2>
      <p className="text-sm text-slate-600">Start your first league now.</p>

      <div>
        <label className="mb-1 block text-sm font-medium">League name</label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Season year</label>
          <input
            value={seasonYear}
            onChange={(event) => setSeasonYear(Number(event.target.value))}
            type="number"
            min={2020}
            max={2100}
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Timezone</label>
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
          >
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Creating..." : "Create League"}
      </button>
    </form>
  );
}

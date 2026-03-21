"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { appendLeagueView, setLeagueViewTeamParam } from "@/lib/leagueView";

interface RoleEntry {
  id: string;
  role: string;
  displayRole: string;
  isAvailable: boolean;
  rosteredByTeamName: string | null;
  previousSeasonYear: number;
  previousSeasonPointsTotal: number;
  currentSeasonPointsBoxOffice: number;
  currentSeasonPointsRt: number;
  currentSeasonPointsTotal: number;
}

interface PlayerPoolRow {
  personId: string;
  name: string;
  gender: number | null;
  fameScore: number | null;
  directorFameScore: number | null;
  profileImageUrl: string | null;
  roles: RoleEntry[];
  detailPlayerId: string;
  movieCount: number;
  movieTitles: string[];
  moviePosters: Array<{
    movieId: string;
    title: string;
    url: string | null;
    releaseDate: string | null;
    castFameScore: number;
    boxOfficePoints: number;
    rtPoints: number;
  }>;
  earliestReleaseDate: string | null;
  latestReleaseDate: string | null;
}

interface MoviePoolRow {
  id: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  totalAssociatedPlayers: number;
  availableRoleCount: number;
  castFameScore: number;
  boxOfficePoints: number;
  rtPoints: number;
  roleGroups: Array<{
    displayRole: string;
    players: Array<{
      personId: string;
      name: string;
      gender: number | null;
      fameScore: number | null;
      profileImageUrl: string | null;
      detailPlayerId: string;
      roleEntry: RoleEntry;
    }>;
  }>;
}

interface PlayerPoolManagerProps {
  leagueId: string;
  teamId: string | null;
  viewTeamId?: string | null;
  players: PlayerPoolRow[];
  movies: MoviePoolRow[];
  currentSeasonYear: number;
  initialFilters: {
    view: string;
    q: string;
    role: string;
    availableOnly: boolean;
    playerSort: string;
    movieSort: string;
  };
}

type ViewMode = "PLAYERS" | "MOVIES";

type PlayerSortOption =
  | "MOVIE_COUNT_DESC"
  | "NAME_ASC"
  | "CURRENT_SEASON_BOX_OFFICE_DESC"
  | "CURRENT_SEASON_RT_DESC"
  | "CURRENT_SEASON_TOTAL_DESC"
  | "LAST_SEASON_POINTS_DESC"
  | "FAME_DESC"
  | "EARLIEST_RELEASE_ASC"
  | "LATEST_RELEASE_DESC";

type MovieSortOption =
  | "EARLIEST_RELEASE_ASC"
  | "LATEST_RELEASE_DESC"
  | "UPCOMING_RELEASE_ASC"
  | "TITLE_ASC"
  | "CURRENT_SEASON_BOX_OFFICE_DESC"
  | "CURRENT_SEASON_RT_DESC"
  | "CURRENT_SEASON_TOTAL_DESC"
  | "PLAYER_COUNT_DESC"
  | "CAST_FAME_DESC"
  | "CAST_CREW_PAST_POINTS_DESC";

const releaseDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(isoDate: string | null): string {
  if (!isoDate) {
    return "Release date TBD";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return releaseDateFormatter.format(date);
}

function prettyRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pluralRoleLabel(role: string): string {
  const label = prettyRoleLabel(role);
  if (label.endsWith("Actress")) {
    return `${label}es`;
  }
  if (label.endsWith("Actor")) {
    return `${label}s`;
  }
  if (label.endsWith("Director")) {
    return `${label}s`;
  }
  if (label === "Supporting") {
    return "Supporting Actors";
  }
  return label.endsWith("s") ? label : `${label}s`;
}

function withDate(value: string | null, fallback: number): number {
  return value ? new Date(value).getTime() : fallback;
}

function formatPoints(value: number): string {
  return value.toFixed(2);
}

function roleTeamText(roles: RoleEntry[]): string {
  const teams = Array.from(
    new Set(roles.filter((entry) => !entry.isAvailable).map((entry) => entry.rosteredByTeamName ?? "another team")),
  );
  return teams.join(", ");
}

function fameForVisibleRole(player: PlayerPoolRow, visibleRole: string): number {
  if (visibleRole === "DIRECTOR") {
    return player.directorFameScore ?? Number.NEGATIVE_INFINITY;
  }
  return player.fameScore ?? Number.NEGATIVE_INFINITY;
}

function compareByFameThenName(a: PlayerPoolRow, b: PlayerPoolRow, visibleRole: string): number {
  const aFame = fameForVisibleRole(a, visibleRole);
  const bFame = fameForVisibleRole(b, visibleRole);
  if (aFame !== bFame) {
    return bFame - aFame;
  }
  return a.name.localeCompare(b.name);
}

function sumCastFame(
  roleGroups: MoviePoolRow["roleGroups"],
): number {
  const seenPeople = new Set<string>();
  let total = 0;

  for (const group of roleGroups) {
    for (const player of group.players) {
      if (seenPeople.has(player.personId)) {
        continue;
      }
      seenPeople.add(player.personId);
      total += player.fameScore ?? 0;
    }
  }

  return total;
}

function sumCastCrewPastPoints(
  roleGroups: MoviePoolRow["roleGroups"],
): number {
  const bestPointsByPerson = new Map<string, number>();

  for (const group of roleGroups) {
    for (const player of group.players) {
      const existing = bestPointsByPerson.get(player.personId) ?? Number.NEGATIVE_INFINITY;
      bestPointsByPerson.set(player.personId, Math.max(existing, player.roleEntry.previousSeasonPointsTotal));
    }
  }

  return Array.from(bestPointsByPerson.values()).reduce((sum, points) => sum + points, 0);
}

export function PlayerPoolManager({
  leagueId,
  teamId,
  viewTeamId,
  players,
  movies,
  currentSeasonYear,
  initialFilters,
}: PlayerPoolManagerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const initialViewMode = initialFilters.view === "MOVIES" ? "MOVIES" : "PLAYERS";
  const normalizedPlayerSort =
    initialFilters.playerSort === "CURRENT_SEASON_POINTS_DESC"
      ? "CURRENT_SEASON_TOTAL_DESC"
      : initialFilters.playerSort;
  const initialPlayerSort = (
    [
      "MOVIE_COUNT_DESC",
      "NAME_ASC",
      "CURRENT_SEASON_BOX_OFFICE_DESC",
      "CURRENT_SEASON_RT_DESC",
      "CURRENT_SEASON_TOTAL_DESC",
      "LAST_SEASON_POINTS_DESC",
      "FAME_DESC",
      "EARLIEST_RELEASE_ASC",
      "LATEST_RELEASE_DESC",
    ] as const
  ).includes(normalizedPlayerSort as PlayerSortOption)
    ? (normalizedPlayerSort as PlayerSortOption)
    : "MOVIE_COUNT_DESC";
  const normalizedMovieSort =
    initialFilters.movieSort === "RELEASE_ASC"
      ? "EARLIEST_RELEASE_ASC"
      : initialFilters.movieSort === "RELEASE_DESC"
        ? "LATEST_RELEASE_DESC"
        : initialFilters.movieSort === "CURRENT_SEASON_POINTS_DESC"
          ? "CURRENT_SEASON_TOTAL_DESC"
        : initialFilters.movieSort;
  const initialMovieSort = (
    [
      "EARLIEST_RELEASE_ASC",
      "LATEST_RELEASE_DESC",
      "UPCOMING_RELEASE_ASC",
      "TITLE_ASC",
      "CURRENT_SEASON_BOX_OFFICE_DESC",
      "CURRENT_SEASON_RT_DESC",
      "CURRENT_SEASON_TOTAL_DESC",
      "PLAYER_COUNT_DESC",
      "CAST_FAME_DESC",
      "CAST_CREW_PAST_POINTS_DESC",
    ] as const
  ).includes(normalizedMovieSort as MovieSortOption)
    ? (normalizedMovieSort as MovieSortOption)
    : "CAST_FAME_DESC";

  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [q, setQ] = useState(initialFilters.q);
  const [role, setRole] = useState(initialFilters.role);
  const [playerSortBy, setPlayerSortBy] = useState<PlayerSortOption>(initialPlayerSort);
  const [movieSortBy, setMovieSortBy] = useState<MovieSortOption>(initialMovieSort);
  const [searchNowMs] = useState<number>(() => Date.now());
  const [availableOnly, setAvailableOnly] = useState(initialFilters.availableOnly);
  const [expandedMovieRoleGroups, setExpandedMovieRoleGroups] = useState<Record<string, boolean>>({});

  const roleOptions = useMemo(() => {
    return Array.from(new Set(players.flatMap((player) => player.roles.map((entry) => entry.displayRole)))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [players]);

  const filteredPlayers = useMemo(() => {
    const normalized = q.trim().toLowerCase();
    const filtered = players.filter((player) => {
      const filteredRoles = role
        ? player.roles.filter((entry) => entry.displayRole === role)
        : player.roles;
      if (filteredRoles.length === 0) {
        return false;
      }
      if (availableOnly && !filteredRoles.some((entry) => entry.isAvailable)) {
        return false;
      }

      if (normalized.length > 0) {
        const matchesName = player.name.toLowerCase().includes(normalized);
        const matchesMovie = player.movieTitles.some((title) => title.toLowerCase().includes(normalized));
        if (!matchesName && !matchesMovie) {
          return false;
        }
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      const lastSeasonPointsForSort = (player: PlayerPoolRow): number => {
        const visibleRoles = role ? player.roles.filter((entry) => entry.displayRole === role) : player.roles;
        return visibleRoles.reduce((max, entry) => Math.max(max, entry.previousSeasonPointsTotal), 0);
      };
      const currentSeasonBoxOfficeForSort = (player: PlayerPoolRow): number => {
        const visibleRoles = role ? player.roles.filter((entry) => entry.displayRole === role) : player.roles;
        return visibleRoles.reduce((max, entry) => Math.max(max, entry.currentSeasonPointsBoxOffice), 0);
      };
      const currentSeasonRtForSort = (player: PlayerPoolRow): number => {
        const visibleRoles = role ? player.roles.filter((entry) => entry.displayRole === role) : player.roles;
        return visibleRoles.reduce((max, entry) => Math.max(max, entry.currentSeasonPointsRt), 0);
      };
      const currentSeasonTotalForSort = (player: PlayerPoolRow): number => {
        const visibleRoles = role ? player.roles.filter((entry) => entry.displayRole === role) : player.roles;
        return visibleRoles.reduce((max, entry) => Math.max(max, entry.currentSeasonPointsTotal), 0);
      };

      if (playerSortBy === "CURRENT_SEASON_BOX_OFFICE_DESC") {
        return currentSeasonBoxOfficeForSort(b) - currentSeasonBoxOfficeForSort(a) || compareByFameThenName(a, b, role);
      }
      if (playerSortBy === "CURRENT_SEASON_RT_DESC") {
        return currentSeasonRtForSort(b) - currentSeasonRtForSort(a) || compareByFameThenName(a, b, role);
      }
      if (playerSortBy === "CURRENT_SEASON_TOTAL_DESC") {
        return currentSeasonTotalForSort(b) - currentSeasonTotalForSort(a) || compareByFameThenName(a, b, role);
      }
      if (playerSortBy === "LAST_SEASON_POINTS_DESC") {
        return lastSeasonPointsForSort(b) - lastSeasonPointsForSort(a) || compareByFameThenName(a, b, role);
      }
      if (playerSortBy === "FAME_DESC") {
        return compareByFameThenName(a, b, role);
      }
      if (playerSortBy === "MOVIE_COUNT_DESC") {
        return b.movieCount - a.movieCount || compareByFameThenName(a, b, role);
      }
      if (playerSortBy === "EARLIEST_RELEASE_ASC") {
        return (
          withDate(a.earliestReleaseDate, Number.MAX_SAFE_INTEGER) -
            withDate(b.earliestReleaseDate, Number.MAX_SAFE_INTEGER) ||
          compareByFameThenName(a, b, role)
        );
      }
      if (playerSortBy === "LATEST_RELEASE_DESC") {
        return withDate(b.latestReleaseDate, 0) - withDate(a.latestReleaseDate, 0) || compareByFameThenName(a, b, role);
      }
      return a.name.localeCompare(b.name);
    });
  }, [players, q, role, availableOnly, playerSortBy]);

  const filteredMovies = useMemo(() => {
    const normalized = q.trim().toLowerCase();

    const filtered = movies
      .map((movie) => {
        const roleGroups = movie.roleGroups
          .map((group) => ({
            ...group,
            players: availableOnly
              ? group.players.filter((player) => player.roleEntry.isAvailable)
              : group.players,
          }))
          .filter((group) => group.players.length > 0)
          .filter((group) => (role ? group.displayRole === role : true));

        const totalAssociatedPlayers = new Set(
          roleGroups.flatMap((group) => group.players.map((player) => player.personId)),
        ).size;
        const availableRoleCount = roleGroups.reduce(
          (count, group) => count + group.players.filter((player) => player.roleEntry.isAvailable).length,
          0,
        );
        const castFameScore = sumCastFame(roleGroups);
        const castCrewPastPoints = sumCastCrewPastPoints(roleGroups);
        const currentSeasonBoxOfficePoints = movie.boxOfficePoints;
        const currentSeasonRtPoints = movie.rtPoints;
        const currentSeasonTotalPoints = Number((movie.boxOfficePoints + movie.rtPoints).toFixed(2));

        return {
          ...movie,
          roleGroups,
          totalAssociatedPlayers,
          availableRoleCount,
          castFameScore,
          castCrewPastPoints,
          currentSeasonBoxOfficePoints,
          currentSeasonRtPoints,
          currentSeasonTotalPoints,
        };
      })
      .filter((movie) => {
        if (normalized.length > 0 && !movie.title.toLowerCase().includes(normalized)) {
          return false;
        }
        if (movie.roleGroups.length === 0) {
          return false;
        }
        if (movieSortBy === "UPCOMING_RELEASE_ASC") {
          return movie.releaseDate != null && withDate(movie.releaseDate, 0) > searchNowMs;
        }
        return true;
      });

    return [...filtered].sort((a, b) => {
      if (movieSortBy === "EARLIEST_RELEASE_ASC") {
        return (
          withDate(a.releaseDate, Number.MAX_SAFE_INTEGER) - withDate(b.releaseDate, Number.MAX_SAFE_INTEGER) ||
          a.title.localeCompare(b.title)
        );
      }
      if (movieSortBy === "LATEST_RELEASE_DESC") {
        return withDate(b.releaseDate, 0) - withDate(a.releaseDate, 0) || a.title.localeCompare(b.title);
      }
      if (movieSortBy === "UPCOMING_RELEASE_ASC") {
        return (
          withDate(a.releaseDate, Number.MAX_SAFE_INTEGER) - withDate(b.releaseDate, Number.MAX_SAFE_INTEGER) ||
          a.title.localeCompare(b.title)
        );
      }
      if (movieSortBy === "CURRENT_SEASON_BOX_OFFICE_DESC") {
        return b.currentSeasonBoxOfficePoints - a.currentSeasonBoxOfficePoints || a.title.localeCompare(b.title);
      }
      if (movieSortBy === "CURRENT_SEASON_RT_DESC") {
        return b.currentSeasonRtPoints - a.currentSeasonRtPoints || a.title.localeCompare(b.title);
      }
      if (movieSortBy === "CURRENT_SEASON_TOTAL_DESC") {
        return b.currentSeasonTotalPoints - a.currentSeasonTotalPoints || a.title.localeCompare(b.title);
      }
      if (movieSortBy === "PLAYER_COUNT_DESC") {
        return b.totalAssociatedPlayers - a.totalAssociatedPlayers || a.title.localeCompare(b.title);
      }
      if (movieSortBy === "CAST_FAME_DESC") {
        return b.castFameScore - a.castFameScore || a.title.localeCompare(b.title);
      }
      if (movieSortBy === "CAST_CREW_PAST_POINTS_DESC") {
        return b.castCrewPastPoints - a.castCrewPastPoints || a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
  }, [availableOnly, movieSortBy, movies, q, role, searchNowMs]);

  const stateQueryString = useMemo(() => {
    const params = setLeagueViewTeamParam(new URLSearchParams(), viewTeamId);
    if (viewMode !== "PLAYERS") {
      params.set("view", viewMode);
    }
    if (q.trim()) {
      params.set("q", q.trim());
    }
    if (role) {
      params.set("role", role);
    }
    if (availableOnly) {
      params.set("available", "1");
    }
    if (playerSortBy !== "MOVIE_COUNT_DESC") {
      params.set("psort", playerSortBy);
    }
    if (movieSortBy !== "CAST_FAME_DESC") {
      params.set("msort", movieSortBy);
    }
    return params.toString();
  }, [availableOnly, movieSortBy, playerSortBy, q, role, viewMode, viewTeamId]);

  const detailQueryString = useMemo(() => {
    const params = new URLSearchParams(stateQueryString);
    params.set("leagueId", leagueId);
    return params.toString();
  }, [leagueId, stateQueryString]);

  useEffect(() => {
    const nextUrl = stateQueryString ? `${pathname}?${stateQueryString}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [pathname, router, stateQueryString]);

  const showingCount = viewMode === "PLAYERS" ? filteredPlayers.length : filteredMovies.length;
  const showingLabel = viewMode === "PLAYERS" ? "players" : "movies";

  function movieRoleGroupKey(movieId: string, role: string): string {
    return `${movieId}:${role}`;
  }

  function toggleMovieRoleGroup(movieId: string, role: string): void {
    const key = movieRoleGroupKey(movieId, role);
    setExpandedMovieRoleGroups((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={appendLeagueView(`/leagues/${leagueId}/waivers`, viewTeamId)}
            className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-3 text-center text-sm font-medium text-slate-100"
          >
            Waivers
          </Link>
          <Link
            href={appendLeagueView(`/leagues/${leagueId}/trades`, viewTeamId)}
            className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-3 text-center text-sm font-medium text-slate-100"
          >
            Trades
          </Link>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-white/10 bg-slate-950/70 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setViewMode("PLAYERS")}
              className={`rounded-md border px-3 py-3 text-sm font-medium ${
                viewMode === "PLAYERS"
                  ? "border-white/20 bg-slate-800 text-white"
                  : "border-white/10 bg-slate-900/80 text-slate-300"
              }`}
            >
              By Player
            </button>
            <button
              type="button"
              onClick={() => setViewMode("MOVIES")}
              className={`rounded-md border px-3 py-3 text-sm font-medium ${
                viewMode === "MOVIES"
                  ? "border-white/20 bg-slate-800 text-white"
                  : "border-white/10 bg-slate-900/80 text-slate-300"
              }`}
            >
              By Movie
            </button>
          </div>

          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={viewMode === "PLAYERS" ? "Search player or movie" : "Search movie"}
            className="w-full rounded-md border px-4 py-3 text-sm"
          />

          <div className="grid grid-cols-2 gap-2">
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="w-full rounded-md border px-4 py-3 text-sm"
            >
              <option value="">All roles</option>
              {roleOptions.map((item) => (
                <option key={item} value={item}>
                  {prettyRoleLabel(item)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-md border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={availableOnly}
                onChange={(event) => setAvailableOnly(event.target.checked)}
              />
              Available only
            </label>
          </div>

          {viewMode === "PLAYERS" ? (
            <select
              value={playerSortBy}
              onChange={(event) => setPlayerSortBy(event.target.value as PlayerSortOption)}
              className="w-full rounded-md border px-4 py-3 text-sm"
            >
              <option value="MOVIE_COUNT_DESC">Sort: Most Movies</option>
              <option value="NAME_ASC">Sort: Name (A-Z)</option>
              <option value="CURRENT_SEASON_BOX_OFFICE_DESC">Sort: {currentSeasonYear} Box Office</option>
              <option value="CURRENT_SEASON_RT_DESC">Sort: {currentSeasonYear} RT</option>
              <option value="CURRENT_SEASON_TOTAL_DESC">Sort: {currentSeasonYear} Total</option>
              <option value="LAST_SEASON_POINTS_DESC">Sort: Last Year Points</option>
              <option value="FAME_DESC">Sort: Fame (High-Low)</option>
              <option value="EARLIEST_RELEASE_ASC">Sort: Earliest Release</option>
              <option value="LATEST_RELEASE_DESC">Sort: Latest Release</option>
            </select>
          ) : (
            <select
              value={movieSortBy}
              onChange={(event) => setMovieSortBy(event.target.value as MovieSortOption)}
              className="w-full rounded-md border px-4 py-3 text-sm"
            >
              <option value="CAST_FAME_DESC">Sort Movies: Cast Fame (High-Low)</option>
              <option value="EARLIEST_RELEASE_ASC">Sort Movies: Earliest Release</option>
              <option value="LATEST_RELEASE_DESC">Sort Movies: Latest Release</option>
              <option value="UPCOMING_RELEASE_ASC">Sort Movies: Upcoming Releases</option>
              <option value="TITLE_ASC">Sort Movies: Title (A-Z)</option>
              <option value="CURRENT_SEASON_BOX_OFFICE_DESC">Sort Movies: {currentSeasonYear} Box Office (High-Low)</option>
              <option value="CURRENT_SEASON_RT_DESC">Sort Movies: {currentSeasonYear} RT (High-Low)</option>
              <option value="CURRENT_SEASON_TOTAL_DESC">Sort Movies: {currentSeasonYear} Total (High-Low)</option>
              <option value="PLAYER_COUNT_DESC">Sort Movies: Most Associated Players</option>
              <option value="CAST_CREW_PAST_POINTS_DESC">Sort Movies: Cast/Crew Past Points (High-Low)</option>
            </select>
          )}

        {!teamId ? <p className="text-xs text-slate-400">Join a team to nominate and claim waiver players.</p> : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm text-slate-400">
          Showing {showingCount} {showingLabel}
        </p>

        {viewMode === "PLAYERS" ? (
          filteredPlayers.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-400">No players match these filters.</div>
          ) : (
            filteredPlayers.map((player) => {
              const visibleRoles = role
                ? player.roles.filter((entry) => entry.displayRole === role)
                : player.roles;
              const hasAvailableVisibleRole = visibleRoles.some((entry) => entry.isAvailable);
              const currentSeasonPoints = visibleRoles.reduce(
                (max, entry) => Math.max(max, entry.currentSeasonPointsTotal),
                0,
              );
              const lastSeasonSummary = visibleRoles
                .map((entry) => `${prettyRoleLabel(entry.displayRole)} ${formatPoints(entry.previousSeasonPointsTotal)} pts`)
                .join(" • ");

              return (
                <div key={player.personId} className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-4 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
                    <div className="space-y-3">
                      {player.profileImageUrl ? (
                        <Link href={`/fantasy-players/${player.detailPlayerId}?${detailQueryString}`}>
                          <Image
                            src={player.profileImageUrl}
                            alt={`${player.name} photo`}
                            width={104}
                            height={156}
                            className="h-28 w-[5.5rem] rounded-lg border border-white/10 object-cover sm:h-40 sm:w-[6.5rem]"
                          />
                        </Link>
                      ) : (
                        <div className="flex h-28 w-[5.5rem] items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 text-center text-[10px] text-slate-300 sm:h-40 sm:w-[6.5rem]">
                          No photo
                        </div>
                      )}

                      <div className="space-y-2">
                        <Link
                          href={`/fantasy-players/${player.detailPlayerId}?${detailQueryString}`}
                          className="block rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-center text-[11px] font-medium text-slate-100"
                        >
                          Details
                        </Link>
                        {hasAvailableVisibleRole ? (
                          <Link
                            href={appendLeagueView(`/leagues/${leagueId}/waivers`, viewTeamId)}
                            className="block rounded-md border border-white/10 bg-slate-800 px-3 py-2 text-center text-[11px] font-medium text-white"
                          >
                            Nominate
                          </Link>
                        ) : null}
                      </div>

                      <div className="rounded-lg border border-white/10 bg-slate-900/80 p-3 text-center">
                        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
                          {currentSeasonYear} Total
                        </p>
                        <p className="mt-1 text-lg font-semibold text-white">{formatPoints(currentSeasonPoints)}</p>
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-[1.1rem] font-semibold leading-tight text-white sm:text-[1.2rem]">
                          {player.name}
                        </p>
                        <span
                          className={`shrink-0 rounded-md px-2 py-1 text-xs ${
                            hasAvailableVisibleRole ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-900/80 text-slate-200"
                          }`}
                        >
                          {hasAvailableVisibleRole ? "Available" : "Rostered"}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {visibleRoles.map((roleEntry) => (
                          <span
                            key={`${player.personId}-${roleEntry.id}-${roleEntry.displayRole}`}
                            className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300"
                          >
                            {prettyRoleLabel(roleEntry.displayRole)}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                        <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                          Fame {(player.fameScore ?? 0).toFixed(1)}
                        </span>
                        <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                          {player.movieCount} movie{player.movieCount === 1 ? "" : "s"}
                        </span>
                        <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                          {visibleRoles[0]?.previousSeasonYear ?? "N/A"}
                        </span>
                      </div>

                      {player.moviePosters.length > 0 ? (
                        <div className="mt-3 flex gap-3 overflow-x-auto pb-1 pr-1">
                          {player.moviePosters.map((moviePoster) => (
                            <Link
                              key={`${player.personId}-${moviePoster.movieId}`}
                              href={`/movies/${moviePoster.movieId}?leagueId=${leagueId}`}
                              className="w-[8.75rem] shrink-0 rounded-xl border border-white/10 bg-slate-900/80 p-2"
                            >
                              {moviePoster.url ? (
                                <div className="flex h-[9.5rem] w-full items-center justify-center rounded-xl border border-white/10 bg-slate-950/80 p-1 sm:h-[11rem]">
                                  <Image
                                    src={moviePoster.url}
                                    alt={`${moviePoster.title} poster`}
                                    title={moviePoster.title}
                                    width={96}
                                    height={144}
                                    className="h-full w-full rounded-lg object-contain"
                                  />
                                </div>
                              ) : (
                                <div
                                  title={`${moviePoster.title} poster unavailable`}
                                  className="flex h-[9.5rem] w-full items-center justify-center rounded-xl border border-dashed border-white/10 bg-slate-950/80 px-2 text-center text-[10px] leading-tight text-slate-300 sm:h-[11rem]"
                                >
                                  {moviePoster.title}
                                </div>
                              )}
                              <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                                <p className="line-clamp-2 text-xs font-medium text-white">{moviePoster.title}</p>
                                <p>{formatDate(moviePoster.releaseDate)}</p>
                                <p>Fame {moviePoster.castFameScore.toFixed(1)}</p>
                                <p>{currentSeasonYear} Box {formatPoints(moviePoster.boxOfficePoints)}</p>
                                <p>{currentSeasonYear} RT {moviePoster.rtPoints}</p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      ) : null}

                      {!hasAvailableVisibleRole ? (
                        <p className="mt-1 text-xs text-slate-300">Rostered by {roleTeamText(visibleRoles)}</p>
                      ) : null}

                      <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/80 p-3">
                        <p className="text-[11px] text-slate-200">
                          Last Season ({visibleRoles[0]?.previousSeasonYear ?? "N/A"}): {lastSeasonSummary}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )
        ) : filteredMovies.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-400">No movies match these filters.</div>
        ) : (
          filteredMovies.map((movie) => {
            return (
              <div key={movie.id} className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-4 sm:grid-cols-[6.25rem_minmax(0,1fr)]">
                  <div className="space-y-3">
                    {movie.posterUrl ? (
                      <Link href={`/movies/${movie.id}?leagueId=${leagueId}`}>
                        <Image
                          src={movie.posterUrl}
                          alt={`${movie.title} poster`}
                          width={100}
                          height={150}
                          className="h-[7.5rem] w-20 rounded-lg border border-white/10 object-cover sm:h-[9.25rem] sm:w-[6.25rem]"
                        />
                      </Link>
                    ) : (
                      <div className="flex h-[7.5rem] w-20 items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 px-1 text-center text-[10px] text-slate-400 sm:h-[9.25rem] sm:w-[6.25rem]">
                        {movie.title}
                      </div>
                    )}
                    <div className="space-y-2">
                      <Link
                        href={`/movies/${movie.id}?leagueId=${leagueId}`}
                        className="block rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-center text-[11px] font-medium text-white"
                      >
                        Details
                      </Link>

                      <div className="rounded-lg border border-white/10 bg-slate-900/80 p-3 text-center">
                        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
                          {currentSeasonYear} Total
                        </p>
                        <p className="mt-1 text-base font-semibold text-white">
                          {formatPoints(movie.boxOfficePoints + movie.rtPoints)}
                        </p>
                        <p className="mt-2 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
                          Box Office
                        </p>
                        <p className="mt-1 text-base font-semibold text-white">{formatPoints(movie.boxOfficePoints)}</p>
                        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
                          RT
                        </p>
                        <p className="mt-1 text-base font-semibold text-white">{movie.rtPoints}</p>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[1.1rem] font-semibold leading-tight text-white">{movie.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                      <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                        {formatDate(movie.releaseDate)}
                      </span>
                      <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                        Players {movie.totalAssociatedPlayers}
                      </span>
                      <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                        Available {movie.availableRoleCount}
                      </span>
                      <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                        Fame {movie.castFameScore.toFixed(1)}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {movie.roleGroups.map((group) => {
                        const roleGroupKey = movieRoleGroupKey(movie.id, group.displayRole);
                        const isExpanded = expandedMovieRoleGroups[roleGroupKey] ?? false;

                        return (
                          <section key={`${movie.id}-${group.displayRole}`} className="rounded-lg border border-white/10 bg-slate-900/80 p-3">
                            <button
                              type="button"
                              onClick={() => toggleMovieRoleGroup(movie.id, group.displayRole)}
                              className="flex w-full items-center justify-between gap-2 text-left"
                            >
                              <p className="text-sm font-medium text-slate-200">
                                {pluralRoleLabel(group.displayRole)}
                              </p>
                              <span className="text-[11px] text-slate-400">
                                {group.players.length} {group.players.length === 1 ? "player" : "players"} {isExpanded ? "Hide" : "Show"}
                              </span>
                            </button>

                            {isExpanded ? (
                              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                                {group.players.map((player) => (
                                  <article
                                    key={`${movie.id}-${group.displayRole}-${player.personId}`}
                                    className="w-52 shrink-0 rounded-2xl border border-white/8 bg-white/[0.04] p-3"
                                  >
                                    <div className="flex items-start gap-2">
                                      {player.profileImageUrl ? (
                                        <Link href={`/fantasy-players/${player.detailPlayerId}?${detailQueryString}`}>
                                          <Image
                                            src={player.profileImageUrl}
                                            alt={`${player.name} photo`}
                                            width={48}
                                            height={72}
                                            className="h-[4.5rem] w-12 shrink-0 rounded-xl border border-white/10 object-cover"
                                          />
                                        </Link>
                                      ) : (
                                        <div className="flex h-[4.5rem] w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-900 text-center text-[9px] text-slate-400">
                                          No photo
                                        </div>
                                      )}

                                      <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 flex-col gap-1">
                                          <Link
                                            href={`/fantasy-players/${player.detailPlayerId}?${detailQueryString}`}
                                            className="min-w-0 truncate text-sm font-medium leading-tight text-white"
                                            title={player.name}
                                          >
                                            {player.name}
                                          </Link>
                                          <span
                                            className={`shrink-0 self-start rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                              player.roleEntry.isAvailable
                                                ? "bg-emerald-400/10 text-emerald-200"
                                                : "bg-white/[0.08] text-slate-300"
                                            }`}
                                          >
                                            {player.roleEntry.isAvailable ? "Available" : "Rostered"}
                                          </span>
                                        </div>
                                        {!player.roleEntry.isAvailable ? (
                                          <p className="mt-1 text-[11px] text-slate-600">
                                            Rostered by {player.roleEntry.rosteredByTeamName ?? "another team"}
                                          </p>
                                        ) : null}
                                        <p className="mt-1 text-[11px] text-slate-600">
                                          Last Season ({player.roleEntry.previousSeasonYear}):{" "}
                                          {formatPoints(player.roleEntry.previousSeasonPointsTotal)} pts
                                        </p>
                                      </div>
                                    </div>

                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {player.roleEntry.isAvailable ? (
                                        <Link
                                          href={appendLeagueView(`/leagues/${leagueId}/waivers`, viewTeamId)}
                                          className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] text-white"
                                        >
                                          Nominate to Waivers
                                        </Link>
                                      ) : null}
                                    </div>
                                  </article>
                                ))}
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

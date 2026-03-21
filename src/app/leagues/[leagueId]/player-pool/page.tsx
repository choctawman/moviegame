import type { FantasyRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { FantasyLeagueTabs } from "@/components/FantasyLeagueTabs";
import { LeagueViewSwitcher } from "@/components/LeagueViewSwitcher";
import { PlayerPoolManager } from "@/components/PlayerPoolManager";
import { tmdbImageUrl } from "@/lib/tmdbImage";
import { getSessionUser } from "@/server/auth/session";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { ensureFantasyPlayerSeasonStats } from "@/server/services/fantasyPlayerSeasonStatsService";
import { resolveLeagueViewContext } from "@/server/services/leagueViewService";
import {
  addCreditToFameSignal,
  addDirectedMovieToDirectorFameSignal,
  computeDirectorFameScore,
  computeFameScore,
  createEmptyDirectorFameSignal,
  createEmptyFameSignal,
} from "@/server/utils/fameScore";
import { getPreviousSeasonPointsWindow } from "@/server/utils/previousSeasonWindow";

export const dynamic = "force-dynamic";

interface GroupedRole {
  id: string;
  role: FantasyRole;
  displayRole: string;
  isAvailable: boolean;
  rosteredByTeamName: string | null;
  previousSeasonYear: number;
  previousSeasonPointsTotal: number;
  currentSeasonPointsBoxOffice: number;
  currentSeasonPointsRt: number;
  currentSeasonPointsTotal: number;
}

function personRoleKey(personId: string, role: FantasyRole): string {
  return `${personId}:${role}`;
}

function deriveDisplayRole(role: FantasyRole, gender: number | null): string {
  if (role === "SUPPORTING") {
    return gender === 1 ? "SUPPORTING_ACTRESS" : "SUPPORTING_ACTOR";
  }
  return role;
}

function creditMatchesFantasyRole(
  role: FantasyRole,
  credit: { creditType: "CAST" | "CREW"; billingOrder: number | null; job: string | null },
): boolean {
  if (role === "LEADING_ACTOR" || role === "LEADING_ACTRESS") {
    return credit.creditType === "CAST" && credit.billingOrder != null && credit.billingOrder <= 1;
  }
  if (role === "SUPPORTING") {
    return credit.creditType === "CAST" && credit.billingOrder != null && credit.billingOrder >= 2;
  }
  if (role === "DIRECTOR") {
    return credit.creditType === "CREW" && credit.job === "Director";
  }
  return false;
}

function isFemale(gender: number | null): boolean {
  return gender === 1;
}

export default async function PlayerPoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{
    view?: string;
    q?: string;
    role?: string;
    available?: string;
    psort?: string;
    msort?: string;
    viewTeamId?: string;
  }>;
}) {
  const { leagueId } = await params;
  const filters = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const [viewContext, league, nextWeek] = await Promise.all([
    resolveLeagueViewContext({
      leagueId,
      userId: user.id,
      requestedTeamId: filters.viewTeamId,
    }),
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, seasonYear: true },
    }),
    prisma.week.findFirst({
      where: {
        leagueId,
        endAt: {
          gte: new Date(),
        },
      },
      orderBy: { startAt: "asc" },
      select: { id: true },
    }),
  ]);

  if (!viewContext) {
    redirect("/");
  }
  if (!league) {
    redirect("/");
  }

  const { activeTeamId, isCommissioner, isPreviewing, previewTeamId, teams } = viewContext;

  const [rosteredPlayers, players] = await Promise.all([
    prisma.rosterSlot.findMany({
      where: {
        team: { leagueId },
        fantasyPlayerId: { not: null },
      },
      select: {
        fantasyPlayerId: true,
        team: { select: { name: true } },
      },
    }),
    prisma.fantasyPlayer.findMany({
      where: {
        role: { in: ACTIVE_FANTASY_ROLES_LIST },
        person: {
          credits: {
            some: {
              movie: {
                eligibleLeagues: {
                  some: { leagueId },
                },
              },
            },
          },
        },
      },
      select: {
        id: true,
        role: true,
        personId: true,
        person: {
          select: {
            name: true,
            gender: true,
            profilePath: true,
            tmdbPopularity: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { person: { name: "asc" } }],
      take: 10000,
    }),
  ]);

  const rosteredIds = new Set(
    rosteredPlayers.map((slot) => slot.fantasyPlayerId).filter((fantasyPlayerId): fantasyPlayerId is string => Boolean(fantasyPlayerId)),
  );
  const rosteredByPlayerId = new Map(
    rosteredPlayers
      .filter((slot) => slot.fantasyPlayerId)
      .map((slot) => [slot.fantasyPlayerId as string, slot.team.name]),
  );

  const { previousSeasonYear, startAt: previousSeasonStartAt, cutoffAt: previousSeasonCutoffAt } =
    getPreviousSeasonPointsWindow(league.seasonYear);

  const personIds = players.map((player) => player.personId);
  const [movieCredits, previousSeasonPointsByFantasyPlayerId, previousSeasonDirectorMovieCredits] = await Promise.all([
    personIds.length > 0
      ? prisma.credit.findMany({
          where: {
            personId: {
              in: personIds,
            },
            movie: {
              eligibleLeagues: {
                some: {
                  leagueId,
                },
              },
            },
          },
          select: {
            id: true,
            movieId: true,
            personId: true,
            creditType: true,
            billingOrder: true,
            job: true,
            person: {
              select: {
                name: true,
                gender: true,
                profilePath: true,
                tmdbPopularity: true,
              },
            },
            movie: {
              select: {
                id: true,
                title: true,
                posterPath: true,
                theatricalReleaseDate: true,
              },
            },
          },
          orderBy: [{ movieId: "asc" }, { billingOrder: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
    ensureFantasyPlayerSeasonStats({
      seasonYear: previousSeasonYear,
      startAt: previousSeasonStartAt,
      cutoffAt: previousSeasonCutoffAt,
      fantasyPlayers: players.map((player) => ({
        id: player.id,
        personId: player.personId,
        role: player.role,
      })),
    }),
    personIds.length > 0
      ? prisma.credit.findMany({
          where: {
            movie: {
              theatricalReleaseDate: {
                gte: previousSeasonStartAt,
                lte: previousSeasonCutoffAt,
              },
              credits: {
                some: {
                  personId: {
                    in: personIds,
                  },
                  creditType: "CREW",
                  job: "Director",
                },
              },
            },
            OR: [{ creditType: "CAST" }, { creditType: "CREW", job: "Director" }],
          },
          select: {
            id: true,
            movieId: true,
            personId: true,
            creditType: true,
            billingOrder: true,
            job: true,
            person: {
              select: {
                name: true,
                gender: true,
                profilePath: true,
                tmdbPopularity: true,
              },
            },
            movie: {
              select: {
                id: true,
                title: true,
                posterPath: true,
                theatricalReleaseDate: true,
              },
            },
          },
          orderBy: [{ movieId: "asc" }, { billingOrder: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const fameSignalByPerson = new Map<string, ReturnType<typeof createEmptyFameSignal>>();
  for (const credit of movieCredits) {
    const existing = fameSignalByPerson.get(credit.personId) ?? createEmptyFameSignal();
    addCreditToFameSignal(existing, {
      creditType: credit.creditType,
      billingOrder: credit.billingOrder,
      job: credit.job,
    });
    fameSignalByPerson.set(credit.personId, existing);
  }

  const personById = new Map(players.map((player) => [player.personId, player.person]));
  const baseFameScoreByPerson = new Map<string, number>();
  for (const [personId, person] of personById.entries()) {
    baseFameScoreByPerson.set(
      personId,
      computeFameScore(person.tmdbPopularity, fameSignalByPerson.get(personId) ?? createEmptyFameSignal()),
    );
  }

  function personFameForCredit(credit: { personId: string; person: { tmdbPopularity: number | null } }): number {
    return (
      baseFameScoreByPerson.get(credit.personId) ??
      computeFameScore(credit.person.tmdbPopularity, createEmptyFameSignal())
    );
  }

  const creditsByMovie = new Map<string, typeof movieCredits>();
  for (const credit of movieCredits) {
    const existing = creditsByMovie.get(credit.movieId) ?? [];
    existing.push(credit);
    creditsByMovie.set(credit.movieId, existing);
  }

  const movieIds = Array.from(creditsByMovie.keys());
  const movieScoreRows =
    movieIds.length > 0
      ? await prisma.movieSeasonStat.findMany({
          where: {
            seasonYear: league.seasonYear,
            movieId: {
              in: movieIds,
            },
          },
          select: {
            movieId: true,
            worldwideGrossUsd: true,
            rtCriticsScore: true,
            rtAudienceScore: true,
          },
        })
      : [];

  const movieScoreTotals = new Map<string, { boxOfficePoints: number; rtPoints: number; totalPoints: number }>();
  for (const row of movieScoreRows) {
    const boxOfficePoints = Number((Number(row.worldwideGrossUsd) / 1_000_000).toFixed(2));
    const rtPoints = (row.rtCriticsScore ?? 0) + (row.rtAudienceScore ?? 0);
    movieScoreTotals.set(row.movieId, {
      boxOfficePoints,
      rtPoints,
      totalPoints: Number((boxOfficePoints + rtPoints).toFixed(2)),
    });
  }

  const fantasyPlayerIdByPersonRole = new Map(players.map((player) => [personRoleKey(player.personId, player.role), player.id]));
  const currentSeasonMovieIdsByFantasyPlayerId = new Map<string, Set<string>>();
  for (const credit of movieCredits) {
    for (const role of ACTIVE_FANTASY_ROLES_LIST) {
      if (!creditMatchesFantasyRole(role, credit)) {
        continue;
      }

      const fantasyPlayerId = fantasyPlayerIdByPersonRole.get(personRoleKey(credit.personId, role));
      if (!fantasyPlayerId) {
        continue;
      }

      const existingMovieIds = currentSeasonMovieIdsByFantasyPlayerId.get(fantasyPlayerId) ?? new Set<string>();
      existingMovieIds.add(credit.movieId);
      currentSeasonMovieIdsByFantasyPlayerId.set(fantasyPlayerId, existingMovieIds);
    }
  }

  const currentSeasonStatsByFantasyPlayerId = new Map<
    string,
    { boxOfficePoints: number; rtPoints: number; totalPoints: number }
  >();
  for (const player of players) {
    const playerMovieIds = currentSeasonMovieIdsByFantasyPlayerId.get(player.id) ?? new Set<string>();
    let boxOfficePoints = 0;
    let rtPoints = 0;
    let totalPoints = 0;

    for (const movieId of playerMovieIds) {
      const totals = movieScoreTotals.get(movieId);
      if (!totals) {
        continue;
      }

      boxOfficePoints += totals.boxOfficePoints;
      rtPoints += totals.rtPoints;
      totalPoints += totals.totalPoints;
    }

    currentSeasonStatsByFantasyPlayerId.set(player.id, {
      boxOfficePoints: Number(boxOfficePoints.toFixed(2)),
      rtPoints,
      totalPoints: Number(totalPoints.toFixed(2)),
    });
  }

  const directorFameSignalByPerson = new Map<string, ReturnType<typeof createEmptyDirectorFameSignal>>();
  function applyDirectorMovieSignals(creditsForMovie: typeof movieCredits) {
    const castCredits = creditsForMovie
      .filter((credit) => credit.creditType === "CAST")
      .sort((a, b) => {
        const aOrder = a.billingOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.billingOrder ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        return a.person.name.localeCompare(b.person.name);
      });

    const movieCastFameScore = castCredits
      .slice(0, 3)
      .reduce((sum, credit) => sum + personFameForCredit(credit), 0);

    const directorIds = new Set(
      creditsForMovie
        .filter((credit) => credit.creditType === "CREW" && credit.job === "Director")
        .map((credit) => credit.personId),
    );

    for (const directorId of directorIds) {
      const existing = directorFameSignalByPerson.get(directorId) ?? createEmptyDirectorFameSignal();
      addDirectedMovieToDirectorFameSignal(existing, { castFameScore: movieCastFameScore });
      directorFameSignalByPerson.set(directorId, existing);
    }
  }

  for (const creditsForMovie of creditsByMovie.values()) {
    applyDirectorMovieSignals(creditsForMovie);
  }

  const previousSeasonCreditsByMovie = new Map<string, typeof previousSeasonDirectorMovieCredits>();
  for (const credit of previousSeasonDirectorMovieCredits) {
    const existing = previousSeasonCreditsByMovie.get(credit.movieId) ?? [];
    existing.push(credit);
    previousSeasonCreditsByMovie.set(credit.movieId, existing);
  }

  for (const creditsForMovie of previousSeasonCreditsByMovie.values()) {
    applyDirectorMovieSignals(creditsForMovie as typeof movieCredits);
  }

  const groupedPlayers = new Map<
    string,
    {
      personId: string;
      name: string;
      gender: number | null;
      fameScore: number | null;
      directorFameScore: number | null;
      profileImageUrl: string | null;
      roles: GroupedRole[];
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
      detailPlayerId: string;
    }
  >();

  for (const player of players) {
    const existing = groupedPlayers.get(player.personId) ?? {
      personId: player.personId,
      name: player.person.name,
      gender: player.person.gender,
      fameScore: baseFameScoreByPerson.get(player.personId) ?? 0,
      directorFameScore: computeDirectorFameScore(
        player.person.tmdbPopularity,
        directorFameSignalByPerson.get(player.personId) ?? createEmptyDirectorFameSignal(),
      ),
      profileImageUrl: tmdbImageUrl(player.person.profilePath, "w185"),
      roles: [],
      movieCount: 0,
      movieTitles: [],
      moviePosters: [],
      earliestReleaseDate: null,
      latestReleaseDate: null,
      detailPlayerId: player.id,
    };

    existing.roles.push({
      id: player.id,
      role: player.role,
      displayRole: deriveDisplayRole(player.role, player.person.gender),
      isAvailable: !rosteredIds.has(player.id),
      rosteredByTeamName: rosteredByPlayerId.get(player.id) ?? null,
      previousSeasonYear,
      previousSeasonPointsTotal: previousSeasonPointsByFantasyPlayerId.get(player.id) ?? 0,
      currentSeasonPointsBoxOffice: currentSeasonStatsByFantasyPlayerId.get(player.id)?.boxOfficePoints ?? 0,
      currentSeasonPointsRt: currentSeasonStatsByFantasyPlayerId.get(player.id)?.rtPoints ?? 0,
      currentSeasonPointsTotal: currentSeasonStatsByFantasyPlayerId.get(player.id)?.totalPoints ?? 0,
    });

    groupedPlayers.set(player.personId, existing);
  }

  for (const entry of groupedPlayers.values()) {
    entry.roles.sort((a, b) => a.displayRole.localeCompare(b.displayRole));
    entry.detailPlayerId = entry.roles[0]?.id ?? entry.detailPlayerId;
  }

  const roleLookupByPerson = new Map<string, Map<FantasyRole, GroupedRole>>();
  for (const player of groupedPlayers.values()) {
    const roleLookup = new Map<FantasyRole, GroupedRole>();
    for (const roleEntry of player.roles) {
      roleLookup.set(roleEntry.role, roleEntry);
    }
    roleLookupByPerson.set(player.personId, roleLookup);
  }

  const roleDisplayOrder = [
    "LEADING_ACTOR",
    "LEADING_ACTRESS",
    "SUPPORTING_ACTOR",
    "SUPPORTING_ACTRESS",
    "DIRECTOR",
  ];

  const movieList = Array.from(creditsByMovie.values()).map((creditsForMovie) => {
    const movie = creditsForMovie[0].movie;
    const castCredits = creditsForMovie.filter((credit) => credit.creditType === "CAST");
    const crewCredits = creditsForMovie.filter((credit) => credit.creditType === "CREW");
    type CastCredit = (typeof castCredits)[number];

    const selectedRoles: Array<{ personId: string; roleEntry: GroupedRole }> = [];

    function pushSelected(personId: string, role: FantasyRole, displayRole: string): boolean {
      const roleEntry = roleLookupByPerson.get(personId)?.get(role);
      const groupedPlayer = groupedPlayers.get(personId);
      if (!roleEntry) {
        return false;
      }
      if (!groupedPlayer) {
        return false;
      }

      selectedRoles.push({
        personId,
        roleEntry: {
          ...roleEntry,
          displayRole,
        },
      });

      return true;
    }

    function selectCast(
      limit: number,
      predicate: (credit: CastCredit) => boolean,
      role: FantasyRole,
      displayRole: string,
      options?: { sortByFame?: boolean },
    ) {
      const pickedPeople = new Set<string>();
      const sortByFame = options?.sortByFame ?? false;
      const rankedCredits = [...castCredits]
        .filter((credit) => predicate(credit))
        .sort((a, b) => {
          if (!sortByFame) {
            const aOrder = a.billingOrder ?? Number.MAX_SAFE_INTEGER;
            const bOrder = b.billingOrder ?? Number.MAX_SAFE_INTEGER;
            if (aOrder !== bOrder) {
              return aOrder - bOrder;
            }
            return a.person.name.localeCompare(b.person.name);
          }

          const aFame = groupedPlayers.get(a.personId)?.fameScore ?? Number.NEGATIVE_INFINITY;
          const bFame = groupedPlayers.get(b.personId)?.fameScore ?? Number.NEGATIVE_INFINITY;
          if (aFame !== bFame) {
            return bFame - aFame;
          }

          const aOrder = a.billingOrder ?? Number.MAX_SAFE_INTEGER;
          const bOrder = b.billingOrder ?? Number.MAX_SAFE_INTEGER;
          if (aOrder !== bOrder) {
            return aOrder - bOrder;
          }

          return a.person.name.localeCompare(b.person.name);
        });

      for (const credit of rankedCredits) {
        if (pickedPeople.size >= limit) {
          break;
        }
        if (pickedPeople.has(credit.personId)) {
          continue;
        }

        if (pushSelected(credit.personId, role, displayRole)) {
          pickedPeople.add(credit.personId);
        }
      }
    }

    function selectCrew(
      limit: number,
      predicate: (credit: (typeof crewCredits)[number]) => boolean,
      role: FantasyRole,
      displayRole: string,
    ) {
      const pickedPeople = new Set<string>();

      for (const credit of crewCredits) {
        if (pickedPeople.size >= limit) {
          break;
        }
        if (!predicate(credit) || pickedPeople.has(credit.personId)) {
          continue;
        }

        if (pushSelected(credit.personId, role, displayRole)) {
          pickedPeople.add(credit.personId);
        }
      }
    }

    const isLeading = (billingOrder: number | null) => billingOrder === 0 || billingOrder === 1;

    selectCast(
      Number.POSITIVE_INFINITY,
      (credit) => !isFemale(credit.person.gender) && isLeading(credit.billingOrder),
      "LEADING_ACTOR",
      "LEADING_ACTOR",
    );
    selectCast(
      Number.POSITIVE_INFINITY,
      (credit) => isFemale(credit.person.gender) && isLeading(credit.billingOrder),
      "LEADING_ACTRESS",
      "LEADING_ACTRESS",
    );
    selectCast(
      Number.POSITIVE_INFINITY,
      (credit) => !isFemale(credit.person.gender) && !isLeading(credit.billingOrder),
      "SUPPORTING",
      "SUPPORTING_ACTOR",
    );
    selectCast(
      Number.POSITIVE_INFINITY,
      (credit) => isFemale(credit.person.gender) && !isLeading(credit.billingOrder),
      "SUPPORTING",
      "SUPPORTING_ACTRESS",
    );

    selectCrew(Number.POSITIVE_INFINITY, (credit) => credit.job === "Director", "DIRECTOR", "DIRECTOR");
    const associatedByRole = new Map<
      string,
      {
        displayRole: string;
        players: Array<{
          personId: string;
          name: string;
          gender: number | null;
          fameScore: number | null;
          profileImageUrl: string | null;
          detailPlayerId: string;
          roleEntry: GroupedRole;
        }>;
      }
    >();

    for (const selectedRole of selectedRoles) {
      const groupedPlayer = groupedPlayers.get(selectedRole.personId);
      if (!groupedPlayer) {
        continue;
      }

      const existingRoleGroup = associatedByRole.get(selectedRole.roleEntry.displayRole) ?? {
        displayRole: selectedRole.roleEntry.displayRole,
        players: [],
      };

      if (!existingRoleGroup.players.some((player) => player.personId === groupedPlayer.personId)) {
        existingRoleGroup.players.push({
          personId: groupedPlayer.personId,
          name: groupedPlayer.name,
          gender: groupedPlayer.gender,
          fameScore: selectedRole.roleEntry.displayRole === "DIRECTOR" ? groupedPlayer.directorFameScore : groupedPlayer.fameScore,
          profileImageUrl: groupedPlayer.profileImageUrl,
          detailPlayerId: selectedRole.roleEntry.id,
          roleEntry: selectedRole.roleEntry,
        });
      }

      associatedByRole.set(selectedRole.roleEntry.displayRole, existingRoleGroup);
    }

    const roleGroups = roleDisplayOrder
      .map((displayRole) => {
        const group = associatedByRole.get(displayRole);
        if (!group) {
          return null;
        }
        return {
          displayRole,
          players: group.players.sort((a, b) => a.name.localeCompare(b.name)),
        };
      })
      .filter(Boolean) as Array<{
      displayRole: string;
      players: Array<{
        personId: string;
        name: string;
        gender: number | null;
        fameScore: number | null;
        profileImageUrl: string | null;
        detailPlayerId: string;
        roleEntry: GroupedRole;
      }>;
    }>;

    const totalAssociatedPlayers = new Set(
      roleGroups.flatMap((group) => group.players.map((player) => player.personId)),
    ).size;
    const availableRoleCount = roleGroups.reduce(
      (count, group) => count + group.players.filter((player) => player.roleEntry.isAvailable).length,
      0,
    );
    const castFameScore = Array.from(
      new Map(roleGroups.flatMap((group) => group.players.map((player) => [player.personId, player.fameScore ?? 0]))).values(),
    ).reduce((sum, fameScore) => sum + fameScore, 0);

    return {
      id: movie.id,
      title: movie.title,
      releaseDate: movie.theatricalReleaseDate?.toISOString() ?? null,
      posterUrl: tmdbImageUrl(movie.posterPath, "w342"),
      totalAssociatedPlayers,
      availableRoleCount,
      castFameScore,
      roleGroups,
    };
  });

  const scoredMovieList = movieList.map((movie) => {
    const totals = movieScoreTotals.get(movie.id);
    return {
      ...movie,
      boxOfficePoints: totals ? Number(totals.boxOfficePoints.toFixed(2)) : 0,
      rtPoints: totals?.rtPoints ?? 0,
    };
  });

  const selectedPersonMovieMeta = new Map<
    string,
    {
      movieIdSet: Set<string>;
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
      earliestReleaseDate: Date | null;
      latestReleaseDate: Date | null;
    }
  >();

  for (const movie of scoredMovieList) {
    const releaseDate = movie.releaseDate ? new Date(movie.releaseDate) : null;

    for (const group of movie.roleGroups) {
      for (const player of group.players) {
        const existing = selectedPersonMovieMeta.get(player.personId) ?? {
          movieIdSet: new Set<string>(),
          movieTitles: [],
          moviePosters: [],
          earliestReleaseDate: null,
          latestReleaseDate: null,
        };

        if (existing.movieIdSet.has(movie.id)) {
          selectedPersonMovieMeta.set(player.personId, existing);
          continue;
        }

        existing.movieIdSet.add(movie.id);

        if (existing.movieTitles.length < 3) {
          existing.movieTitles.push(movie.title);
        }

        existing.moviePosters.push({
          movieId: movie.id,
          title: movie.title,
          url: movie.posterUrl,
          releaseDate: movie.releaseDate,
          castFameScore: movie.castFameScore,
          boxOfficePoints: movie.boxOfficePoints,
          rtPoints: movie.rtPoints,
        });

        if (releaseDate) {
          if (!existing.earliestReleaseDate || releaseDate < existing.earliestReleaseDate) {
            existing.earliestReleaseDate = releaseDate;
          }
          if (!existing.latestReleaseDate || releaseDate > existing.latestReleaseDate) {
            existing.latestReleaseDate = releaseDate;
          }
        }

        selectedPersonMovieMeta.set(player.personId, existing);
      }
    }
  }

  const groupedPlayerList = Array.from(groupedPlayers.values())
    .map((player) => {
      const meta = selectedPersonMovieMeta.get(player.personId);
      if (!meta) {
        return {
          ...player,
          movieCount: 0,
          movieTitles: [],
          moviePosters: [],
          earliestReleaseDate: null,
          latestReleaseDate: null,
        };
      }

      return {
        ...player,
        movieCount: meta.movieIdSet.size,
        movieTitles: meta.movieTitles,
        moviePosters: meta.moviePosters,
        earliestReleaseDate: meta.earliestReleaseDate?.toISOString() ?? null,
        latestReleaseDate: meta.latestReleaseDate?.toISOString() ?? null,
      };
    })
    .filter((player) => player.movieCount > 0);

  return (
    <AppShell
      title="Players"
      hideHeaderText
      headerActions={isCommissioner ? <LeagueViewSwitcher teams={teams} activeTeamId={activeTeamId} isPreviewing={isPreviewing} /> : null}
    >
      <FantasyLeagueTabs
        leagueId={leagueId}
        teamId={activeTeamId}
        active="PLAYERS"
        matchHref={nextWeek ? `/leagues/${leagueId}/matchups/${nextWeek.id}` : `/leagues/${leagueId}/schedule`}
        viewTeamId={previewTeamId}
      />
      <PlayerPoolManager
        leagueId={leagueId}
        teamId={activeTeamId}
        viewTeamId={previewTeamId}
        players={groupedPlayerList}
        movies={scoredMovieList}
        currentSeasonYear={league.seasonYear}
        initialFilters={{
          view: filters.view ?? "",
          q: filters.q ?? "",
          role: filters.role ?? "",
          availableOnly: filters.available === "1",
          playerSort: filters.psort ?? "",
          movieSort: filters.msort ?? "",
        }}
      />
    </AppShell>
  );
}

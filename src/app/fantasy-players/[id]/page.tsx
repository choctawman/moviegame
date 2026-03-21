import Image from "next/image";
import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { tmdbImageUrl } from "@/lib/tmdbImage";
import { prisma } from "@/lib/prisma";
import { ACTIVE_FANTASY_ROLES_LIST } from "@/server/services/constants";
import { addCreditToFameSignal, computeFameScore, createEmptyFameSignal } from "@/server/utils/fameScore";
import { roundHalfUp } from "@/server/utils/math";
import { aggregateMovieDisplayScores, selectMovieSeasonDisplayScores } from "@/server/utils/movieDisplayScores";
import { getPreviousSeasonPointsWindow } from "@/server/utils/previousSeasonWindow";

export const dynamic = "force-dynamic";

function yearFromDate(value: Date | null): string {
  if (!value) {
    return "TBD";
  }
  return new Date(value).getFullYear().toString();
}

const releaseDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function releaseDateLabel(value: Date | null): string {
  if (!value) {
    return "Release date TBD";
  }
  return releaseDateFormatter.format(new Date(value));
}

function prettyRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function seasonStatToPoints(stat?: {
  worldwideGrossUsd: bigint;
  rtCriticsScore: number | null;
  rtAudienceScore: number | null;
}): { boxPoints: number; rtPoints: number; totalPoints: number } {
  if (!stat) {
    return {
      boxPoints: 0,
      rtPoints: 0,
      totalPoints: 0,
    };
  }

  const boxPoints = roundHalfUp(Number(stat.worldwideGrossUsd) / 1_000_000, 2);
  const rtPoints = (stat.rtCriticsScore ?? 0) + (stat.rtAudienceScore ?? 0);

  return {
    boxPoints,
    rtPoints,
    totalPoints: roundHalfUp(boxPoints + rtPoints, 2),
  };
}

function isFantasyRelevantCredit(credit: { creditType: "CAST" | "CREW"; job: string | null }): boolean {
  return credit.creditType === "CAST" || (credit.creditType === "CREW" && credit.job === "Director");
}

function formatPoints(value: number): string {
  return value.toFixed(2);
}

export default async function FantasyPlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ leagueId?: string }>;
}) {
  const { id } = await params;
  const { leagueId } = await searchParams;

  const league = leagueId
    ? await prisma.league.findUnique({
        where: { id: leagueId },
        select: { id: true, seasonYear: true },
      })
    : null;

  const player = await prisma.fantasyPlayer.findUnique({
    where: { id },
    include: {
      person: {
        include: {
          credits: {
            where: leagueId
              ? {
                  movie: {
                    eligibleLeagues: {
                      some: {
                        leagueId,
                      },
                    },
                  },
                }
              : undefined,
            orderBy: [{ movie: { theatricalReleaseDate: "asc" } }, { id: "asc" }],
            include: {
              movie: true,
            },
          },
        },
      },
    },
  });

  if (!player) {
    return <div>Player not found</div>;
  }

  const rolePlayers = await prisma.fantasyPlayer.findMany({
    where: {
      personId: player.personId,
      role: { in: ACTIVE_FANTASY_ROLES_LIST },
    },
    select: {
      id: true,
      role: true,
    },
    orderBy: [{ role: "asc" }],
  });

  const roleLabels = rolePlayers.map((entry) => prettyRoleLabel(entry.role));
  const rolePlayerIds = rolePlayers.map((entry) => entry.id);

  const rawWeekScores =
    rolePlayerIds.length > 0
      ? await prisma.fantasyPlayerWeekScore.findMany({
          where: {
            fantasyPlayerId: { in: rolePlayerIds },
            ...(league?.id ? { leagueId: league.id } : {}),
          },
          select: {
            id: true,
            leagueId: true,
            pointsBoxOffice: true,
            pointsRt: true,
            rtContribCount: true,
            week: {
              select: {
                id: true,
                index: true,
              },
            },
          },
          orderBy: [{ week: { index: "desc" } }, { id: "desc" }],
          take: 200,
        })
      : [];

  const weeklyTotalsByWeek = new Map<
    string,
    {
      weekId: string;
      weekIndex: number;
      leagueId: string;
      pointsBoxOffice: number;
      pointsRt: number;
      rtContribCount: number;
      totalPoints: number;
    }
  >();

  for (const score of rawWeekScores) {
    const existing = weeklyTotalsByWeek.get(score.week.id) ?? {
      weekId: score.week.id,
      weekIndex: score.week.index,
      leagueId: score.leagueId,
      pointsBoxOffice: 0,
      pointsRt: 0,
      rtContribCount: 0,
      totalPoints: 0,
    };

    const nextBoxPoints = roundHalfUp(existing.pointsBoxOffice + Number(score.pointsBoxOffice), 2);
    const nextRtPoints = existing.pointsRt + score.pointsRt;

    weeklyTotalsByWeek.set(score.week.id, {
      ...existing,
      pointsBoxOffice: nextBoxPoints,
      pointsRt: nextRtPoints,
      rtContribCount: existing.rtContribCount + score.rtContribCount,
      totalPoints: roundHalfUp(nextBoxPoints + nextRtPoints, 2),
    });
  }

  const recentMonthlyScores = Array.from(weeklyTotalsByWeek.values())
    .sort((a, b) => b.weekIndex - a.weekIndex)
    .slice(0, 20);

  const profileImageUrl = tmdbImageUrl(player.person.profilePath, "w185");

  const movies = Array.from(new Map(player.person.credits.map((credit) => [credit.movieId, credit.movie])).values()).sort((a, b) => {
    const aTime = a.theatricalReleaseDate ? new Date(a.theatricalReleaseDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.theatricalReleaseDate ? new Date(b.theatricalReleaseDate).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime || a.title.localeCompare(b.title);
  });
  const movieIds = movies.map((movie) => movie.id);
  const currentSeasonMovieData =
    movieIds.length > 0
      ? await (async () => {
          const [movieStats, movieSeasonStats] = await Promise.all([
            prisma.movieWeekStat.findMany({
              where: {
                movieId: { in: movieIds },
                ...(league?.id ? { leagueId: league.id } : {}),
              },
              select: {
                movieId: true,
                worldwideGrossUsd: true,
                rtCriticsScore: true,
                rtAudienceScore: true,
                snapshotAt: true,
                week: {
                  select: {
                    index: true,
                  },
                },
              },
            }),
            prisma.movieSeasonStat.findMany({
              where: {
                movieId: { in: movieIds },
                ...(league ? { seasonYear: league.seasonYear } : {}),
              },
              select: {
                movieId: true,
                seasonYear: true,
                worldwideGrossUsd: true,
                rtCriticsScore: true,
                rtAudienceScore: true,
                snapshotAt: true,
              },
              orderBy: [{ seasonYear: "desc" }, { snapshotAt: "desc" }, { id: "desc" }],
            }),
          ]);

          const associatedMovieCredits = await prisma.credit.findMany({
            where: {
              movieId: { in: movieIds },
              ...(league?.id
                ? {
                    movie: {
                      eligibleLeagues: {
                        some: { leagueId: league.id },
                      },
                    },
                  }
                : {}),
            },
            select: {
              movieId: true,
              personId: true,
              creditType: true,
              billingOrder: true,
              job: true,
              person: {
                select: {
                  tmdbPopularity: true,
                },
              },
            },
          });

          const associatedPersonIds = Array.from(new Set(associatedMovieCredits.map((credit) => credit.personId)));
          const fameCredits =
            associatedPersonIds.length > 0
              ? await prisma.credit.findMany({
                  where: {
                    personId: { in: associatedPersonIds },
                    ...(league?.id
                      ? {
                          movie: {
                            eligibleLeagues: {
                              some: { leagueId: league.id },
                            },
                          },
                        }
                      : {}),
                  },
                  select: {
                    personId: true,
                    creditType: true,
                    billingOrder: true,
                    job: true,
                    person: {
                      select: {
                        tmdbPopularity: true,
                      },
                    },
                  },
                })
              : [];

          const seasonScoreByMovieId = selectMovieSeasonDisplayScores(movieSeasonStats, {
            seasonYear: league?.seasonYear,
          });
          const fallbackScoreByMovieId = aggregateMovieDisplayScores(movieStats);

          const fameSignalByPerson = new Map<string, ReturnType<typeof createEmptyFameSignal>>();
          const popularityByPerson = new Map<string, number | null>();
          for (const credit of fameCredits) {
            const existing = fameSignalByPerson.get(credit.personId) ?? createEmptyFameSignal();
            addCreditToFameSignal(existing, {
              creditType: credit.creditType,
              billingOrder: credit.billingOrder,
              job: credit.job,
            });
            fameSignalByPerson.set(credit.personId, existing);
            if (!popularityByPerson.has(credit.personId)) {
              popularityByPerson.set(credit.personId, credit.person.tmdbPopularity);
            }
          }

          const castFameByMovieId = new Map<string, number>();
          const seenByMovie = new Map<string, Set<string>>();
          for (const credit of associatedMovieCredits) {
            if (!isFantasyRelevantCredit({ creditType: credit.creditType, job: credit.job })) {
              continue;
            }

            const seenPeople = seenByMovie.get(credit.movieId) ?? new Set<string>();
            if (seenPeople.has(credit.personId)) {
              continue;
            }
            seenPeople.add(credit.personId);
            seenByMovie.set(credit.movieId, seenPeople);

            const fame = computeFameScore(
              popularityByPerson.get(credit.personId) ?? credit.person.tmdbPopularity,
              fameSignalByPerson.get(credit.personId) ?? createEmptyFameSignal(),
            );
            castFameByMovieId.set(credit.movieId, (castFameByMovieId.get(credit.movieId) ?? 0) + fame);
          }

          return new Map(
            movies.map((movie) => {
              const score =
                seasonScoreByMovieId.get(movie.id) ??
                fallbackScoreByMovieId.get(movie.id) ??
                { boxOfficePoints: 0, rtPoints: 0 };
              return [
                movie.id,
                {
                  releaseDateLabel: releaseDateLabel(movie.theatricalReleaseDate),
                  castFameScore: castFameByMovieId.get(movie.id) ?? 0,
                  boxPoints: score.boxOfficePoints,
                  rtPoints: score.rtPoints,
                },
              ] as const;
            }),
          );
        })()
      : new Map<string, { releaseDateLabel: string; castFameScore: number; boxPoints: number; rtPoints: number }>();

  const moviesTitle = league ? `${league.seasonYear} Season Movies` : "Movies";
  const previousSeasonWindow = league ? getPreviousSeasonPointsWindow(league.seasonYear) : null;
  const previousSeasonYear = previousSeasonWindow?.previousSeasonYear ?? null;

  const previousSeasonBreakdown =
    league && previousSeasonYear != null
      ? await (async () => {
          const previousSeasonWindowForLeague = getPreviousSeasonPointsWindow(league.seasonYear);
          const credits = await prisma.credit.findMany({
            where: {
              personId: player.personId,
              movie: {
                theatricalReleaseDate: {
                  gte: previousSeasonWindowForLeague.startAt,
                  lte: previousSeasonWindowForLeague.cutoffAt,
                },
              },
            },
            select: {
              movieId: true,
              creditType: true,
              billingOrder: true,
              job: true,
              movie: {
                select: {
                  id: true,
                  title: true,
                  theatricalReleaseDate: true,
                },
              },
            },
            orderBy: [{ movie: { theatricalReleaseDate: "asc" } }, { id: "asc" }],
          });

          const matchingMovieMap = new Map<
            string,
            {
              id: string;
              title: string;
              theatricalReleaseDate: Date | null;
              creditTypes: Set<string>;
            }
          >();

          for (const credit of credits) {
            if (!isFantasyRelevantCredit({ creditType: credit.creditType, job: credit.job })) {
              continue;
            }

            const existing = matchingMovieMap.get(credit.movie.id) ?? {
              ...credit.movie,
              creditTypes: new Set<string>(),
            };

            if (credit.creditType === "CAST") {
              existing.creditTypes.add("Cast");
            } else if (credit.job === "Director") {
              existing.creditTypes.add("Director");
            }

            matchingMovieMap.set(credit.movie.id, existing);
          }

          const associatedMovies = Array.from(matchingMovieMap.values());
          const seasonStats =
            associatedMovies.length > 0
              ? await prisma.movieSeasonStat.findMany({
                  where: {
                    seasonYear: previousSeasonYear,
                    movieId: { in: associatedMovies.map((movie) => movie.id) },
                  },
                  select: {
                    movieId: true,
                    worldwideGrossUsd: true,
                    rtCriticsScore: true,
                    rtAudienceScore: true,
                  },
                })
              : [];

          const scoreByMovieId = new Map(seasonStats.map((stat) => [stat.movieId, seasonStatToPoints(stat)]));

          const rows = associatedMovies
            .map((movie) => {
              const score = scoreByMovieId.get(movie.id);
              const boxPoints = score?.boxPoints ?? 0;
              const rtPoints = score?.rtPoints ?? 0;
              const totalPoints = score?.totalPoints ?? 0;

              return {
                id: movie.id,
                title: movie.title,
                theatricalReleaseDate: movie.theatricalReleaseDate,
                creditTypes: Array.from(movie.creditTypes.values()).sort((a, b) => a.localeCompare(b)),
                boxPoints,
                rtPoints,
                totalPoints,
              };
            })
            .sort((a, b) => {
              const aTime = a.theatricalReleaseDate ? new Date(a.theatricalReleaseDate).getTime() : Number.MAX_SAFE_INTEGER;
              const bTime = b.theatricalReleaseDate ? new Date(b.theatricalReleaseDate).getTime() : Number.MAX_SAFE_INTEGER;
              return aTime - bTime || a.title.localeCompare(b.title);
            });

          const totals = rows.reduce(
            (acc, row) => ({
              boxPoints: roundHalfUp(acc.boxPoints + row.boxPoints, 2),
              rtPoints: roundHalfUp(acc.rtPoints + row.rtPoints, 2),
              totalPoints: roundHalfUp(acc.totalPoints + row.totalPoints, 2),
            }),
            { boxPoints: 0, rtPoints: 0, totalPoints: 0 },
          );

          return {
            year: previousSeasonYear,
            rows,
            totals,
          };
        })()
      : null;

  return (
    <AppShell title={player.person.name}>
      <Card>
        <div className="flex items-start gap-4">
          {profileImageUrl ? (
            <Image
              src={profileImageUrl}
              alt={`${player.person.name} headshot`}
              width={88}
              height={132}
              className="h-32 w-[5.5rem] rounded-xl border border-white/10 object-cover"
            />
          ) : (
            <div className="flex h-32 w-[5.5rem] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-center text-xs text-slate-400">
              No photo
            </div>
          )}
          <div className="flex-1">
            <p className="text-sm text-slate-200">Roles: {roleLabels.length > 0 ? roleLabels.join(" • ") : prettyRoleLabel(player.role)}</p>
            <p className="mt-1 text-xs text-slate-400">Movies this season: {movies.length}</p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{moviesTitle}</h2>
        {movies.length === 0 ? (
          <p className="text-sm text-slate-400">No linked credits yet. Movie ingestion will populate this.</p>
        ) : (
          <div className="space-y-3">
            {movies.map((movie) => {
              const posterUrl = tmdbImageUrl(movie.posterPath, "w342");
              const movieHref = league?.id ? `/movies/${movie.id}?leagueId=${league.id}` : `/movies/${movie.id}`;
              const movieData = currentSeasonMovieData.get(movie.id) ?? {
                releaseDateLabel: releaseDateLabel(movie.theatricalReleaseDate),
                castFameScore: 0,
                boxPoints: 0,
                rtPoints: 0,
              };
              return (
                <Link
                  key={movie.id}
                  href={movieHref}
                  className="block rounded-xl border border-white/10 bg-slate-950/70 p-4 transition hover:border-white/20 hover:bg-slate-900/80"
                >
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-4 sm:grid-cols-[6.25rem_minmax(0,1fr)]">
                    <div className="flex h-40 w-[5.5rem] items-center justify-center rounded-xl border border-white/10 bg-slate-900/80 p-2 sm:h-[9.25rem] sm:w-[6.25rem]">
                      {posterUrl ? (
                        <Image
                          src={posterUrl}
                          alt={`${movie.title} poster`}
                          width={171}
                          height={257}
                          className="h-full w-full rounded-lg object-contain"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-center text-xs text-slate-400">
                          Poster unavailable
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <Link href={movieHref} className="text-[1.1rem] font-semibold leading-tight text-white hover:underline">
                        {movie.title}
                      </Link>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                        <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                          {movieData.releaseDateLabel}
                        </span>
                        <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                          Fame {movieData.castFameScore.toFixed(1)}
                        </span>
                        <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                          Box {formatPoints(movieData.boxPoints)}
                        </span>
                        <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                          RT {movieData.rtPoints}
                        </span>
                      </div>

                      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">Open Movie</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Last Year Points Breakdown</h2>
        {!league || !previousSeasonBreakdown ? (
          <p className="text-sm text-slate-400">Open this player from a league context to see last year scoring details.</p>
        ) : previousSeasonBreakdown.rows.length === 0 ? (
          <p className="text-sm text-slate-400">No {previousSeasonBreakdown.year} associated movies found.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              {previousSeasonBreakdown.year} total: {previousSeasonBreakdown.totals.totalPoints} points (Box:{" "}
              {previousSeasonBreakdown.totals.boxPoints} • RT: {previousSeasonBreakdown.totals.rtPoints})
            </p>
            <ul className="space-y-2 text-sm">
              {previousSeasonBreakdown.rows.map((row) => (
                <li key={row.id} className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
                  <Link
                    href={league ? `/movies/${row.id}?leagueId=${league.id}` : `/movies/${row.id}`}
                    className="font-medium text-white hover:underline"
                  >
                    {row.title} ({yearFromDate(row.theatricalReleaseDate)})
                  </Link>
                  <p className="text-xs text-slate-400">
                    Box office: {row.boxPoints} • RT: {row.rtPoints} • Total: {row.totalPoints}
                  </p>
                  {row.creditTypes.length > 0 ? (
                    <p className="text-xs text-slate-400">Credits: {row.creditTypes.join(", ")}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Recent Monthly Scores</h2>
        {recentMonthlyScores.length === 0 ? (
          <p className="text-sm text-slate-400">No scoring snapshots yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentMonthlyScores.map((score) => (
              <li key={score.weekId} className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
                <p className="text-white">
                  Month {score.weekIndex} • Total {score.totalPoints}
                </p>
                <p className="text-xs text-slate-400">
                  Box: {score.pointsBoxOffice} • RT: {score.pointsRt} • RT movies: {score.rtContribCount}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}

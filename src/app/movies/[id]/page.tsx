import type { FantasyRole } from "@prisma/client";
import Image from "next/image";
import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { tmdbImageUrl } from "@/lib/tmdbImage";
import { prisma } from "@/lib/prisma";
import {
  getBoxOfficeMojoTitleUrlForMovie,
  getRottenTomatoesUrlForMovieTitle,
} from "@/server/services/movieExternalLinkService";
import { aggregateMovieDisplayScores, selectMovieSeasonDisplayScores } from "@/server/utils/movieDisplayScores";
import { addCreditToFameSignal, computeFameScore, createEmptyFameSignal } from "@/server/utils/fameScore";

export const dynamic = "force-dynamic";

function prettyRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isFemale(gender: number | null): boolean {
  return gender === 1;
}

function isLeading(billingOrder: number | null): boolean {
  return billingOrder === 0 || billingOrder === 1;
}

const releaseDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function releaseDateLabel(date: Date | null): string {
  if (!date) {
    return "Release date TBD";
  }
  return releaseDateFormatter.format(new Date(date));
}

function rtSourceUrlFromRawSource(rawSource: unknown): string | null {
  if (!rawSource || typeof rawSource !== "object") {
    return null;
  }
  const ratings = (rawSource as Record<string, unknown>).ratings;
  if (!ratings || typeof ratings !== "object") {
    return null;
  }
  const sourceUrl = (ratings as Record<string, unknown>).sourceUrl;
  return typeof sourceUrl === "string" && sourceUrl.length > 0 ? sourceUrl : null;
}

function formatPoints(value: number): string {
  return value.toFixed(2);
}

export default async function MoviePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ leagueId?: string }>;
}) {
  const { id } = await params;
  const { leagueId } = await searchParams;

  const movie = await prisma.movie.findUnique({
    where: { id },
    include: {
      credits: {
        include: {
          person: true,
        },
        orderBy: [{ billingOrder: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!movie) {
    return <div>Movie not found</div>;
  }

  const league = leagueId
    ? await prisma.league.findUnique({
        where: { id: leagueId },
        select: { id: true, seasonYear: true },
      })
    : null;

  if (leagueId) {
    const eligible = await prisma.leagueEligibleMovie.findUnique({
      where: {
        leagueId_movieId: {
          leagueId,
          movieId: movie.id,
        },
      },
      select: { id: true },
    });

    if (!eligible) {
      return <div>Movie not found for this league</div>;
    }
  }

  const personIds = Array.from(new Set(movie.credits.map((credit) => credit.personId)));
  const fantasyPlayers = await prisma.fantasyPlayer.findMany({
    where: {
      personId: { in: personIds },
    },
    select: {
      id: true,
      role: true,
      personId: true,
    },
  });

  const fantasyPlayerByPersonRole = new Map<string, { id: string; role: FantasyRole }>();
  for (const fantasyPlayer of fantasyPlayers) {
    fantasyPlayerByPersonRole.set(`${fantasyPlayer.personId}:${fantasyPlayer.role}`, {
      id: fantasyPlayer.id,
      role: fantasyPlayer.role,
    });
  }

  type MoviePerson = {
    personId: string;
    name: string;
    profileImageUrl: string | null;
    fantasyPlayerId: string | null;
    displayRole: string;
    job: string | null;
  };

  const sections = new Map<string, MoviePerson[]>();

  function pushPerson(sectionKey: string, person: MoviePerson) {
    const existing = sections.get(sectionKey) ?? [];
    if (!existing.some((entry) => entry.personId === person.personId)) {
      existing.push(person);
      sections.set(sectionKey, existing);
    }
  }

  for (const credit of movie.credits) {
    if (credit.creditType === "CAST") {
      if (isLeading(credit.billingOrder)) {
        const role = isFemale(credit.person.gender) ? "LEADING_ACTRESS" : "LEADING_ACTOR";
        const fantasyPlayer = fantasyPlayerByPersonRole.get(`${credit.personId}:${role}`);

        pushPerson(role, {
          personId: credit.personId,
          name: credit.person.name,
          profileImageUrl: tmdbImageUrl(credit.person.profilePath, "w185"),
          fantasyPlayerId: fantasyPlayer?.id ?? null,
          displayRole: role,
          job: null,
        });
      } else {
        const role = isFemale(credit.person.gender) ? "SUPPORTING_ACTRESS" : "SUPPORTING_ACTOR";
        const fantasyPlayer = fantasyPlayerByPersonRole.get(`${credit.personId}:SUPPORTING`);

        pushPerson(role, {
          personId: credit.personId,
          name: credit.person.name,
          profileImageUrl: tmdbImageUrl(credit.person.profilePath, "w185"),
          fantasyPlayerId: fantasyPlayer?.id ?? null,
          displayRole: role,
          job: null,
        });
      }
    }

    if (credit.creditType === "CREW" && credit.job === "Director") {
      const fantasyPlayer = fantasyPlayerByPersonRole.get(`${credit.personId}:DIRECTOR`);
      pushPerson("DIRECTOR", {
        personId: credit.personId,
        name: credit.person.name,
        profileImageUrl: tmdbImageUrl(credit.person.profilePath, "w185"),
        fantasyPlayerId: fantasyPlayer?.id ?? null,
        displayRole: "DIRECTOR",
        job: credit.job,
      });
    }
  }

  const sectionOrder = [
    "LEADING_ACTOR",
    "LEADING_ACTRESS",
    "SUPPORTING_ACTOR",
    "SUPPORTING_ACTRESS",
    "DIRECTOR",
  ];

  const sectionData = sectionOrder
    .map((key) => ({
      key,
      label: prettyRoleLabel(key),
      people: (sections.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((section) => section.people.length > 0);

  const posterUrl = tmdbImageUrl(movie.posterPath, "w342");
  const boxOfficeMojoUrl = await getBoxOfficeMojoTitleUrlForMovie({
    tmdbMovieId: movie.externalTmdbMovieId,
    title: movie.title,
    releaseDate: movie.theatricalReleaseDate,
  }).catch(() => null);
  const [recentWeekStats, recentSeasonStats, cumulativeWeekStats, cumulativeSeasonStats, fameCredits] = await Promise.all([
    prisma.movieWeekStat.findMany({
      where: leagueId ? { movieId: movie.id, leagueId } : { movieId: movie.id },
      select: { rawSource: true, snapshotAt: true },
      orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
    prisma.movieSeasonStat.findMany({
      where: { movieId: movie.id },
      select: { rawSource: true, snapshotAt: true },
      orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
      take: 10,
    }),
    prisma.movieWeekStat.findMany({
      where: leagueId ? { movieId: movie.id, leagueId } : { movieId: movie.id },
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
        movieId: movie.id,
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
      take: league ? 1 : 10,
    }),
    personIds.length > 0
      ? prisma.credit.findMany({
          where: {
            personId: { in: personIds },
            ...(leagueId
              ? {
                  movie: {
                    eligibleLeagues: {
                      some: { leagueId },
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
      : Promise.resolve([]),
  ]);
  const ingestedRtSourceUrl =
    recentWeekStats.map((row) => rtSourceUrlFromRawSource(row.rawSource)).find((url): url is string => Boolean(url)) ??
    recentSeasonStats.map((row) => rtSourceUrlFromRawSource(row.rawSource)).find((url): url is string => Boolean(url)) ??
    null;
  const rottenTomatoesUrl = ingestedRtSourceUrl ?? getRottenTomatoesUrlForMovieTitle(movie.title);
  const cumulativeScores =
    selectMovieSeasonDisplayScores(cumulativeSeasonStats, {
      seasonYear: league?.seasonYear,
    });
  const fallbackScores = aggregateMovieDisplayScores(cumulativeWeekStats);
  const cumulativeBoxOfficePoints = cumulativeScores.get(movie.id)?.boxOfficePoints ?? fallbackScores.get(movie.id)?.boxOfficePoints ?? 0;
  const cumulativeRtPoints = cumulativeScores.get(movie.id)?.rtPoints ?? fallbackScores.get(movie.id)?.rtPoints ?? 0;
  const fameSignalByPerson = new Map<string, ReturnType<typeof createEmptyFameSignal>>();

  for (const credit of fameCredits) {
    const existing = fameSignalByPerson.get(credit.personId) ?? createEmptyFameSignal();
    addCreditToFameSignal(existing, {
      creditType: credit.creditType,
      billingOrder: credit.billingOrder,
      job: credit.job,
    });
    fameSignalByPerson.set(credit.personId, existing);
  }

  const castFameScore = Array.from(new Set(sectionData.flatMap((section) => section.people.map((person) => person.personId)))).reduce(
    (sum, personId) =>
      sum +
      computeFameScore(
        movie.credits.find((credit) => credit.personId === personId)?.person.tmdbPopularity ?? null,
        fameSignalByPerson.get(personId) ?? createEmptyFameSignal(),
      ),
    0,
  );

  return (
    <AppShell title={movie.title}>
      <Card>
        <div className="flex items-start gap-4">
          {posterUrl ? (
            <Image
              src={posterUrl}
              alt={`${movie.title} poster`}
              width={108}
              height={162}
              className="h-40 w-[6.75rem] rounded-xl border border-white/10 bg-slate-900/80 object-contain p-1"
            />
          ) : (
            <div className="flex h-40 w-[6.75rem] items-center justify-center rounded-xl border border-white/10 bg-slate-900/80 text-center text-xs text-slate-400">
              No poster
            </div>
          )}
          <div>
            <p className="text-sm text-slate-300">{releaseDateLabel(movie.theatricalReleaseDate)}</p>
            <p className="text-sm text-slate-400">
              Associated people: {sectionData.reduce((count, section) => count + section.people.length, 0)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-300">
              <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                Fame {castFameScore.toFixed(1)}
              </span>
              <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                Box {formatPoints(cumulativeBoxOfficePoints)}
              </span>
              <span className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-1">
                RT {cumulativeRtPoints}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {boxOfficeMojoUrl ? (
                <p>
                  <a href={boxOfficeMojoUrl} target="_blank" rel="noreferrer" className="text-white underline decoration-white/50 underline-offset-2">
                    View Box Office Mojo
                  </a>
                </p>
              ) : (
                <p className="text-xs text-slate-400">Box Office Mojo link unavailable for this movie.</p>
              )}
              {rottenTomatoesUrl ? (
                <p>
                  <a href={rottenTomatoesUrl} target="_blank" rel="noreferrer" className="text-white underline decoration-white/50 underline-offset-2">
                    View Rotten Tomatoes
                  </a>
                </p>
              ) : (
                <p className="text-xs text-slate-400">Rotten Tomatoes link unavailable for this movie.</p>
              )}
            </div>
          </div>
        </div>
      </Card>

      {sectionData.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-300">No associated people were found for this movie yet.</p>
        </Card>
      ) : (
        sectionData.map((section) => (
          <Card key={section.key}>
            <h2 className="mb-2 font-semibold text-white">{section.label}</h2>
            <div className="space-y-2">
              {section.people.map((person) => {
                const personHref = person.fantasyPlayerId
                  ? leagueId
                    ? `/fantasy-players/${person.fantasyPlayerId}?leagueId=${leagueId}`
                    : `/fantasy-players/${person.fantasyPlayerId}`
                  : null;

                const content = (
                  <div className="flex items-start gap-3">
                    {person.profileImageUrl ? (
                      <Image
                        src={person.profileImageUrl}
                        alt={`${person.name} photo`}
                        width={56}
                        height={84}
                        className="h-20 w-14 rounded-md border border-white/10 object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-14 items-center justify-center rounded-md border border-white/10 bg-slate-900/80 text-center text-[10px] text-slate-400">
                        No photo
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white">{person.name}</p>
                      <p className="text-xs text-slate-300">{prettyRoleLabel(person.displayRole)}</p>
                      {person.job ? <p className="text-xs text-slate-400">Job: {person.job}</p> : null}
                    </div>
                  </div>
                );

                return personHref ? (
                  <Link
                    key={`${section.key}-${person.personId}`}
                    href={personHref}
                    className="block rounded-xl border border-white/10 bg-slate-900/80 p-3 transition hover:border-white/20 hover:bg-slate-900"
                  >
                    {content}
                  </Link>
                ) : (
                  <article key={`${section.key}-${person.personId}`} className="rounded-xl border border-white/10 bg-slate-900/80 p-3">
                    {content}
                  </article>
                );
              })}
            </div>
          </Card>
        ))
      )}
    </AppShell>
  );
}

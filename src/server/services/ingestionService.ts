import type { JobState } from "bullmq";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/server/api/http";
import { ingestionQueue } from "@/server/queues";

const TMDB_PROVIDER_NAME = "TMDB_METADATA";

export interface LeagueIngestionStatus {
  tmdbConfigured: boolean;
  seasonYear: number;
  movieCount: number;
  personCount: number;
  fantasyPlayerCount: number;
  creditCount: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  jobState: JobState | "unknown" | null;
}

export function getSeasonIngestionJobId(leagueId: string): string {
  return `ingest-season:${leagueId}`;
}

export function getDailyStatsIngestionJobId(leagueId: string, localDate: string): string {
  return `ingest-daily-stats:${leagueId}:${localDate}`;
}

export async function getLeagueIngestionStatus(leagueId: string): Promise<LeagueIngestionStatus> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { seasonYear: true },
  });

  if (!league) {
    throw new ApiError(404, "League not found");
  }

  const jobPromise = (async () => {
    try {
      return await ingestionQueue.getJob(getSeasonIngestionJobId(leagueId));
    } catch {
      return null;
    }
  })();

  const [movieCount, personCount, fantasyPlayerCount, creditCount, provider, job] = await Promise.all([
    prisma.leagueEligibleMovie.count({
      where: { leagueId },
    }),
    prisma.person.count({
      where: {
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
    }),
    prisma.fantasyPlayer.count({
      where: {
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
    }),
    prisma.credit.count({
      where: {
        movie: {
          eligibleLeagues: {
            some: { leagueId },
          },
        },
      },
    }),
    prisma.providerStatus.findUnique({
      where: {
        leagueId_providerName: {
          leagueId,
          providerName: TMDB_PROVIDER_NAME,
        },
      },
    }),
    jobPromise,
  ]);

  let jobState: JobState | "unknown" | null = null;
  if (job) {
    try {
      jobState = await job.getState();
    } catch {
      jobState = null;
    }
  }

  return {
    tmdbConfigured: Boolean(env.TMDB_API_KEY),
    seasonYear: league.seasonYear,
    movieCount,
    personCount,
    fantasyPlayerCount,
    creditCount,
    lastSuccessAt: provider?.lastSuccessAt?.toISOString() ?? null,
    lastErrorAt: provider?.lastErrorAt?.toISOString() ?? null,
    lastErrorMessage: provider?.lastErrorMessage ?? null,
    jobState,
  };
}

export async function enqueueSeasonIngestion(
  leagueId: string,
): Promise<{ queued: boolean; jobState: JobState | "unknown" | null }> {
  if (!env.TMDB_API_KEY) {
    throw new ApiError(400, "TMDB API key is missing. Add TMDB_API_KEY in .env, then restart the app.");
  }

  const jobId = getSeasonIngestionJobId(leagueId);
  const existing = await ingestionQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "waiting" || state === "active" || state === "delayed" || state === "waiting-children") {
      return {
        queued: true,
        jobState: state,
      };
    }
  }

  const queuedJob = await ingestionQueue.add(
    "ingest-season",
    { leagueId },
    {
      jobId,
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );

  return {
    queued: true,
    jobState: await queuedJob.getState(),
  };
}

export async function enqueueDailyStatsIngestion(
  leagueId: string,
  localDate: string,
): Promise<{ queued: boolean; jobState: JobState | "unknown" | null }> {
  const jobId = getDailyStatsIngestionJobId(leagueId, localDate);
  const existing = await ingestionQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "failed") {
      return {
        queued: true,
        jobState: state,
      };
    }

    await existing.remove();
  }

  const queuedJob = await ingestionQueue.add(
    "ingest-daily-stats",
    { leagueId },
    {
      jobId,
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );

  return {
    queued: true,
    jobState: await queuedJob.getState(),
  };
}

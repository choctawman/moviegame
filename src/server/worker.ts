import "dotenv/config";

import { Worker } from "bullmq";

import { redis } from "@/lib/redis";
import { handleDraftAutopickJob } from "@/server/jobs/draftJobs";
import { handleDailyStatsIngestionJob, handleSeasonIngestionJob } from "@/server/jobs/ingestionJobs";
import { handleBuildSeasonCalendarJob, handleGenerateScheduleJob } from "@/server/jobs/leagueJobs";
import { handleFinalizeWeekScoringJob } from "@/server/jobs/scoringJobs";
import { handleWaiverProcessingJob } from "@/server/jobs/waiverJobs";
import { QUEUE_NAMES } from "@/server/queues";
import { runLeagueCycleSchedulerTick } from "@/server/services/leagueCycleService";

void redis.connect().catch(() => undefined);

const leagueWorker = new Worker(
  QUEUE_NAMES.LEAGUE,
  async (job) => {
    if (job.name === "build-season-calendar") {
      await handleBuildSeasonCalendarJob(job.data as { leagueId: string; seasonYear: number; timezone: string });
      return;
    }

    if (job.name === "generate-schedule") {
      await handleGenerateScheduleJob(job.data as { leagueId: string });
      return;
    }

    throw new Error(`Unknown league job: ${job.name}`);
  },
  { connection: redis },
);

const ingestionWorker = new Worker(
  QUEUE_NAMES.INGESTION,
  async (job) => {
    if (job.name === "ingest-season") {
      await handleSeasonIngestionJob(job.data as { leagueId: string });
      return;
    }

    if (job.name === "ingest-daily-stats") {
      await handleDailyStatsIngestionJob(job.data as { leagueId: string });
      return;
    }

    throw new Error(`Unknown ingestion job: ${job.name}`);
  },
  { connection: redis },
);

const scoringWorker = new Worker(
  QUEUE_NAMES.SCORING,
  async (job) => {
    if (job.name === "finalize-week") {
      await handleFinalizeWeekScoringJob(job.data as { leagueId: string; weekId: string });
      return;
    }

    throw new Error(`Unknown scoring job: ${job.name}`);
  },
  { connection: redis },
);

const waiverWorker = new Worker(
  QUEUE_NAMES.WAIVERS,
  async (job) => {
    if (job.name === "process-waivers") {
      await handleWaiverProcessingJob(job.data as { leagueId: string; weekId: string });
      return;
    }

    throw new Error(`Unknown waiver job: ${job.name}`);
  },
  { connection: redis },
);

const draftWorker = new Worker(
  QUEUE_NAMES.DRAFT,
  async (job) => {
    if (job.name === "autopick") {
      await handleDraftAutopickJob(job.data as { leagueId: string });
      return;
    }

    throw new Error(`Unknown draft job: ${job.name}`);
  },
  { connection: redis },
);

for (const worker of [leagueWorker, ingestionWorker, scoringWorker, waiverWorker, draftWorker]) {
  worker.on("completed", (job) => {
    console.log(`[worker] completed ${job.queueName}:${job.name}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[worker] failed ${job?.queueName}:${job?.name}`, error);
  });
}

console.log("Workers started");

void runLeagueCycleSchedulerTick().catch((error) => {
  console.error("[cycle] initial tick failed", error);
});

setInterval(() => {
  void runLeagueCycleSchedulerTick().catch((error) => {
    console.error("[cycle] scheduled tick failed", error);
  });
}, 60_000);

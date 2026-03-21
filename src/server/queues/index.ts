import { Queue } from "bullmq";

import { redis } from "@/lib/redis";

export const QUEUE_NAMES = {
  LEAGUE: "league-jobs",
  INGESTION: "ingestion-jobs",
  SCORING: "scoring-jobs",
  WAIVERS: "waiver-jobs",
  DRAFT: "draft-jobs",
} as const;

export const leagueQueue = new Queue(QUEUE_NAMES.LEAGUE, {
  connection: redis,
});

export const ingestionQueue = new Queue(QUEUE_NAMES.INGESTION, {
  connection: redis,
});

export const scoringQueue = new Queue(QUEUE_NAMES.SCORING, {
  connection: redis,
});

export const waiverQueue = new Queue(QUEUE_NAMES.WAIVERS, {
  connection: redis,
});

export const draftQueue = new Queue(QUEUE_NAMES.DRAFT, {
  connection: redis,
});

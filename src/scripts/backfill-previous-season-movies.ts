import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { syncPreviousSeasonMoviesForSeason } from "@/server/services/previousSeasonBackfillService";

function parseTargetSeasonYear(argv: string[]): number {
  const argument = argv.find((value) => value.startsWith("--seasonYear="));
  if (!argument) {
    return 2026;
  }
  const parsed = Number.parseInt(argument.split("=")[1] ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2500) {
    throw new Error(`Invalid --seasonYear value: ${argument}`);
  }
  return parsed;
}

async function main() {
  const targetSeasonYear = parseTargetSeasonYear(process.argv.slice(2));
  console.log(`[backfill] Starting previous-season movie sync for season ${targetSeasonYear} leagues`);

  const summaries = await syncPreviousSeasonMoviesForSeason(targetSeasonYear);
  if (summaries.length === 0) {
    console.log(`[backfill] No leagues found for season ${targetSeasonYear}`);
    return;
  }

  let totalPeople = 0;
  let totalMissingTmdbIds = 0;
  let totalCandidates = 0;
  let totalMoviesUpserted = 0;
  let totalSkipped = 0;
  let totalEnsured = 0;
  let totalPlayerSeasonStats = 0;
  let totalFailures = 0;

  for (const summary of summaries) {
    totalPeople += summary.personCount;
    totalMissingTmdbIds += summary.peopleMissingTmdbId;
    totalCandidates += summary.candidateMovieCount;
    totalMoviesUpserted += summary.moviesUpserted;
    totalSkipped += summary.moviesSkippedOutsideFilters;
    totalEnsured += summary.movieIdsEnsuredForSeasonStats;
    totalPlayerSeasonStats += summary.fantasyPlayerSeasonStatsEnsured;
    totalFailures += summary.failures.length;

    console.log(
      `[backfill] League ${summary.leagueId}: people=${summary.personCount}, missingTmdbIds=${summary.peopleMissingTmdbId}, candidates=${summary.candidateMovieCount}, upserted=${summary.moviesUpserted}, skippedByFilters=${summary.moviesSkippedOutsideFilters}, ensuredSeasonStats=${summary.movieIdsEnsuredForSeasonStats}, ensuredPlayerSeasonStats=${summary.fantasyPlayerSeasonStatsEnsured}, failures=${summary.failures.length}`,
    );

    for (const failure of summary.failures) {
      console.log(`[backfill][${summary.leagueId}][${failure.kind}] ${failure.title} (${failure.id}): ${failure.message}`);
    }
  }

  console.log(
    `[backfill] Done. leagues=${summaries.length}, people=${totalPeople}, missingTmdbIds=${totalMissingTmdbIds}, candidates=${totalCandidates}, upserted=${totalMoviesUpserted}, skippedByFilters=${totalSkipped}, ensuredSeasonStats=${totalEnsured}, ensuredPlayerSeasonStats=${totalPlayerSeasonStats}, failures=${totalFailures}`,
  );
}

main()
  .catch((error) => {
    console.error("[backfill] Failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    try {
      if (redis.status === "ready" || redis.status === "connecting") {
        await redis.quit();
      } else {
        redis.disconnect();
      }
    } catch {
      redis.disconnect();
    }
  });

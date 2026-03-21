import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { backfillMonthlyBoxOfficeSnapshotsFromWayback } from "@/server/services/waybackBoxOfficeBackfillService";

function parseStringFlag(argv: string[], key: string): string | undefined {
  const argument = argv.find((value) => value.startsWith(`--${key}=`));
  return argument?.split("=")[1];
}

function parseBooleanFlag(argv: string[], key: string): boolean {
  return argv.includes(`--${key}`) || parseStringFlag(argv, key) === "true";
}

function parseIntegerFlag(argv: string[], key: string): number | undefined {
  const value = parseStringFlag(argv, key);
  if (value == null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${key} value: ${value}`);
  }

  return parsed;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = parseBooleanFlag(argv, "dry-run");
  const force = parseBooleanFlag(argv, "force");
  const leagueId = parseStringFlag(argv, "leagueId");
  const weekId = parseStringFlag(argv, "weekId");
  const movieId = parseStringFlag(argv, "movieId");
  const maxDistanceHours = parseIntegerFlag(argv, "maxDistanceHours");

  console.log(
    `[wayback-backfill] starting dryRun=${dryRun} force=${force} leagueId=${leagueId ?? "*"} weekId=${weekId ?? "*"} movieId=${movieId ?? "*"} maxDistanceHours=${maxDistanceHours ?? 72}`,
  );

  const summary = await backfillMonthlyBoxOfficeSnapshotsFromWayback({
    leagueId,
    weekId,
    movieId,
    dryRun,
    force,
    maxDistanceHours,
  });

  console.log(
    `[wayback-backfill] scanned=${summary.scannedRows} candidates=${summary.candidateRows} updated=${summary.updatedRows} recomputedWeeks=${summary.recomputedWeeks} skipped=${summary.skippedRows} failures=${summary.failures.length}`,
  );

  for (const failure of summary.failures) {
    console.log(`[wayback-backfill][failure] stat=${failure.statId} movie=${failure.movieTitle} reason=${failure.reason}`);
  }
}

main()
  .catch((error) => {
    console.error("[wayback-backfill] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

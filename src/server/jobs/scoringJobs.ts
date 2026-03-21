import { finalizeWeekScoring } from "@/server/services/scoringService";

export async function handleFinalizeWeekScoringJob(data: { leagueId: string; weekId: string }) {
  await finalizeWeekScoring(data.leagueId, data.weekId);
}

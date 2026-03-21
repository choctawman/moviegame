import { processWaivers } from "@/server/services/waiverService";

export async function handleWaiverProcessingJob(data: { leagueId: string; weekId: string }) {
  await processWaivers(data.leagueId, data.weekId);
}

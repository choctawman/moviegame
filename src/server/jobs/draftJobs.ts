import { draftStateService } from "@/server/services/draftStateService";

export async function handleDraftAutopickJob(data: { leagueId: string }) {
  await draftStateService.runAutoPickIfExpired(data.leagueId);
}

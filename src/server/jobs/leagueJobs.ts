import { generateSeasonSchedule } from "@/server/services/scheduleService";
import { generateLeagueWeeks } from "@/server/services/weekService";

export async function handleBuildSeasonCalendarJob(data: {
  leagueId: string;
  seasonYear: number;
  timezone: string;
}) {
  await generateLeagueWeeks(data.leagueId, data.seasonYear, data.timezone);
}

export async function handleGenerateScheduleJob(data: { leagueId: string }) {
  await generateSeasonSchedule(data.leagueId);
}

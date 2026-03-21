import { prisma } from "@/lib/prisma";
import { requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ok, requireAuth } from "@/server/api/http";

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { settings: true },
    });

    return ok({
      league,
      rules: {
        season: `Calendar year ${league?.seasonYear}`,
        weekWindow: "Scoring window is the full calendar month in league local time",
        waiverNominationWindow: "25th through month-end; one nomination per team; pool publishes on the 1st at 12:00 AM",
        waiverClaimWindow: "1st through first Thursday at 12:00 PM; claims process first Thursday at 12:00 PM",
        scoring: "Box office points = month-to-date worldwide gross delta / 1,000,000 (2dp); RT points = critics + audience",
        tiebreak: "Waivers: higher bid, then worse matchup record, then earlier submission time. Matchups: pointsTotal, then rtAvg, then tie",
      },
    });
  });
}

import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { LEAGUE_TEAM_LIMIT } from "@/server/services/constants";

export default async function LeagueRulesPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });

  if (!league || !league.settings) {
    return <div>League not found</div>;
  }

  return (
    <AppShell title="Rules & Settings">
      <Card>
        <p className="text-sm">Season year: {league.seasonYear}</p>
        <p className="text-sm">League timezone: {league.timezone}</p>
        <p className="text-sm">League cycle: calendar month</p>
        <p className="text-sm">League size: {LEAGUE_TEAM_LIMIT} teams</p>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Draft</h2>
        <p className="text-sm">Format: {league.settings.draftType}</p>
        <p className="text-sm">Pick timer: {league.settings.pickTimerSeconds}s</p>
        <p className="text-sm">Roster: 7 starters and 5 bench slots</p>
        <p className="text-sm">Bench eligibility: any role</p>
        {league.settings.draftType === "AUCTION" ? (
          <p className="text-sm">Auction budget: {league.settings.auctionBudget}</p>
        ) : null}
        <p className="text-sm">Keepers: {league.settings.keepersEnabled ? "Enabled" : "Disabled"}</p>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Waivers</h2>
        <p className="text-sm">Season FAAB budget: $100 per team</p>
        <p className="text-sm">Nominations: one player per team, from the 25th through month-end</p>
        <p className="text-sm">Pool publication: the 1st at 12:00 AM league local time</p>
        <p className="text-sm">Claim window: the 1st through the first Thursday at 12:00 PM league local time</p>
        <p className="text-sm">Processing: first Thursday at 12:00 PM league local time</p>
        <p className="text-sm">Claim order: claims run in your saved order</p>
        <p className="text-sm">Tie-breaker: higher bid, then worse matchup record, then earlier submission time</p>
        <p className="text-sm">Player adds: waivers only</p>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Monthly Matchups</h2>
        <p className="text-sm">Scoring period: first day through last day of each month</p>
        <p className="text-sm">Lineup deadline: 11:59 PM league local time on the first Friday of the month</p>
        <p className="text-sm">Lock rule: lineups lock for the balance of the month after that deadline</p>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Trades</h2>
        <p className="text-sm">Review window: 24 hours after the receiving team accepts</p>
        <p className="text-sm">Eligible voters: teams not involved in the trade</p>
        <p className="text-sm">Outcome: a trade is vetoed only if a majority of eligible teams votes to veto</p>
        <p className="text-sm">Expiration: if that threshold is not met before the deadline, the trade completes automatically</p>
      </Card>
    </AppShell>
  );
}

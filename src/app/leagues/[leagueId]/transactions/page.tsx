import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";

function formatDateTime(date: Date): string {
  return new Date(date).toLocaleString();
}

export default async function LeagueTransactionsPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;

  const transactions = await prisma.transaction.findMany({
    where: { leagueId },
    include: {
      team: true,
      week: true,
      fantasyPlayer: {
        include: { person: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <AppShell title="Transactions">
      {transactions.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">No transactions yet.</p>
        </Card>
      ) : (
        transactions.map((txn) => (
          <Card key={txn.id}>
            <p className="font-semibold">{txn.type.replaceAll("_", " ")}</p>
            <p className="text-sm text-slate-700">{txn.team.name} • {txn.fantasyPlayer.person.name}</p>
            {txn.week ? <p className="text-xs text-slate-500">Month {txn.week.index}</p> : null}
            <p className="text-xs text-slate-500">{formatDateTime(txn.createdAt)}</p>
          </Card>
        ))
      )}
    </AppShell>
  );
}

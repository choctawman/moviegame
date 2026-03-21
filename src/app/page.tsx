import Link from "next/link";

import { CreateLeagueForm } from "@/components/CreateLeagueForm";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/server/auth/session";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/Card";
import { LogoutButton } from "@/components/LogoutButton";
import { NotificationFeed } from "@/components/NotificationFeed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();

  if (!user) {
    return (
      <AppShell title="Movie Fantasy League" showBack={false}>
        <Card>
          <p className="mb-4 text-sm text-slate-600">
            Draft cast and directors. Score monthly by worldwide box office and Rotten Tomatoes.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/login" className="rounded-xl bg-slate-900 px-3 py-2 text-center text-white">
              Log In
            </Link>
            <Link href="/signup" className="rounded-xl bg-white px-3 py-2 text-center ring-1 ring-slate-300">
              Sign Up
            </Link>
          </div>
        </Card>
      </AppShell>
    );
  }

  const memberships = await prisma.leagueMember.findMany({
    where: { userId: user.id },
    include: {
      league: true,
      team: true,
    },
    orderBy: {
      league: {
        createdAt: "desc",
      },
    },
  });

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  return (
    <AppShell title="My Leagues" showBack={false}>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-600">{user.email}</p>
            <p className="text-xs text-slate-500">Commissioner access: {user.isCommissioner ? "Yes" : "No"}</p>
          </div>
          <LogoutButton />
        </div>
      </Card>

      {user.isCommissioner ? (
        <Card>
          <CreateLeagueForm />
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-slate-600">Use an invite link from a commissioner to join a league.</p>
        </Card>
      )}

      {memberships.length === 0 ? (
        <Card>
          <p className="text-sm">No leagues joined yet.</p>
        </Card>
      ) : (
        memberships.map((membership) => (
          <Card key={membership.id}>
            <h2 className="text-lg font-semibold">{membership.league.name}</h2>
            <p className="text-sm text-slate-600">
              {membership.league.seasonYear} • {membership.team?.name ?? "No team assigned"}
            </p>
            <Link href={`/leagues/${membership.leagueId}`} className="mt-3 inline-block rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">
              Open League
            </Link>
          </Card>
        ))
      )}

      <NotificationFeed
        title="League Notifications"
        notifications={notifications.map((notification) => ({
          id: notification.id,
          title: notification.title,
          body: notification.body,
          createdAt: notification.createdAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}

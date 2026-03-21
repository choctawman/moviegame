import { NotificationType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function createLeagueNotification(
  leagueId: string,
  type: NotificationType,
  title: string,
  body: string,
  meta?: unknown,
): Promise<void> {
  const memberships = await prisma.leagueMember.findMany({
    where: { leagueId },
    select: { userId: true },
  });

  if (memberships.length === 0) {
    return;
  }

  await prisma.notification.createMany({
    data: memberships.map((member) => ({
      userId: member.userId,
      leagueId,
      type,
      title,
      body,
      meta: meta == null ? undefined : (meta as Prisma.InputJsonValue),
    })),
  });
}

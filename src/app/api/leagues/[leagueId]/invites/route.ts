import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireLeagueCommissioner } from "@/server/auth/permissions";
import { apiHandler, created, ok, parseBody, requireAuth } from "@/server/api/http";

const schema = z.object({
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueCommissioner(user.id, leagueId);
    const body = await parseBody(request, schema);

    const token = randomBytes(24).toString("hex");

    await prisma.leagueInvite.create({
      data: {
        leagueId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000),
        createdById: user.id,
      },
    });

    return created({
      inviteLink: `${env.APP_URL}/leagues/${leagueId}?inviteToken=${token}`,
      expiresInHours: body.expiresInHours,
    });
  });
}

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueCommissioner(user.id, leagueId);

    const invites = await prisma.leagueInvite.findMany({
      where: { leagueId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        expiresAt: true,
        createdAt: true,
        usedAt: true,
        usedById: true,
      },
    });

    return ok({ invites });
  });
}

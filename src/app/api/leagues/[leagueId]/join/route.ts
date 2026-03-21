import { createHash } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiHandler, ApiError, ok, parseBody, requireAuth } from "@/server/api/http";
import { addTeamToLeague } from "@/server/services/leagueService";

const schema = z.object({
  inviteToken: z.string().min(1),
  teamName: z.string().min(2),
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    const body = await parseBody(request, schema);

    const invite = await prisma.leagueInvite.findFirst({
      where: {
        leagueId,
        tokenHash: hashToken(body.inviteToken),
        usedAt: null,
        expiresAt: {
          gte: new Date(),
        },
      },
    });

    if (!invite) {
      throw new ApiError(400, "Invalid or expired invite token");
    }

    const team = await addTeamToLeague({
      leagueId,
      ownerUserId: user.id,
      name: body.teamName,
    });

    await prisma.leagueInvite.update({
      where: { id: invite.id },
      data: {
        usedById: user.id,
        usedAt: new Date(),
      },
    });

    return ok({ team });
  });
}

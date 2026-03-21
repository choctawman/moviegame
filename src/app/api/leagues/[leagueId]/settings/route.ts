import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireLeagueCommissioner, requireLeagueMembership } from "@/server/auth/permissions";
import { apiHandler, ApiError, ok, parseBody, requireAuth } from "@/server/api/http";

const patchSchema = z.object({
  draftType: z.enum(["SNAKE", "AUCTION"]).optional(),
  auctionBudget: z.number().int().min(1).max(1000).optional(),
  pickTimerSeconds: z.number().int().min(10).max(600).optional(),
  waiverProcessDow: z.number().int().min(0).max(6).optional(),
  waiverProcessLocalTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  freeAgencyLockStartDow: z.number().int().min(0).max(6).optional(),
  freeAgencyLockStartLocalTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  tradeReviewEnabled: z.boolean().optional(),
  tradeReviewHours: z.number().int().min(1).max(168).optional(),
  keepersEnabled: z.boolean().optional(),
});

const IMMUTABLE_AFTER_DRAFT = [
  "waiverProcessDow",
  "waiverProcessLocalTime",
  "freeAgencyLockStartDow",
  "freeAgencyLockStartLocalTime",
] as const;

export async function GET(_: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    await requireLeagueMembership(user.id, leagueId);

    const settings = await prisma.leagueSettings.findUnique({ where: { leagueId } });
    return ok({ settings });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ leagueId: string }> }) {
  return apiHandler(async () => {
    const { leagueId } = await context.params;
    const user = await requireAuth();
    const league = await requireLeagueCommissioner(user.id, leagueId);
    const payload = await parseBody(request, patchSchema);

    if (league.status !== "PRE_DRAFT") {
      const immutableAttempted = IMMUTABLE_AFTER_DRAFT.some((field) => field in payload);
      if (immutableAttempted) {
        throw new ApiError(400, "Cycle and waiver window settings are locked after draft start");
      }
    }

    const settings = await prisma.leagueSettings.update({
      where: { leagueId },
      data: payload,
    });

    return ok({ settings });
  });
}

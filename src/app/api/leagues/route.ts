import { DateTime } from "luxon";
import { z } from "zod";

import { assertValidTimezone } from "@/server/utils/time";
import { createLeague } from "@/server/services/leagueService";
import { apiHandler, created, parseBody, requireCommissioner, ApiError } from "@/server/api/http";

const schema = z.object({
  name: z.string().min(3),
  seasonYear: z.number().int().min(2020).max(2100).default(DateTime.now().year),
  timezone: z.string().min(1).default("America/New_York"),
});

export async function POST(request: Request) {
  return apiHandler(async () => {
    const user = await requireCommissioner();
    const body = await parseBody(request, schema);
    try {
      assertValidTimezone(body.timezone);
    } catch {
      throw new ApiError(400, "Invalid timezone");
    }

    const league = await createLeague({
      name: body.name,
      seasonYear: body.seasonYear,
      timezone: body.timezone,
      commissionerUserId: user.id,
    });

    return created({ league });
  });
}

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { apiHandler, ok, parseBody, ApiError } from "@/server/api/http";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  return apiHandler(async () => {
    const body = await parseBody(request, schema);

    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) {
      throw new ApiError(401, "Invalid credentials");
    }

    const valid = await verifyPassword(user.passwordHash, body.password);
    if (!valid) {
      throw new ApiError(401, "Invalid credentials");
    }

    await createSession(user.id);

    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isCommissioner: user.isCommissioner,
      },
    });
  });
}

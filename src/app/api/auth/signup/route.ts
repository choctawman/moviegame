import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { apiHandler, created, parseBody, ApiError } from "@/server/api/http";

const schema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  return apiHandler(async () => {
    const body = await parseBody(request, schema);

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) {
      throw new ApiError(409, "Email already registered");
    }

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
      },
    });

    await createSession(user.id);

    return created({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isCommissioner: user.isCommissioner,
      },
    });
  });
}

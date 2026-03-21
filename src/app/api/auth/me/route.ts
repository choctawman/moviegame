import { getSessionUser } from "@/server/auth/session";
import { apiHandler, ok } from "@/server/api/http";

export async function GET() {
  return apiHandler(async () => {
    const user = await getSessionUser();
    if (!user) {
      return ok({ user: null });
    }

    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isCommissioner: user.isCommissioner,
        createdAt: user.createdAt,
      },
    });
  });
}

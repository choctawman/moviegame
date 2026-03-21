import { destroySession } from "@/server/auth/session";
import { apiHandler, ok } from "@/server/api/http";

export async function POST() {
  return apiHandler(async () => {
    await destroySession();
    return ok({ success: true });
  });
}

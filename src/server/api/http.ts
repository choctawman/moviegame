import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/server/auth/session";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json(data, { status: 201 });
}

export function fail(status: number, message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, details }, { status });
}

export async function parseBody<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  const body = await request.json().catch(() => {
    throw new ApiError(400, "Invalid JSON body");
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "Validation failed");
  }

  return parsed.data;
}

export async function requireAuth() {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiError(401, "Unauthorized");
  }
  return user;
}

export async function requireCommissioner() {
  const user = await requireAuth();
  if (!user.isCommissioner) {
    throw new ApiError(403, "Only approved commissioners can perform this action");
  }
  return user;
}

export async function apiHandler(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.status, error.message);
    }

    console.error(error);
    return fail(500, "Internal server error");
  }
}

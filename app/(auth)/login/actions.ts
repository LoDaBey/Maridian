"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { queryOne } from "@/lib/db";
import {
  dummyPasswordHash,
  verifyPassword,
} from "@/lib/auth/password";
import {
  clearLoginFailures,
  loginBlockMessage,
  recordLoginFailure,
} from "@/lib/auth/rate-limit";
import { createSession } from "@/lib/auth/session";

const INCORRECT = "Email or password is incorrect";

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export interface LoginState {
  error: string;
}

interface LoginUser {
  id: string;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
}

async function clientAddress(): Promise<{ ip: string; userAgent: string | null }> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  const ip = (
    forwarded?.split(",")[0]?.trim() ||
    headerStore.get("x-real-ip") ||
    "unknown"
  ).slice(0, 64);
  const userAgent = headerStore.get("user-agent")?.slice(0, 512) ?? null;

  return { ip, userAgent };
}

export async function login(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const { ip, userAgent } = await clientAddress();
  const email = parsed.success ? parsed.data.email : "";
  const password = parsed.success ? parsed.data.password : "";

  if (!parsed.success) {
    return { error: INCORRECT };
  }

  const blocked = loginBlockMessage(email, ip);

  if (blocked) {
    return { error: blocked };
  }

  const user = await queryOne<LoginUser>(
    `SELECT id, password_hash, is_active, must_change_password
     FROM monitor_users
     WHERE email = lower($1)`,
    [email],
  );

  const passwordMatches = await verifyPassword(
    password,
    user?.password_hash ?? dummyPasswordHash(),
  );

  if (!user || !user.is_active || !passwordMatches) {
    recordLoginFailure(email, ip);
    return { error: INCORRECT };
  }

  clearLoginFailures(email, ip);
  await createSession(user.id, ip, userAgent);
  redirect(user.must_change_password ? "/change-password" : "/");
}

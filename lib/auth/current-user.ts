import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  validateSessionToken,
  type SessionUser,
} from "@/lib/auth/session";
import { can, roleRank, type Action, type Role } from "@/lib/rbac";

export type { SessionUser };

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await validateSessionToken(token);

  if (!session) {
    return null;
  }

  return session.user;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user) {
    // Cookie writes are only allowed in a Route Handler. Logout clears the
    // stale cookie, then sends the browser to /login.
    redirect("/api/auth/logout");
  }

  const pathname = (await headers()).get("x-pathname");

  if (user.mustChangePassword && pathname !== "/change-password") {
    redirect("/change-password");
  }

  return user;
}

export async function requireRole(minimum: Role): Promise<SessionUser> {
  const user = await requireUser();

  if (roleRank(user.role) < roleRank(minimum)) {
    notFound();
  }

  return user;
}

export async function requirePermission(action: Action): Promise<SessionUser> {
  const user = await requireUser();

  if (!can(user.role, action)) {
    notFound();
  }

  return user;
}

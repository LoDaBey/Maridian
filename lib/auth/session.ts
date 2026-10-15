import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@/lib/db-types";
import { query, tx } from "@/lib/db";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "monitor_session";

const SESSION_SECONDS = 14 * 24 * 60 * 60;
const SLIDING_MS = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  avatarColor: string;
  mustChangePassword: boolean;
}

export interface ValidSession {
  user: SessionUser;
  sliding: boolean;
}

interface SessionRow {
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  avatar_color: string;
  must_change_password: boolean;
  last_seen_at: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(maxAge = SESSION_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

async function cookieJar() {
  const { cookies } = await import("next/headers");
  return cookies();
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookieJar();
  cookieStore.set(SESSION_COOKIE, token, cookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookieJar();
  cookieStore.set(SESSION_COOKIE, "", cookieOptions(0));
}

export async function cleanupExpiredSessions(): Promise<void> {
  try {
    await query("DELETE FROM monitor_user_sessions WHERE expires_at <= now()");
  } catch {
    // The next hourly run retries. A database blip must not take down the server.
  }
}

export async function createSession(
  userId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);

  await tx(async (client) => {
    await client.query(
      `INSERT INTO monitor_user_sessions (user_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, tokenHash, expiresAt, ip, userAgent],
    );
    await client.query(
      "UPDATE monitor_users SET last_login_at = now() WHERE id = $1",
      [userId],
    );
  });

  await setSessionCookie(token);
}

export async function validateSessionToken(
  token: string,
): Promise<ValidSession | null> {
  const row = await query<SessionRow>(
    `SELECT
       u.id AS user_id,
       u.email,
       u.full_name,
       u.role,
       u.avatar_color,
       u.must_change_password,
       s.last_seen_at
     FROM monitor_user_sessions s
     JOIN monitor_users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND u.is_active = true`,
    [hashToken(token)],
  );

  const session = row[0];

  if (!session) {
    return null;
  }

  const sliding = Date.now() - session.last_seen_at.getTime() >= SLIDING_MS;

  if (sliding) {
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    await query(
      `UPDATE monitor_user_sessions
       SET last_seen_at = now(), expires_at = $2
       WHERE token_hash = $1`,
      [hashToken(token), expiresAt],
    );
  }

  return {
    sliding,
    user: {
      id: session.user_id,
      email: session.email,
      fullName: session.full_name,
      role: session.role,
      avatarColor: session.avatar_color,
      mustChangePassword: session.must_change_password,
    },
  };
}

export async function deleteSession(token: string): Promise<void> {
  await query("DELETE FROM monitor_user_sessions WHERE token_hash = $1", [
    hashToken(token),
  ]);
  await clearSessionCookie();
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await query("DELETE FROM monitor_user_sessions WHERE user_id = $1", [userId]);
}

export async function deleteOtherSessions(
  userId: string,
  token: string,
): Promise<void> {
  await query(
    "DELETE FROM monitor_user_sessions WHERE user_id = $1 AND token_hash <> $2",
    [userId, hashToken(token)],
  );
}

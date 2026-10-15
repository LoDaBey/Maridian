import type { PoolClient } from "pg";
import { hashPassword } from "@/lib/auth/password";
import { pickUserColor, type PresenceColor } from "@/lib/colors";
import type { DirectoryUser } from "@/lib/db-types";
import { query, tx } from "@/lib/db";
import { roleRank, type Role } from "@/lib/rbac";

export class UserActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserActionError";
  }
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  avatarColor: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CreatedUser {
  id: string;
  email: string;
}

interface UserRecord {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  avatar_color: string;
  last_login_at: Date | null;
  created_at: Date;
}

const SELF_ROLE = "You can't change your own role.";
const SELF_DEACTIVATE = "You can't deactivate your own account.";
const LAST_ADMIN = "The last active admin can't be demoted or deactivated.";
const DUPLICATE_EMAIL = "A user with this email already exists.";

function mapUser(row: UserRecord): AdminUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    avatarColor: row.avatar_color,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

async function audit(
  client: PoolClient,
  actorId: string,
  action: string,
  newValue: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO monitor_activity_log (sheet_id, user_id, action, new_value)
     VALUES (NULL, $1, $2, $3::jsonb)`,
    [actorId, action, JSON.stringify(newValue)],
  );
}

async function lockUsers(
  client: PoolClient,
  targetId: string,
): Promise<{ target: UserRecord; activeAdminIds: string[] }> {
  const result = await client.query<UserRecord>(
    `SELECT id, email, full_name, role, is_active, avatar_color, last_login_at, created_at
     FROM monitor_users
     WHERE id = $1 OR (role = 'admin' AND is_active = true)
     ORDER BY id
     FOR UPDATE`,
    [targetId],
  );
  const target = result.rows.find((row) => row.id === targetId);

  if (!target) {
    throw new UserActionError("User not found.");
  }

  return {
    target,
    activeAdminIds: result.rows
      .filter((row) => row.role === "admin" && row.is_active)
      .map((row) => row.id),
  };
}

export async function listDirectoryUsers(): Promise<DirectoryUser[]> {
  const rows = await query<{
    id: string;
    full_name: string;
    email: string;
    avatar_color: string;
    is_active: boolean;
  }>(
    `SELECT id, full_name, email, avatar_color, is_active
     FROM monitor_users
     ORDER BY is_active DESC, full_name`,
  );

  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    avatarColor: row.avatar_color,
    isActive: row.is_active,
  }));
}

export async function listUsers(): Promise<AdminUser[]> {
  const rows = await query<UserRecord>(
    `SELECT id, email, full_name, role, is_active, avatar_color, last_login_at, created_at
     FROM monitor_users`,
  );

  return rows.map(mapUser).sort((left, right) => {
    const byRole = roleRank(right.role) - roleRank(left.role);
    if (byRole !== 0) {
      return byRole;
    }
    return left.fullName.localeCompare(right.fullName, "en", { sensitivity: "base" });
  });
}

export async function createUserAccount(input: {
  actorId: string;
  email: string;
  fullName: string;
  role: Role;
  password: string;
  mustChangePassword: boolean;
}): Promise<CreatedUser> {
  const passwordHash = await hashPassword(input.password);

  try {
    return await tx(async (client) => {
      const existing = await client.query(
        "SELECT id FROM monitor_users WHERE email = $1",
        [input.email],
      );

      if (existing.rows.length > 0) {
        throw new UserActionError(DUPLICATE_EMAIL);
      }

      const count = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM monitor_users",
      );
      const avatarColor = pickUserColor(Number(count.rows[0]?.count ?? 0));
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO monitor_users (
           email, full_name, role, password_hash, is_active, must_change_password, avatar_color, created_by
         )
         VALUES ($1, $2, $3, $4, true, $5, $6, $7)
         RETURNING id`,
        [
          input.email,
          input.fullName,
          input.role,
          passwordHash,
          input.mustChangePassword,
          avatarColor,
          input.actorId,
        ],
      );
      const id = inserted.rows[0]?.id;

      if (!id) {
        throw new UserActionError("User not found.");
      }

      await audit(client, input.actorId, "user.create", {
        userId: id,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        mustChangePassword: input.mustChangePassword,
        avatarColor,
      });

      return { id, email: input.email };
    });
  } catch (error) {
    if (error instanceof UserActionError) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      throw new UserActionError(DUPLICATE_EMAIL);
    }
    throw error;
  }
}

export async function updateUserAccount(input: {
  actorId: string;
  userId: string;
  fullName: string;
  role: Role;
  avatarColor: PresenceColor;
}): Promise<{ changed: boolean }> {
  return tx(async (client) => {
    const { target, activeAdminIds } = await lockUsers(client, input.userId);
    const demotesLastAdmin =
      target.role === "admin" &&
      target.is_active &&
      input.role !== "admin" &&
      activeAdminIds.length <= 1;

    if (demotesLastAdmin) {
      throw new UserActionError(LAST_ADMIN);
    }

    if (input.actorId === target.id && input.role !== target.role) {
      throw new UserActionError(SELF_ROLE);
    }

    const changed =
      target.full_name !== input.fullName ||
      target.role !== input.role ||
      target.avatar_color !== input.avatarColor;

    if (!changed) {
      return { changed: false };
    }

    await client.query(
      `UPDATE monitor_users
       SET full_name = $2, role = $3, avatar_color = $4
       WHERE id = $1`,
      [input.userId, input.fullName, input.role, input.avatarColor],
    );
    await audit(client, input.actorId, "user.update", {
      userId: input.userId,
      fullName: input.fullName,
      role: input.role,
      avatarColor: input.avatarColor,
    });

    return { changed: true };
  });
}

export async function resetUserPasswordAccount(input: {
  actorId: string;
  userId: string;
  password: string;
}): Promise<{ email: string }> {
  const passwordHash = await hashPassword(input.password);

  return tx(async (client) => {
    const { target } = await lockUsers(client, input.userId);
    await client.query(
      `UPDATE monitor_users
       SET password_hash = $2, must_change_password = true
       WHERE id = $1`,
      [target.id, passwordHash],
    );
    await client.query("DELETE FROM monitor_user_sessions WHERE user_id = $1", [
      target.id,
    ]);
    await audit(client, input.actorId, "user.reset_password", {
      userId: target.id,
      mustChangePassword: true,
    });
    return { email: target.email };
  });
}

export async function setUserActiveAccount(input: {
  actorId: string;
  userId: string;
  isActive: boolean;
}): Promise<{ changed: boolean }> {
  return tx(async (client) => {
    const { target, activeAdminIds } = await lockUsers(client, input.userId);

    if (!input.isActive && input.actorId === target.id) {
      throw new UserActionError(SELF_DEACTIVATE);
    }

    if (
      !input.isActive &&
      target.role === "admin" &&
      target.is_active &&
      activeAdminIds.length <= 1
    ) {
      throw new UserActionError(LAST_ADMIN);
    }

    if (target.is_active === input.isActive) {
      return { changed: false };
    }

    await client.query("UPDATE monitor_users SET is_active = $2 WHERE id = $1", [
      target.id,
      input.isActive,
    ]);

    if (!input.isActive) {
      await client.query("DELETE FROM monitor_user_sessions WHERE user_id = $1", [
        target.id,
      ]);
    }

    await audit(
      client,
      input.actorId,
      input.isActive ? "user.reactivate" : "user.deactivate",
      { userId: target.id, isActive: input.isActive },
    );

    return { changed: true };
  });
}

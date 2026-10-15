"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/current-user";
import { generatePassword, validateNewPassword } from "@/lib/auth/password";
import { PRESENCE_COLORS, type PresenceColor } from "@/lib/colors";
import { env } from "@/lib/env";
import { kickUser, refreshUserSockets } from "@/lib/realtime/socket-server";
import { ROLES, type Role } from "@/lib/rbac";
import {
  createUserAccount,
  resetUserPasswordAccount,
  setUserActiveAccount,
  updateUserAccount,
  UserActionError,
} from "@/lib/users";

export interface Credentials {
  url: string;
  email: string;
  password: string;
}

export interface UserActionState {
  error: string;
  credentials: Credentials | null;
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email."));

const createSchema = z.object({
  fullName: z.string().trim().min(1, "Enter a full name.").max(200),
  email: emailSchema,
  role: z.enum(ROLES),
  password: z.string().min(1, "Enter a password."),
  mustChangePassword: z.boolean(),
});

const updateSchema = z.object({
  userId: z.uuid("User not found."),
  fullName: z.string().trim().min(1, "Enter a full name.").max(200),
  role: z.enum(ROLES),
  avatarColor: z.enum(PRESENCE_COLORS),
});

function loginUrl(): string {
  return `${env.APP_URL.replace(/\/$/, "")}/login`;
}

function actionError(error: unknown): string {
  if (error instanceof UserActionError) {
    return error.message;
  }

  throw error;
}

function fieldError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

export async function createUser(
  _state: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("user.manage");
  const parsed = createSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
    mustChangePassword: formData.get("requirePasswordChange") === "on",
  });

  if (!parsed.success) {
    return { error: fieldError(parsed.error), credentials: null };
  }

  const policyError = validateNewPassword(parsed.data.password, parsed.data.email);

  if (policyError) {
    return { error: policyError, credentials: null };
  }

  try {
    await createUserAccount({
      actorId: actor.id,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      role: parsed.data.role,
      password: parsed.data.password,
      mustChangePassword: parsed.data.mustChangePassword,
    });
  } catch (error) {
    return { error: actionError(error), credentials: null };
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin/users/new");

  return {
    error: "",
    credentials: {
      url: loginUrl(),
      email: parsed.data.email,
      password: parsed.data.password,
    },
  };
}

export async function updateUser(
  _state: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("user.manage");
  const parsed = updateSchema.safeParse({
    userId: formData.get("userId"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
    avatarColor: formData.get("avatarColor"),
  });

  if (!parsed.success) {
    return { error: fieldError(parsed.error), credentials: null };
  }

  try {
    const result = await updateUserAccount({
      actorId: actor.id,
      userId: parsed.data.userId,
      fullName: parsed.data.fullName,
      role: parsed.data.role as Role,
      avatarColor: parsed.data.avatarColor as PresenceColor,
    });

    if (result.changed) {
      await refreshUserSockets(parsed.data.userId);
    }
  } catch (error) {
    return { error: actionError(error), credentials: null };
  }

  revalidatePath("/admin/users");
  return { error: "", credentials: null };
}

export async function resetUserPassword(userId: string): Promise<UserActionState> {
  const actor = await requirePermission("user.manage");
  const parsedId = z.uuid().safeParse(userId);

  if (!parsedId.success) {
    return { error: "User not found.", credentials: null };
  }

  const password = generatePassword();

  try {
    const reset = await resetUserPasswordAccount({
      actorId: actor.id,
      userId: parsedId.data,
      password,
    });
    kickUser(parsedId.data);
    revalidatePath("/admin/users");

    return {
      error: "",
      credentials: {
        url: loginUrl(),
        email: reset.email,
        password,
      },
    };
  } catch (error) {
    return { error: actionError(error), credentials: null };
  }
}

export async function setUserActive(
  userId: string,
  isActive: boolean,
): Promise<UserActionState> {
  const actor = await requirePermission("user.manage");
  const parsedId = z.uuid().safeParse(userId);

  if (!parsedId.success) {
    return { error: "User not found.", credentials: null };
  }

  try {
    const result = await setUserActiveAccount({
      actorId: actor.id,
      userId: parsedId.data,
      isActive,
    });

    if (result.changed && !isActive) {
      kickUser(parsedId.data);
    }
  } catch (error) {
    return { error: actionError(error), credentials: null };
  }

  revalidatePath("/admin/users");
  return { error: "", credentials: null };
}

export async function regeneratePassword(): Promise<string> {
  await requirePermission("user.manage");
  return generatePassword();
}

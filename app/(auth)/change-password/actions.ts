"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { queryOne, tx } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hashPassword, validateNewPassword, verifyPassword } from "@/lib/auth/password";
import { deleteOtherSessions, SESSION_COOKIE } from "@/lib/auth/session";

const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
  confirmPassword: z.string().min(1),
});

export interface ChangePasswordState {
  error: string;
}

export async function changePassword(
  _state: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/api/auth/logout");
  }

  const parsed = changeSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: "Enter your current password, a new password, and confirmation." };
  }

  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const policyError = validateNewPassword(parsed.data.newPassword, user.email);

  if (policyError) {
    return { error: policyError };
  }

  const stored = await queryOne<{ password_hash: string }>(
    "SELECT password_hash FROM monitor_users WHERE id = $1 AND is_active = true",
    [user.id],
  );

  const currentMatches = await verifyPassword(
    parsed.data.currentPassword,
    stored?.password_hash ?? "",
  );

  if (!stored || !currentMatches) {
    return { error: "Current password is incorrect." };
  }

  const nextHash = await hashPassword(parsed.data.newPassword);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  await tx(async (client) => {
    await client.query(
      `UPDATE monitor_users
       SET password_hash = $1, must_change_password = false
       WHERE id = $2`,
      [nextHash, user.id],
    );
  });

  if (token) {
    await deleteOtherSessions(user.id, token);
  }

  redirect("/");
}

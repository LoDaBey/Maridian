"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { deleteTeam, saveTeam } from "@/lib/teams/repo";
import { WORKSPACE_COLORS } from "@/lib/workspaces/colors";

const teamSchema = z.object({
  teamId: z.uuid().optional(),
  name: z.string().trim().min(1, "Give the team a name.").max(60),
  color: z.enum(WORKSPACE_COLORS),
  leaderId: z.uuid().nullable(),
  memberIds: z.array(z.uuid()).max(500),
});

export async function saveTeamAction(input: z.input<typeof teamSchema>): Promise<{ error: string }> {
  const user = await requireUser();
  if (!can(user.role, "team.manage")) {
    return { error: "Only operations managers and admins can manage teams." };
  }
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the team details." };
  }
  await saveTeam({ ...parsed.data, actorId: user.id });
  revalidatePath("/admin/teams");
  return { error: "" };
}

export async function deleteTeamAction(teamId: string): Promise<{ error: string }> {
  const user = await requireUser();
  if (!can(user.role, "team.manage")) {
    return { error: "Only operations managers and admins can manage teams." };
  }
  const id = z.uuid().safeParse(teamId);
  if (id.success) {
    await deleteTeam(id.data);
  }
  revalidatePath("/admin/teams");
  return { error: "" };
}

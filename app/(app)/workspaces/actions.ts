"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";
import { emitToUser } from "@/lib/realtime/emit";
import { announceInvitations } from "@/lib/workspaces/announce";
import {
  cancelInvitation,
  changeMemberRole,
  createWorkspace,
  getWorkspace,
  inviteToWorkspace,
  removeMember,
  resendInvitation,
  respondToInvitation,
  updateWorkspace,
  WORKSPACE_COLORS,
  WorkspaceActionError,
} from "@/lib/workspaces/repo";

export interface WorkspaceResult {
  error: string;
  id?: string;
}

const detailsSchema = z.object({
  name: z.string().trim().min(1, "Enter a workspace name.").max(60, "Use 60 characters or fewer."),
  description: z.string().trim().max(500, "Use 500 characters or fewer.").default(""),
  color: z.enum(WORKSPACE_COLORS).default(WORKSPACE_COLORS[0]),
});

const workspaceIdSchema = z.uuid("Workspace not found.");

function fieldError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

function fail(error: unknown): WorkspaceResult {
  if (error instanceof WorkspaceActionError) {
    return { error: error.message };
  }
  throw error;
}

/** Tells a person's open tabs to reload their workspace list and sidebar. */
function ping(userId: string, payload: Record<string, unknown> = {}): void {
  emitToUser(userId, "workspaces:changed", payload);
}

export async function createWorkspaceAction(input: {
  name: string;
  description?: string;
  color?: string;
}): Promise<WorkspaceResult> {
  const actor = await requireUser();
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  try {
    const created = await createWorkspace({ actor, ...parsed.data });
    revalidatePath("/", "layout");
    return { error: "", id: created.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateWorkspaceAction(input: {
  workspaceId: string;
  name: string;
  description?: string;
  color?: string;
}): Promise<WorkspaceResult> {
  const actor = await requireUser();
  const id = workspaceIdSchema.safeParse(input.workspaceId);
  const parsed = detailsSchema.safeParse(input);
  if (!id.success) {
    return { error: fieldError(id.error) };
  }
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  try {
    await updateWorkspace({ actor, workspaceId: id.data, ...parsed.data });
    revalidatePath("/", "layout");
    return { error: "" };
  } catch (error) {
    return fail(error);
  }
}

const inviteSchema = z.object({
  workspaceId: workspaceIdSchema,
  userIds: z.array(z.uuid("Choose a person.")).min(1, "Choose at least one person.").max(100),
  role: z.enum(["admin", "member"]).default("member"),
  message: z.string().trim().max(500, "Keep the note under 500 characters.").default(""),
});

export async function inviteMembersAction(input: {
  workspaceId: string;
  userIds: string[];
  role: "admin" | "member";
  message?: string;
}): Promise<WorkspaceResult & { invited?: number }> {
  const actor = await requireUser();
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  try {
    const invited = await inviteToWorkspace({ actor, ...parsed.data });
    await announceInvitations({ actor, workspaceId: parsed.data.workspaceId, userIds: invited, message: parsed.data.message });
    revalidatePath("/", "layout");
    return { error: "", invited: invited.length };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelInvitationAction(input: { invitationId: string }): Promise<WorkspaceResult> {
  const actor = await requireUser();
  const parsed = z.uuid("Invitation not found.").safeParse(input.invitationId);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  try {
    const cancelled = await cancelInvitation({ actor, invitationId: parsed.data });
    ping(cancelled.userId);
    revalidatePath("/", "layout");
    return { error: "" };
  } catch (error) {
    return fail(error);
  }
}

export async function resendInvitationAction(input: { invitationId: string }): Promise<WorkspaceResult> {
  const actor = await requireUser();
  const parsed = z.uuid("Invitation not found.").safeParse(input.invitationId);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  try {
    const resent = await resendInvitation({ actor, invitationId: parsed.data });
    await announceInvitations({ actor, workspaceId: resent.workspaceId, userIds: [resent.userId] });
    revalidatePath("/", "layout");
    return { error: "" };
  } catch (error) {
    return fail(error);
  }
}

export async function respondToInvitationAction(input: {
  invitationId: string;
  accept: boolean;
}): Promise<WorkspaceResult & { href?: string }> {
  const user = await requireUser();
  const parsed = z.uuid("Invitation not found.").safeParse(input.invitationId);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  try {
    const { workspaceId, workbookId } = await respondToInvitation({
      userId: user.id,
      invitationId: parsed.data,
      accept: input.accept === true,
    });
    // An invitation that came with a sheet opens that sheet.
    const firstTab = workbookId
      ? await query<{ id: string }>(
          `SELECT id FROM monitor_sheets WHERE workbook_id = $1 AND archived_at IS NULL ORDER BY position LIMIT 1`,
          [workbookId],
        )
      : [];
    revalidatePath("/", "layout");
    return { error: "", id: workspaceId, href: firstTab[0] ? `/s/${firstTab[0].id}` : `/w/${workspaceId}` };
  } catch (error) {
    return fail(error);
  }
}

const memberSchema = z.object({
  workspaceId: workspaceIdSchema,
  userId: z.uuid("Choose a person."),
});

export async function changeMemberRoleAction(input: {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member";
}): Promise<WorkspaceResult> {
  const actor = await requireUser();
  const parsed = memberSchema.extend({ role: z.enum(["owner", "admin", "member"]) }).safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  try {
    await changeMemberRole({ actor, ...parsed.data });
    ping(parsed.data.userId);
    revalidatePath("/", "layout");
    return { error: "" };
  } catch (error) {
    return fail(error);
  }
}

/** Removes a member (or the actor leaving) and closes any sheet they had open in it. */
export async function removeMemberAction(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceResult> {
  const actor = await requireUser();
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { error: fieldError(parsed.error) };
  }
  try {
    const workspace = await getWorkspace(actor, parsed.data.workspaceId);
    if (!workspace) {
      return { error: "Workspace not found." };
    }
    const sheetIds = await removeMember({ actor, ...parsed.data });
    emitToUser(parsed.data.userId, "access:revoked", { workspaceId: parsed.data.workspaceId, sheetIds });
    ping(parsed.data.userId);
    revalidatePath("/", "layout");
    return { error: "" };
  } catch (error) {
    return fail(error);
  }
}

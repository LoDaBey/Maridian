import { query, tx } from "@/lib/db";
import { appLink, emailLayout, sendEmail } from "@/lib/email";
import { insertNotifications } from "@/lib/notifications/repo";
import { emitToUser } from "@/lib/realtime/emit";

/** Bell notification, live badge update and (when configured) an email for new invitations. */
export async function announceInvitations(input: {
  actor: { id: string; fullName: string };
  workspaceId: string;
  userIds: string[];
  message?: string;
  workbookId?: string;
}): Promise<void> {
  if (input.userIds.length === 0) {
    return;
  }
  const [meta, people] = await Promise.all([
    query<{ workspace_name: string; workbook_name: string | null }>(
      `SELECT ws.name AS workspace_name,
              (SELECT w.name FROM monitor_workbooks w WHERE w.id = $2::uuid AND w.workspace_id = ws.id) AS workbook_name
       FROM monitor_workspaces ws WHERE ws.id = $1`,
      [input.workspaceId, input.workbookId ?? null],
    ),
    query<{ id: string; email: string; full_name: string }>(`SELECT id, email, full_name FROM monitor_users WHERE id = ANY($1::uuid[])`, [
      input.userIds,
    ]),
  ]);
  const workspaceName = meta[0]?.workspace_name ?? "a workspace";
  const workbookName = meta[0]?.workbook_name ?? null;
  const what = workbookName ? `${workspaceName} (sheet: ${workbookName})` : workspaceName;

  const created = await tx((client) =>
    insertNotifications(
      client,
      input.userIds.map((userId) => ({
        userId,
        type: "invitation" as const,
        sheetId: null,
        rowId: null,
        actorId: input.actor.id,
        payload: { href: "/invitations", title: workspaceName, excerpt: `invited you to ${what}` },
      })),
    ),
  );
  for (const notification of created) {
    emitToUser(notification.userId, "notification:created", notification);
  }
  for (const userId of input.userIds) {
    emitToUser(userId, "workspaces:changed", { invitation: true });
  }

  const link = appLink("/invitations");
  await Promise.all(
    people.map((person) =>
      sendEmail({
        to: person.email,
        subject: `${input.actor.fullName} invited you to ${workspaceName} on Meridian`,
        text: `${input.actor.fullName} invited you to ${what}.${input.message ? `\n\n"${input.message}"` : ""}\n\nAccept or decline: ${link}`,
        html: emailLayout({
          heading: `You're invited to ${workspaceName}`,
          lines: [
            `Hi ${person.full_name},`,
            workbookName
              ? `${input.actor.fullName} invited you to the ${workspaceName} workspace and the sheet "${workbookName}".`
              : `${input.actor.fullName} invited you to the ${workspaceName} workspace.`,
          ],
          note: input.message?.trim() || undefined,
          button: { label: "Review invitation", href: link },
        }),
      }),
    ),
  );
}

/** Tells sheet owners and workspace admins that someone asked to open a sheet. */
export async function announceAccessRequest(input: {
  requester: { id: string; fullName: string; email: string };
  sheetId: string;
  note: string;
}): Promise<"sent" | "missing" | "already"> {
  const recent = await query<{ id: string }>(
    `SELECT id FROM monitor_notifications
     WHERE type = 'access_request' AND actor_id = $1 AND sheet_id = $2 AND created_at > now() - interval '1 day'
     LIMIT 1`,
    [input.requester.id, input.sheetId],
  );
  if (recent.length > 0) {
    return "already";
  }
  const rows = await query<{ workbook_id: string; workbook_name: string; user_id: string; email: string }>(
    `SELECT w.id AS workbook_id, w.name AS workbook_name, u.id AS user_id, u.email
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id AND w.deleted_at IS NULL
     JOIN monitor_users u ON u.is_active = true AND (
       EXISTS (SELECT 1 FROM monitor_workbook_members bm WHERE bm.workbook_id = w.id AND bm.user_id = u.id AND bm.role = 'owner')
       OR EXISTS (SELECT 1 FROM monitor_workspace_members wm WHERE wm.workspace_id = w.workspace_id AND wm.user_id = u.id AND wm.role IN ('owner', 'admin'))
     )
     WHERE s.id = $1 AND u.id <> $2`,
    [input.sheetId, input.requester.id],
  );
  if (rows.length === 0) {
    return "missing";
  }
  const workbookName = rows[0]!.workbook_name;
  const created = await tx((client) =>
    insertNotifications(
      client,
      rows.map((row) => ({
        userId: row.user_id,
        type: "access_request" as const,
        sheetId: input.sheetId,
        rowId: null,
        actorId: input.requester.id,
        payload: {
          href: `/s/${input.sheetId}?share=1`,
          excerpt: `asked for access${input.note ? `: “${input.note}”` : ""}`,
        },
      })),
    ),
  );
  for (const notification of created) {
    emitToUser(notification.userId, "notification:created", notification);
  }
  const link = appLink(`/s/${input.sheetId}?share=1`);
  await Promise.all(
    rows.map((row) =>
      sendEmail({
        to: row.email,
        subject: `${input.requester.fullName} asked for access to ${workbookName}`,
        text: `${input.requester.fullName} (${input.requester.email}) asked for access to "${workbookName}".${input.note ? `\n\n"${input.note}"` : ""}\n\nShare it: ${link}`,
        html: emailLayout({
          heading: `Access request for ${workbookName}`,
          lines: [`${input.requester.fullName} (${input.requester.email}) asked to open this sheet.`],
          note: input.note || undefined,
          button: { label: "Open sharing", href: link },
        }),
      }),
    ),
  );
  return "sent";
}

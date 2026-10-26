"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { announceAccessRequest } from "@/lib/workspaces/announce";

/** Asks a sheet's owners and workspace admins to share it. The same answer either way, so it can't probe for sheets. */
export async function requestSheetAccess(input: { sheetId: string; note: string }): Promise<{ error: string; message: string }> {
  const user = await requireUser();
  const sheetId = z.uuid().safeParse(input.sheetId);
  const note = z.string().trim().max(300).safeParse(input.note ?? "");
  if (!sheetId.success || !note.success) {
    return { error: "Keep the note under 300 characters.", message: "" };
  }
  const result = await announceAccessRequest({ requester: user, sheetId: sheetId.data, note: note.data });
  return {
    error: "",
    message:
      result === "already"
        ? "You already asked today. The owner has been notified."
        : "Request sent. If the sheet exists, its owner will be notified and can share it with you.",
  };
}

import type { FileAttachment } from "@/lib/db-types";
import { canonicalizeUrl } from "@/lib/urls";

export function nameFromFileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    const base = path.split("/").filter(Boolean).pop() ?? "";
    const trimmed = base.replace(/[_-]+/g, " ").trim();
    if (trimmed) {
      return trimmed.slice(0, 200);
    }
    return parsed.hostname.slice(0, 200);
  } catch {
    return "File";
  }
}

export function fileAttachmentFromLink(
  urlText: string,
  nameText = "",
): { ok: true; file: FileAttachment } | { ok: false; error: string } {
  const url = canonicalizeUrl(urlText.trim());
  if (!url) {
    return { ok: false, error: "Enter an http or https file link." };
  }
  const name = nameText.trim() || nameFromFileUrl(url);
  if (!name || name.length > 200) {
    return { ok: false, error: "File name is invalid." };
  }
  return {
    ok: true,
    file: {
      id: crypto.randomUUID(),
      name,
      url,
    },
  };
}


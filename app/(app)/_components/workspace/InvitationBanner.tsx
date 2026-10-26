"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail, X } from "lucide-react";

/** Shown across the app while invitations wait for an answer (hidden on the invitations page). */
export function InvitationBanner({ workspaces }: { workspaces: string[] }) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  if (hidden || workspaces.length === 0 || pathname.startsWith("/invitations")) {
    return null;
  }
  const names = workspaces.length <= 2 ? workspaces.join(" and ") : `${workspaces.slice(0, 2).join(", ")} and ${workspaces.length - 2} more`;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-primary/20 bg-primary/10 px-4 py-2 text-sm">
      <Mail className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate" dir="auto">
        You&apos;re invited to <span className="font-medium">{names}</span>.
      </p>
      <Link href="/invitations" className="shrink-0 rounded-md bg-primary px-3 py-1 font-medium text-white hover:bg-primary/90">
        Review
      </Link>
      <button type="button" aria-label="Hide for now" className="cursor-pointer rounded-md p-1 text-muted hover:bg-primary/10" onClick={() => setHidden(true)}>
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

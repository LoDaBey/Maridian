"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import { BoardPreview } from "./BoardPreview";
import { createSheet } from "@/app/(app)/sheets/actions";
import type { SavedTemplateSummary } from "@/lib/sheets/sheets-repo";

export function TemplateCard({
  workspaceId,
  template,
  suggestedName,
  canUse,
  canDelete,
  onDelete,
}: {
  workspaceId: string;
  template: SavedTemplateSummary;
  suggestedName: string;
  canUse: boolean;
  canDelete: boolean;
  onDelete: (template: SavedTemplateSummary) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function useTemplate(): Promise<void> {
    if (!canUse || pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await createSheet({ workspaceId, name: suggestedName, savedTemplateId: template.id });
      if (result.error || !result.id) {
        setError(result.error || "Could not create the sheet.");
        return;
      }
      router.push(`/s/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="relative">
      <button
        type="button"
        aria-label={`Use ${template.name} as template`}
        disabled={!canUse || pending}
        className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-surface text-start shadow-[0_6px_18px_rgba(50,51,56,0.08)] outline-none hover:shadow-[0_10px_24px_rgba(50,51,56,0.14)] focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => {
          void useTemplate();
        }}
      >
        <BoardPreview />
        <div className="px-4 py-3 pe-10">
          <p className="truncate font-medium text-text">{template.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {pending ? "Creating..." : "Use as template"}
          </p>
        </div>
      </button>
      {canDelete ? (
        <div ref={menuRef} className="absolute end-2 bottom-2">
          <button
            type="button"
            aria-label={`Template actions for ${template.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-row hover:text-text"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              aria-label={`Template actions for ${template.name}`}
              className="absolute end-0 bottom-full z-20 mb-1 w-44 rounded-lg border border-border bg-surface p-1 shadow-sm"
            >
              <button
                type="button"
                role="menuitem"
                aria-label={`Delete ${template.name}`}
                className="flex w-full cursor-pointer rounded-lg px-2 py-1.5 text-start text-danger outline-none hover:bg-row"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(template);
                }}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

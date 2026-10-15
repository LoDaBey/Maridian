"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { BoardPreview } from "./BoardPreview";
import { Tooltip } from "@/components/ui/Tooltip";
import type { WorkbookSummary } from "@/lib/sheets/sheets-repo";

export function WorkbookCard({
  workbook,
  canSaveTemplate,
  canDelete,
  onSaveTemplate,
  onDelete,
  onShare,
}: {
  workbook: WorkbookSummary;
  canSaveTemplate: boolean;
  canDelete: boolean;
  onSaveTemplate: (workbook: WorkbookSummary) => void;
  onDelete: (workbook: WorkbookSummary) => void;
  onShare: (workbook: WorkbookSummary) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const href = workbook.firstTabId ? `/s/${workbook.firstTabId}` : "/";
  const showMenu = true;

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

  return (
    <li className="relative">
      <Link
        href={href}
        aria-label={`Open ${workbook.name}`}
        className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_6px_18px_rgba(50,51,56,0.08)] outline-none hover:shadow-[0_10px_24px_rgba(50,51,56,0.14)] focus-visible:ring-2 focus-visible:ring-primary"
      >
        <BoardPreview preview={workbook.preview} />
        <div className="px-4 py-3 pe-10">
          <p className="truncate text-sm font-medium text-text">{workbook.name}</p>
        </div>
      </Link>
      {showMenu ? (
        <div ref={menuRef} className="absolute end-2 bottom-2">
          <button
            type="button"
            aria-label={`Sheet actions for ${workbook.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-bg hover:text-text"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              aria-label={`Sheet actions for ${workbook.name}`}
              className="absolute end-0 bottom-full z-20 mb-1 w-44 rounded-lg border border-border bg-surface p-1 shadow-sm"
            >
              <button
                type="button"
                role="menuitem"
                aria-label={`Share ${workbook.name}`}
                className="flex w-full cursor-pointer rounded-lg px-2 py-1.5 text-start outline-none hover:bg-row"
                onClick={() => {
                  setMenuOpen(false);
                  onShare(workbook);
                }}
              >
                Share
              </button>
              {canSaveTemplate ? (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`Save ${workbook.name} as template`}
                  className="flex w-full cursor-pointer rounded-lg px-2 py-1.5 text-start outline-none hover:bg-row"
                  onClick={() => {
                    setMenuOpen(false);
                    onSaveTemplate(workbook);
                  }}
                >
                  Save as template
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`Delete ${workbook.name}`}
                  className="flex w-full cursor-pointer rounded-lg px-2 py-1.5 text-start text-danger outline-none hover:bg-row"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(workbook);
                  }}
                >
                  Delete
                </button>
              ) : (
                <Tooltip label="Only the owner can delete this sheet">
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`Only the owner can delete ${workbook.name}`}
                    disabled
                    className="flex w-full cursor-not-allowed rounded-lg px-2 py-1.5 text-start text-danger outline-none opacity-50"
                  >
                    Delete
                  </button>
                </Tooltip>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

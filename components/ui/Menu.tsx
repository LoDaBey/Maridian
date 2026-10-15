"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";

export const menuItemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start outline-none hover:bg-row focus:bg-primary/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const EDGE = 8;

export function Menu({
  open,
  x,
  y,
  label,
  onClose,
  children,
  anchorRight,
  anchorHeight = 0,
}: {
  open: boolean;
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
  anchorRight?: number;
  anchorHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (!open) {
      if (node.matches(":popover-open")) {
        node.hidePopover();
      }
      return;
    }
    if (!node.matches(":popover-open")) {
      node.showPopover();
    }
    placeMenu(node, { x, y, anchorRight, anchorHeight });
    const item = node.querySelector<HTMLElement>(
      "[role='menuitem']:not([aria-disabled='true']), [role='menuitemcheckbox']:not([aria-disabled='true'])",
    );
    item?.focus({ preventScroll: true });
  }, [open, x, y, anchorRight, anchorHeight]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-grid-menu]")) {
        return;
      }
      onClose();
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, [open, onClose]);

  return (
    <div
      ref={ref}
      popover="manual"
      role="menu"
      aria-label={label}
      data-grid-menu="true"
      id={titleId}
      style={{ position: "fixed", inset: "auto", left: x, top: y, margin: 0 }}
      className="z-50 max-h-[70vh] min-w-52 overflow-auto rounded-lg border border-border bg-surface p-1 text-sm text-text shadow-lg"
      onKeyDown={(event) => {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>("[role='menuitem'], [role='menuitemcheckbox']") ?? [],
        );
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          items[(index + 1 + items.length) % items.length]?.focus({ preventScroll: true });
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          items[(index - 1 + items.length) % items.length]?.focus({ preventScroll: true });
        } else if (event.key === "Home") {
          event.preventDefault();
          items[0]?.focus({ preventScroll: true });
        } else if (event.key === "End") {
          event.preventDefault();
          items[items.length - 1]?.focus({ preventScroll: true });
        }
      }}
    >
      {open ? children : null}
    </div>
  );
}

function placeMenu(
  node: HTMLElement,
  anchor: { x: number; y: number; anchorRight?: number; anchorHeight: number },
): void {
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE);
  const maxTop = Math.max(EDGE, window.innerHeight - height - EDGE);

  let left = anchor.x;
  if (left + width > window.innerWidth - EDGE) {
    left = (anchor.anchorRight ?? anchor.x) - width;
  }
  left = Math.min(Math.max(EDGE, left), maxLeft);

  let top = anchor.y;
  if (top + height > window.innerHeight - EDGE) {
    top = anchor.y - anchor.anchorHeight - height;
  }
  top = Math.min(Math.max(EDGE, top), maxTop);

  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

export function MenuItem({
  label,
  icon,
  disabled = false,
  title,
  checked,
  danger = false,
  onSelect,
}: {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
  checked?: boolean;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-checked={checked}
      title={title}
      className={`${menuItemClass} ${danger ? "text-danger" : ""}`}
      onClick={() => {
        if (!disabled) {
          onSelect();
        }
      }}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

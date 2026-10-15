"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

export interface TabMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

export function TabMenu({
  label,
  items,
  position,
  onClose,
}: {
  label: string;
  items: TabMenuItem[];
  position: { left: number; bottom: number };
  onClose: () => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("[data-tab-menu-trigger]")) {
        return;
      }
      if (!document.getElementById("sheet-tab-menu")?.contains(target)) {
        onClose();
      }
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = itemRefs.current.filter((item) => item !== null);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    }
    if (event.key === "Home") {
      event.preventDefault();
      buttons[0]?.focus();
    }
    if (event.key === "End") {
      event.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  }

  return (
    <div
      id="sheet-tab-menu"
      role="menu"
      aria-label={label}
      className="fixed z-30 min-w-44 rounded-md border border-border bg-surface p-1 text-sm shadow-sm"
      style={{ left: Math.max(8, position.left), bottom: position.bottom }}
      onKeyDown={onMenuKeyDown}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          role="menuitem"
          aria-label={item.label}
          className={`block w-full cursor-pointer rounded-md px-3 py-1.5 text-left hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${item.danger ? "text-danger" : ""}`}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

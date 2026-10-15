"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TooltipProps } from "./types";

export function Tooltip({ label, children, disabled = false }: TooltipProps) {
  const tipRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const node = tipRef.current;
    if (!node || !anchor) {
      return;
    }
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left = anchor.left + anchor.width / 2 - width / 2;
    left = Math.min(window.innerWidth - width - 8, Math.max(8, left));
    let top = anchor.bottom + 8;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, anchor.top - height - 8);
    }
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [anchor]);

  return (
    <>
      <span
        className="inline-flex"
        onPointerEnter={(event) => {
          if (!disabled) {
            setAnchor(event.currentTarget.getBoundingClientRect());
          }
        }}
        onPointerLeave={() => setAnchor(null)}
      >
        {children}
      </span>
      {anchor && !disabled
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              className="pointer-events-none fixed z-[80] rounded-lg bg-text px-2 py-1 text-xs text-bg shadow-md"
              style={{ left: 0, top: 0 }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

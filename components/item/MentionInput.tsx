"use client";

import { useRef, type KeyboardEvent } from "react";
import type { DirectoryUser } from "@/components/grid/types";
import { MentionText } from "./MentionText";

export function MentionInput({
  body,
  users,
  placeholder,
  disabled,
  autoFocus,
  onChange,
  onKeyDown,
}: {
  body: string;
  users: DirectoryUser[];
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative rounded-lg border border-border">
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm text-text"
      >
        {body ? <MentionText body={body} users={users} /> : null}
      </div>
      <textarea
        value={body}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={placeholder}
        className={`relative z-10 min-h-20 w-full resize-y rounded-lg bg-transparent px-3 py-2 text-sm outline-none ${body ? "caret-[#323338] text-transparent [-webkit-text-fill-color:transparent]" : ""}`}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (overlayRef.current) {
            overlayRef.current.scrollTop = event.currentTarget.scrollTop;
            overlayRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

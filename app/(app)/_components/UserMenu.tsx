"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { UserAvatar } from "@/app/(app)/admin/users/_components/user-avatar";
import { can, ROLE_LABEL, type Role } from "@/lib/rbac";

export function UserMenu({
  fullName,
  role,
  avatarColor,
}: {
  fullName: string;
  role: Role;
  avatarColor: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      itemRefs.current[0]?.focus();
    }
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = itemRefs.current.filter((item) => item !== null);
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    }
  }

  const showAdmin = can(role, "user.manage");
  const showDeletedSheets = can(role, "sheet.purge");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Account menu for ${fullName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="cursor-pointer rounded-md outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => setOpen((current) => !current)}
      >
        <UserAvatar fullName={fullName} color={avatarColor} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-30 mt-2 w-56 rounded-md border border-border bg-surface p-1 text-sm shadow-sm"
          onKeyDown={onMenuKeyDown}
        >
          <div className="px-3 py-2">
            <p className="font-medium">{fullName}</p>
            <p className="text-muted">{ROLE_LABEL[role]}</p>
          </div>
          <Link
            ref={(node) => {
              itemRefs.current[0] = node;
            }}
            role="menuitem"
            href="/change-password"
            className="block cursor-pointer rounded-md px-3 py-2 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => setOpen(false)}
          >
            Change password
          </Link>
          {showAdmin ? (
            <>
              <Link
                ref={(node) => {
                  itemRefs.current[1] = node;
                }}
                role="menuitem"
                href="/admin/users"
                className="block cursor-pointer rounded-md px-3 py-2 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => setOpen(false)}
              >
                Admin · Users
              </Link>
              <Link
                ref={(node) => {
                  itemRefs.current[2] = node;
                }}
                role="menuitem"
                href="/admin/users/new"
                className="block cursor-pointer rounded-md px-3 py-2 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => setOpen(false)}
              >
                Admin · New user
              </Link>
            </>
          ) : null}
          {showDeletedSheets ? (
            <Link
              ref={(node) => {
                itemRefs.current[showAdmin ? 3 : 1] = node;
              }}
              role="menuitem"
              href="/admin/sheets"
              className="block cursor-pointer rounded-md px-3 py-2 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => setOpen(false)}
            >
              Admin · Deleted sheets
            </Link>
          ) : null}
          <form action="/api/auth/logout" method="post">
            <button
              ref={(node) => {
                itemRefs.current[(showAdmin ? 2 : 0) + (showDeletedSheets ? 1 : 0) + 1] = node;
              }}
              type="submit"
              role="menuitem"
              aria-label="Sign out"
              className="w-full cursor-pointer rounded-md px-3 py-2 text-left hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

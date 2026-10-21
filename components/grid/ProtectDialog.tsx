"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Lock } from "lucide-react";
import {
  getProtectionSettings,
  removeProtection,
  saveProtection,
  setTabVisibility,
  type ProtectionPerson,
} from "@/app/(app)/sheets/protection-actions";
import type { ProtectionScope } from "@/lib/sheets/workbook-access";

const SCOPE_TEXT: Record<ProtectionScope, string> = {
  tab: "tab",
  group: "group",
  column: "column",
};

function Avatar({ person }: { person: ProtectionPerson }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white"
      style={{ backgroundColor: person.avatarColor }}
    >
      {(person.fullName[0] ?? "?").toUpperCase()}
    </span>
  );
}

function Shell({
  title,
  icon,
  children,
  error,
  pending,
  canSave,
  onClose,
  onSave,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  error: string;
  pending: boolean;
  canSave: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);

  // Portal to <body>: the grid is animated (transform) and may be right-to-left,
  // either of which would break a fixed, centered dialog.
  return createPortal(
    <div dir="ltr" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-border bg-surface p-5 text-sm text-text shadow-xl"
      >
        <h2 dir="auto" className="flex items-center gap-2 text-base font-semibold">
          {icon}
          {title}
        </h2>
        <div className="mt-3 min-h-0 flex-1 overflow-auto">{children}</div>
        {error ? (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={pending} className="cursor-pointer rounded-md px-3 py-1.5 hover:bg-row" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !canSave}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-white disabled:opacity-60"
            onClick={onSave}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PeopleList({
  people,
  selected,
  disabled,
  onToggle,
  empty,
}: {
  people: ProtectionPerson[];
  selected: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
  empty: string;
}) {
  if (people.length === 0) {
    return <p className="px-2 py-2 text-muted">{empty}</p>;
  }
  return (
    <ul className="mt-2 max-h-56 space-y-0.5 overflow-auto rounded-md border border-border p-1">
      {people.map((person) => (
        <li key={person.id}>
          <label
            className={`flex items-center gap-2 rounded px-2 py-1.5 ${disabled ? "opacity-50" : "cursor-pointer hover:bg-row"}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(person.id)}
              disabled={disabled}
              aria-label={person.fullName}
              className="size-4 accent-primary"
              onChange={() => onToggle(person.id)}
            />
            <Avatar person={person} />
            <span dir="auto" className="flex-1 truncate">
              {person.fullName}
            </span>
            {person.access === "viewer" ? <span className="text-xs text-muted">Can view</span> : null}
          </label>
        </li>
      ))}
    </ul>
  );
}

function useSettings(sheetId: string) {
  const [state, setState] = useState<Awaited<ReturnType<typeof getProtectionSettings>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getProtectionSettings({ sheetId }).then((result) => {
      if (!cancelled) {
        setState(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sheetId]);
  return state;
}

/** Lock a tab, group or column so only chosen people can edit or delete there. */
export function ProtectDialog({
  sheetId,
  scope,
  targetId,
  targetName,
  onClose,
}: {
  sheetId: string;
  scope: ProtectionScope;
  targetId: string | null;
  targetName: string;
  onClose: () => void;
}) {
  const settings = useSettings(sheetId);
  const existing = settings?.protections.find((item) => item.scope === scope && item.targetId === targetId) ?? null;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [editors, setEditors] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const isOn = enabled ?? existing !== null;
  const chosen = editors ?? existing?.editors ?? [];
  // Owners always edit; viewers never can, so neither needs a tick.
  const people = (settings?.people ?? []).filter((person) => person.access === "editor");

  async function save() {
    setPending(true);
    setError("");
    try {
      const result = isOn
        ? await saveProtection({ sheetId, scope, targetId, editors: chosen })
        : await removeProtection({ sheetId, scope, targetId });
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Shell
      title={`Protect ${SCOPE_TEXT[scope]} “${targetName}”`}
      icon={<Lock className="size-4 text-muted" aria-hidden="true" />}
      error={error || settings?.error || ""}
      pending={pending}
      canSave={Boolean(settings?.canManage)}
      onClose={onClose}
      onSave={() => void save()}
    >
      {!settings ? (
        <p className="text-muted">Loading…</p>
      ) : !settings.canManage ? (
        <p className="text-muted">Only the sheet owner or a workspace admin can protect parts of this sheet.</p>
      ) : (
        <>
          <p className="text-muted">
            Protected {SCOPE_TEXT[scope] === "column" ? "cells in this column" : `rows in this ${SCOPE_TEXT[scope]}`} can&apos;t be
            edited or deleted except by the people you choose. The sheet owner and workspace admins can always edit.
          </p>
          <fieldset className="mt-3 space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="protect" checked={!isOn} className="accent-primary" onChange={() => setEnabled(false)} />
              Anyone who can edit the sheet
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="protect" checked={isOn} className="accent-primary" onChange={() => setEnabled(true)} />
              Only owners, admins and these people:
            </label>
          </fieldset>
          <PeopleList
            people={people}
            selected={chosen}
            disabled={!isOn}
            empty="Nobody else can edit this sheet. Share it with editors first."
            onToggle={(id) =>
              setEditors(chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id])
            }
          />
        </>
      )}
    </Shell>
  );
}

/** Show a tab to everyone with access, or only to chosen people. */
export function TabVisibilityDialog({
  sheetId,
  tabName,
  onClose,
}: {
  sheetId: string;
  tabName: string;
  onClose: () => void;
}) {
  const settings = useSettings(sheetId);
  const [restricted, setRestricted] = useState<boolean | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const isRestricted = restricted ?? (settings ? settings.visibleTo !== null : false);
  const selected = chosen ?? settings?.visibleTo ?? [];
  const people = (settings?.people ?? []).filter((person) => person.access !== "owner");

  async function save() {
    setPending(true);
    setError("");
    try {
      const result = await setTabVisibility({ sheetId, visibleTo: isRestricted ? selected : null });
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Shell
      title={`Who can see “${tabName}”`}
      icon={<Eye className="size-4 text-muted" aria-hidden="true" />}
      error={error || settings?.error || ""}
      pending={pending}
      canSave={Boolean(settings?.canManage)}
      onClose={onClose}
      onSave={() => void save()}
    >
      {!settings ? (
        <p className="text-muted">Loading…</p>
      ) : !settings.canManage ? (
        <p className="text-muted">Only the sheet owner or a workspace admin can hide tabs.</p>
      ) : (
        <>
          <p className="text-muted">
            A hidden tab doesn&apos;t appear for other people, and its data stays out of their dashboards. The sheet owner
            and workspace admins always see every tab.
          </p>
          <fieldset className="mt-3 space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="visibility"
                checked={!isRestricted}
                className="accent-primary"
                onChange={() => setRestricted(false)}
              />
              Everyone with access to this sheet
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="visibility"
                checked={isRestricted}
                className="accent-primary"
                onChange={() => setRestricted(true)}
              />
              Only owners, admins and these people:
            </label>
          </fieldset>
          <PeopleList
            people={people}
            selected={selected}
            disabled={!isRestricted}
            empty="Nobody else has access to this sheet yet."
            onToggle={(id) =>
              setChosen(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
            }
          />
        </>
      )}
    </Shell>
  );
}

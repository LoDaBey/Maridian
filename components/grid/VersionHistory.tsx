"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import { listVersions, restoreVersion, saveVersion, type SheetVersion } from "@/app/(app)/sheets/version-actions";

/** Named snapshots of a tab; restoring one saves the current state first. */
export function VersionHistory({ sheetId, tabName }: { sheetId: string; tabName: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ versions: SheetVersion[]; canRestore: boolean; canSave: boolean } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const reload = () => void listVersions(sheetId).then(setData);

  useEffect(() => {
    if (open) {
      void listVersions(sheetId).then(setData);
    }
  }, [open, sheetId]);

  async function save() {
    setBusy("save");
    const result = await saveVersion({ sheetId, name });
    setBusy(null);
    setMessage(result.error || "Version saved.");
    if (!result.error) {
      setName("");
      reload();
    }
  }

  async function restore(version: SheetVersion) {
    if (!window.confirm(`Restore “${version.name}”? Everyone with the tab open sees it change. The current state is saved as a version first.`)) {
      return;
    }
    setBusy(version.id);
    const result = await restoreVersion({ sheetId, versionId: version.id });
    setBusy(null);
    setMessage(result.error || `Restored “${version.name}”.`);
    reload();
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-muted hover:bg-row hover:text-text"
        onClick={() => setOpen(true)}
      >
        <History className="size-4" aria-hidden="true" />
        <span className="hidden lg:inline">Versions</span>
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex justify-end bg-black/30" dir="ltr" onClick={() => setOpen(false)}>
              <aside
                role="dialog"
                aria-label="Version history"
                className="flex h-full w-full max-w-sm flex-col bg-surface p-5 text-sm shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Version history</h2>
                  <button type="button" aria-label="Close" className="cursor-pointer rounded-md p-1.5 hover:bg-row" onClick={() => setOpen(false)}>
                    <X className="size-5" aria-hidden="true" />
                  </button>
                </div>
                <p className="mb-4 text-muted">
                  Snapshots of <span dir="auto" className="font-medium text-text">{tabName}</span>. For one cell&apos;s changes, right-click it and choose Cell history.
                </p>
                {data?.canSave ? (
                  <div className="mb-4 flex gap-2">
                    <input
                      dir="auto"
                      value={name}
                      maxLength={80}
                      placeholder="Name, e.g. Before month-end cleanup"
                      aria-label="Version name"
                      className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus:border-primary"
                      onChange={(event) => setName(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && name.trim() && void save()}
                    />
                    <button
                      type="button"
                      disabled={!name.trim() || busy !== null}
                      className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                      onClick={() => void save()}
                    >
                      {busy === "save" ? "Saving…" : "Save version"}
                    </button>
                  </div>
                ) : null}
                {message ? (
                  <p role="status" className="mb-3 rounded-md bg-row px-3 py-2 text-xs">
                    {message}
                  </p>
                ) : null}
                <ul className="min-h-0 flex-1 space-y-2 overflow-auto">
                  {data === null ? <li className="text-muted">Loading…</li> : null}
                  {data?.versions.length === 0 ? <li className="text-muted">No versions saved yet.</li> : null}
                  {data?.versions.map((version) => (
                    <li key={version.id} className="rounded-lg border border-border p-3">
                      <p dir="auto" className="font-medium">
                        {version.name}
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(version.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                        {version.createdByName ? ` · ${version.createdByName}` : ""} · {version.rowCount.toLocaleString("en-US")} rows
                      </p>
                      {data.canRestore ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="mt-2 cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs hover:bg-row disabled:opacity-50"
                          onClick={() => void restore(version)}
                        >
                          {busy === version.id ? "Restoring…" : "Restore this version"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

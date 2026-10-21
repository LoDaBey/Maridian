"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { createWorkspaceAction, updateWorkspaceAction } from "@/app/(app)/workspaces/actions";
import { WORKSPACE_COLORS } from "@/lib/workspaces/colors";

/** Creates a workspace, or edits one when `workspace` is given. */
export function CreateWorkspaceDialog({
  open,
  onClose,
  workspace,
}: {
  open: boolean;
  onClose: () => void;
  workspace?: { id: string; name: string; description: string; color: string };
}) {
  if (!open) {
    return null;
  }
  return <WorkspaceForm onClose={onClose} workspace={workspace} />;
}

function WorkspaceForm({
  onClose,
  workspace,
}: {
  onClose: () => void;
  workspace?: { id: string; name: string; description: string; color: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(workspace?.name ?? "");
  const [description, setDescription] = useState(workspace?.description ?? "");
  const [color, setColor] = useState<string>(workspace?.color ?? WORKSPACE_COLORS[0]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const editing = Boolean(workspace);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = workspace
        ? await updateWorkspaceAction({ workspaceId: workspace.id, name, description, color })
        : await createWorkspaceAction({ name, description, color });
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      if (!workspace && result.id) {
        router.push(`/w/${result.id}`);
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open title={editing ? "Workspace settings" : "Create workspace"} onClose={onClose}>
      <form className="mt-3 space-y-3 text-sm" onSubmit={(event) => void submit(event)}>
        <label className="block">
          <span className="mb-1 block text-muted">Name</span>
          <input
            autoFocus
            value={name}
            maxLength={60}
            required
            placeholder="e.g. Reports team"
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus:border-primary"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted">Description (optional)</span>
          <textarea
            value={description}
            maxLength={500}
            rows={3}
            placeholder="What this workspace is for"
            className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus:border-primary"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <fieldset>
          <legend className="mb-1 text-muted">Color</legend>
          <div className="flex flex-wrap gap-2">
            {WORKSPACE_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Color ${swatch}`}
                aria-pressed={swatch === color}
                className={`size-7 cursor-pointer rounded-md outline-none ring-offset-2 ring-offset-surface ${
                  swatch === color ? "ring-2 ring-text" : ""
                }`}
                style={{ backgroundColor: swatch }}
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="cursor-pointer rounded-md px-3 py-1.5 hover:bg-bg"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : editing ? "Save" : "Create workspace"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

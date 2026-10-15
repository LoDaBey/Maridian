"use client";

import { Plus } from "lucide-react";

export function AddTabButton({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Add tab"
      disabled={pending}
      className="cursor-pointer rounded-lg px-3 text-primary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onAdd}
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

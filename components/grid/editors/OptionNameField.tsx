"use client";

import { useState, type FormEvent } from "react";
import { ActionButton } from "@/components/grid/ActionButton";

export function OptionNameField({ onAdd }: { onAdd: (label: string) => void }) {
  const [name, setName] = useState("");
  const label = name.trim();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!label) {
      return;
    }
    onAdd(label);
    setName("");
  }

  return (
    <form className="flex items-center gap-1 border-b border-border p-1" onSubmit={submit}>
      <input
        aria-label="Custom name"
        placeholder="Add a name"
        value={name}
        maxLength={50}
        className="min-w-0 flex-1 rounded-lg border border-border px-2 py-1 text-[13px] outline-none"
        onChange={(event) => setName(event.target.value)}
      />
      <ActionButton
        type="submit"
        aria-label="Add name"
        disabled={!label}
        className="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Add
      </ActionButton>
    </form>
  );
}

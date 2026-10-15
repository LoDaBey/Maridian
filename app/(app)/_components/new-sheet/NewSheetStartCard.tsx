import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { ActionButton } from "@/components/grid/ActionButton";

export function NewSheetStartCard({
  icon: Icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <ActionButton
      type="button"
      aria-label={title}
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-start ${
        selected ? "border-primary bg-primary/5" : "border-border bg-surface hover:border-primary/40"
      }`}
    >
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-primary text-white" : "bg-bg text-text"}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{description}</span>
      </span>
      <span className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full ${selected ? "bg-primary text-white" : "ring-1 ring-border"}`}>
        {selected ? <Check className="size-3" aria-hidden="true" /> : null}
      </span>
    </ActionButton>
  );
}

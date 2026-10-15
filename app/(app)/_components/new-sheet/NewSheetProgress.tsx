import { Check } from "lucide-react";
import type { NewSheetStep } from "@/lib/db-types";

export function NewSheetProgress({
  step,
  steps,
}: {
  step: NewSheetStep;
  steps: Array<{ id: NewSheetStep; label: string }>;
}) {
  const current = steps.findIndex((item) => item.id === step);

  return (
    <ol className="mt-5 flex items-center gap-2" aria-label="New sheet steps">
      {steps.map((item, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={item.id} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done || active ? "bg-primary text-white" : "bg-surface text-muted ring-1 ring-border"
              }`}
            >
              {done ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span className={`truncate text-xs font-medium ${active ? "text-text" : "text-muted"}`}>{item.label}</span>
            {index < steps.length - 1 ? <span className={`h-px min-w-3 flex-1 ${done ? "bg-primary" : "bg-border"}`} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { readRules } from "@/lib/sheets/conditional";
import type { JsonValue } from "@/lib/sheets/ops";
import { RULE_OPS, type FormatRule, type RuleOp } from "@/lib/sheets/values";

const OP_LABEL: Record<RuleOp, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  gt: "is greater than",
  lt: "is less than",
  between: "is between",
  empty: "is empty",
  not_empty: "is not empty",
};

/** Soft fills that keep dark text readable. */
const COLORS = ["#ffd6d9", "#ffe8c2", "#fff3b0", "#d4f5e2", "#d6eaff", "#e9dcff", "#ffd9f0", "#e2e4ea"];

export function ConditionalFormatDialog({
  name,
  settings,
  onClose,
  onSave,
}: {
  name: string;
  settings: Record<string, JsonValue>;
  onClose: () => void;
  onSave: (rules: FormatRule[]) => void;
}) {
  const [rules, setRules] = useState<FormatRule[]>(() => readRules(settings));
  const update = (index: number, patch: Partial<FormatRule>) =>
    setRules((current) => current.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="ltr" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Conditional formatting for ${name}`}
        className="w-full max-w-lg rounded-2xl bg-surface p-5 text-sm shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Conditional formatting</h2>
          <button type="button" aria-label="Close" className="cursor-pointer rounded-md p-1.5 hover:bg-row" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mb-4 text-muted">
          Colour <span dir="auto" className="font-medium text-text">{name}</span> cells by their value. The first matching rule wins.
        </p>
        <ul className="space-y-2">
          {rules.map((rule, index) => (
            <li key={index} className="rounded-lg border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">If cell</span>
                <select
                  aria-label="Condition"
                  value={rule.op}
                  className="rounded-md border border-border bg-surface px-2 py-1"
                  onChange={(event) => update(index, { op: event.target.value as RuleOp })}
                >
                  {RULE_OPS.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </select>
                {rule.op !== "empty" && rule.op !== "not_empty" ? (
                  <input
                    aria-label="Value"
                    dir="auto"
                    value={rule.value ?? ""}
                    className="w-28 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-primary"
                    onChange={(event) => update(index, { value: event.target.value })}
                  />
                ) : null}
                {rule.op === "between" ? (
                  <>
                    <span className="text-muted">and</span>
                    <input
                      aria-label="Second value"
                      value={rule.value2 ?? ""}
                      className="w-24 rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-primary"
                      onChange={(event) => update(index, { value2: event.target.value })}
                    />
                  </>
                ) : null}
                <button
                  type="button"
                  aria-label="Remove rule"
                  className="ms-auto cursor-pointer rounded p-1 text-muted hover:bg-row hover:text-danger"
                  onClick={() => setRules((current) => current.filter((_, at) => at !== index))}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="me-1 text-muted">Fill</span>
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Fill ${color}`}
                    aria-pressed={rule.color === color}
                    className={`size-6 cursor-pointer rounded-md border border-black/10 ${rule.color === color ? "ring-2 ring-primary ring-offset-1 ring-offset-surface" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => update(index, { color })}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
        {rules.length < 10 ? (
          <button
            type="button"
            className="mt-3 inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-primary/10"
            onClick={() => setRules((current) => [...current, { op: "eq", value: "", color: COLORS[current.length % COLORS.length]! }])}
          >
            <Plus className="size-4" aria-hidden="true" /> Add rule
          </button>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="cursor-pointer rounded-md px-3 py-1.5 hover:bg-row" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary/90" onClick={() => onSave(rules)}>
            Save rules
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

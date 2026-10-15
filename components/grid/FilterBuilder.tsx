"use client";

import type { ColumnType } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import { OPERATOR_LABEL, operatorsFor, type FilterOperator, type FilterRule } from "@/lib/sheets/view";
import type { DirectoryUser } from "./types";

export function FilterBuilder({
  columns,
  users,
  filters,
  onChange,
  onClose,
}: {
  columns: Array<{ id: string; name: string; type: ColumnType; settings: Record<string, JsonValue> }>;
  users: DirectoryUser[];
  filters: FilterRule[];
  onChange: (filters: FilterRule[]) => void;
  onClose: () => void;
}) {
  function update(id: string, patch: Partial<FilterRule>): void {
    onChange(filters.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  return (
    <div
      role="dialog"
      aria-label="Filters"
      className="absolute start-0 top-full z-40 mt-1 w-[28rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-3 text-sm shadow-lg"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex max-h-80 flex-col gap-2 overflow-auto">
        {filters.length === 0 ? <p className="text-muted">No filters yet. Rules are combined with and.</p> : null}
        {filters.map((rule) => {
          const column = columns.find((item) => item.id === rule.columnId) ?? columns[0];
          if (!column) {
            return null;
          }
          const operators = operatorsFor(column.type);
          return (
            <div key={rule.id} className="flex flex-wrap items-center gap-1">
              <select
                aria-label="Filter column"
                value={column.id}
                className="h-8 rounded border border-border bg-surface px-2 outline-none"
                onChange={(event) => {
                  const next = columns.find((item) => item.id === event.target.value);
                  if (!next) {
                    return;
                  }
                  update(rule.id, {
                    columnId: next.id,
                    operator: operatorsFor(next.type)[0] ?? "contains",
                    value: "",
                    values: [],
                    from: "",
                    to: "",
                  });
                }}
              >
                {columns.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter operator"
                value={rule.operator}
                className="h-8 rounded border border-border bg-surface px-2 outline-none"
                onChange={(event) => update(rule.id, { operator: event.target.value as FilterOperator })}
              >
                {operators.map((operator) => (
                  <option key={operator} value={operator}>
                    {OPERATOR_LABEL[operator]}
                  </option>
                ))}
              </select>
              <RuleValue rule={rule} column={column} users={users} onChange={(patch) => update(rule.id, patch)} />
              <button
                type="button"
                aria-label="Remove filter"
                className="cursor-pointer rounded-lg px-2 py-1 text-danger"
                onClick={() => onChange(filters.filter((item) => item.id !== rule.id))}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="Add filter"
        className="mt-2 cursor-pointer rounded-lg px-2 py-1 text-primary"
        onClick={() => {
          const column = columns[0];
          if (!column) {
            return;
          }
          onChange([
            ...filters,
            {
              id: crypto.randomUUID(),
              columnId: column.id,
              operator: operatorsFor(column.type)[0] ?? "contains",
            },
          ]);
        }}
      >
        Add filter
      </button>
    </div>
  );
}

function RuleValue({
  rule,
  column,
  users,
  onChange,
}: {
  rule: FilterRule;
  column: { type: ColumnType; settings: Record<string, JsonValue> };
  users: DirectoryUser[];
  onChange: (patch: Partial<FilterRule>) => void;
}) {
  if (
    rule.operator === "is_empty" ||
    rule.operator === "is_not_empty" ||
    rule.operator === "is_today" ||
    rule.operator === "is_yesterday" ||
    rule.operator === "is_this_week" ||
    rule.operator === "is_last_7_days" ||
    rule.operator === "is_this_month" ||
    rule.operator === "is_checked" ||
    rule.operator === "is_unchecked"
  ) {
    return null;
  }

  if (rule.operator === "is_any_of" || rule.operator === "is_none_of") {
    const options = readOptions(column.settings);
    return (
      <div className="flex max-w-full flex-wrap gap-1">
        {options.map((option) => {
          const selected = rule.values?.includes(option.id) ?? false;
          return (
            <button
              key={option.id}
              type="button"
              aria-label={option.label}
              aria-pressed={selected}
              className={`cursor-pointer rounded-lg px-2 py-1 ${selected ? "bg-primary text-white" : "bg-row"}`}
              onClick={() => {
                const values = new Set(rule.values ?? []);
                if (selected) {
                  values.delete(option.id);
                } else {
                  values.add(option.id);
                }
                onChange({ values: [...values] });
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (rule.operator === "includes_any") {
    const choices = [{ id: "me", label: "Me" }, ...users.map((user) => ({ id: user.id, label: user.fullName }))];
    return (
      <div className="flex max-w-full flex-wrap gap-1">
        {choices.map((choice) => {
          const selected = rule.values?.includes(choice.id) ?? false;
          return (
            <button
              key={choice.id}
              type="button"
              aria-label={choice.label}
              aria-pressed={selected}
              className={`cursor-pointer rounded-lg px-2 py-1 ${selected ? "bg-primary text-white" : "bg-row"}`}
              onClick={() => {
                const values = new Set(rule.values ?? []);
                if (selected) {
                  values.delete(choice.id);
                } else {
                  values.add(choice.id);
                }
                onChange({ values: [...values] });
              }}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (rule.operator === "between") {
    const date = column.type === "date";
    return (
      <span className="flex items-center gap-1">
        <input
          aria-label="From"
          type={date ? "date" : "number"}
          value={rule.from ?? ""}
          className="h-8 w-28 rounded border border-border px-2 outline-none"
          onChange={(event) => onChange({ from: event.target.value })}
        />
        <input
          aria-label="To"
          type={date ? "date" : "number"}
          value={rule.to ?? ""}
          className="h-8 w-28 rounded border border-border px-2 outline-none"
          onChange={(event) => onChange({ to: event.target.value })}
        />
      </span>
    );
  }

  return (
    <input
      aria-label="Filter value"
      value={rule.value ?? ""}
      className="h-8 min-w-24 flex-1 rounded border border-border px-2 outline-none"
      onChange={(event) => onChange({ value: event.target.value })}
    />
  );
}

function readOptions(settings: Record<string, JsonValue>): Array<{ id: string; label: string }> {
  const options = settings.options;
  if (!Array.isArray(options)) {
    return [];
  }
  return options.flatMap((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      return [];
    }
    const id = option.id;
    const label = option.label;
    if (typeof id !== "string" || typeof label !== "string") {
      return [];
    }
    return [{ id, label }];
  });
}

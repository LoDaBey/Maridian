/** Conditional formatting (client-safe): which colour, if any, a cell gets from its column's rules. */
import type { JsonValue } from "./ops";
import { displayValue, RULE_OPS, type FormatRule } from "./values";

type RuleColumn = Parameters<typeof displayValue>[0];

export function readRules(settings: Record<string, JsonValue> | undefined): FormatRule[] {
  const raw = settings?.rules;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const op = String(item.op);
    const color = typeof item.color === "string" ? item.color : "";
    if (!(RULE_OPS as readonly string[]).includes(op) || !color) {
      return [];
    }
    return [
      {
        op: op as FormatRule["op"],
        color,
        value: typeof item.value === "string" ? item.value : undefined,
        value2: typeof item.value2 === "string" ? item.value2 : undefined,
      },
    ];
  });
}

function asNumber(text: string): number | null {
  const number = Number(text.replace(/[, ]/g, ""));
  return text.trim() !== "" && Number.isFinite(number) ? number : null;
}

export function ruleMatches(rule: FormatRule, text: string, raw: JsonValue | undefined): boolean {
  const value = text.trim().toLowerCase();
  const target = (rule.value ?? "").trim().toLowerCase();
  const numeric = typeof raw === "number" ? raw : asNumber(text);
  switch (rule.op) {
    case "empty":
      return value === "";
    case "not_empty":
      return value !== "";
    case "eq":
      return value === target || (numeric !== null && asNumber(target) === numeric);
    case "neq":
      return value !== target;
    case "contains":
      return target !== "" && value.includes(target);
    case "not_contains":
      return target !== "" && !value.includes(target);
    case "gt": {
      const limit = asNumber(target);
      return numeric !== null && limit !== null ? numeric > limit : target !== "" && value > target;
    }
    case "lt": {
      const limit = asNumber(target);
      return numeric !== null && limit !== null ? numeric < limit : target !== "" && value !== "" && value < target;
    }
    case "between": {
      const low = asNumber(rule.value ?? "");
      const high = asNumber(rule.value2 ?? "");
      return numeric !== null && low !== null && high !== null && numeric >= Math.min(low, high) && numeric <= Math.max(low, high);
    }
    default:
      return false;
  }
}

/** The colour of the first rule this value matches. */
export function ruleColor(
  rules: FormatRule[],
  column: RuleColumn,
  value: JsonValue | undefined,
  usersById: ReadonlyMap<string, string>,
): string | undefined {
  if (rules.length === 0) {
    return undefined;
  }
  const text = displayValue(column, value, usersById);
  return rules.find((rule) => ruleMatches(rule, text, value))?.color;
}

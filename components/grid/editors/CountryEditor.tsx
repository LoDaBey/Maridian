"use client";

import { useMemo, useState } from "react";
import type { JsonValue } from "@/lib/sheets/ops";
import type { LocalColumn } from "@/lib/sheets/apply-local";
import { COUNTRIES, countryName } from "@/lib/sheets/countries";
import { ActionButton } from "../ActionButton";
import { CountryFlag } from "../CountryFlag";

export function CountryEditor({
  column,
  value,
  onCommit,
  onCancel,
}: {
  column: LocalColumn;
  value: JsonValue | undefined;
  onCommit: (value: JsonValue | null, move: "down" | "next" | "none") => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const current = typeof value === "string" ? value : "";
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return COUNTRIES;
    }
    return COUNTRIES.filter(
      (country) =>
        country.code.toLowerCase().includes(needle) ||
        country.name.toLowerCase().includes(needle) ||
        (country.nameAr?.includes(query.trim()) ?? false),
    );
  }, [query]);

  return (
    <div
      className="absolute start-0 top-full z-30 max-h-64 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        autoFocus
        value={query}
        aria-label={`Search countries for ${column.name}`}
        placeholder="Search country"
        className="w-full rounded-none border-b border-border px-2 py-1.5 text-[13px] outline-none"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="max-h-48 overflow-auto p-1">
        {visible.map((country) => (
          <ActionButton
            key={country.code}
            aria-label={`Choose ${country.name}`}
            className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-start text-[13px] ${current === country.code ? "bg-primary/10" : ""}`}
            onClick={() => onCommit(country.code, "none")}
          >
            <CountryFlag code={country.code} />
            {countryName(country, true)}
          </ActionButton>
        ))}
      </div>
      <ActionButton
        aria-label="Clear country"
        className="w-full cursor-pointer rounded-lg border-t border-border px-2 py-1.5 text-start text-[13px] text-muted"
        onClick={() => onCommit(null, "none")}
      >
        Clear
      </ActionButton>
    </div>
  );
}

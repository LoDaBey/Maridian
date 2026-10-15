"use client";

import type { ComponentType, SVGProps } from "react";
import * as Flags from "country-flag-icons/react/3x2";
import { hasFlag } from "country-flag-icons";

const flags = Flags as Record<string, ComponentType<SVGProps<SVGSVGElement>>>;

export function CountryFlag({ code }: { code: string }) {
  const upper = code.toUpperCase();
  const Flag = hasFlag(upper) ? flags[upper] : undefined;
  if (!Flag) {
    return null;
  }
  return (
    <span className="inline-flex h-3.5 w-5 shrink-0 overflow-hidden rounded-sm" aria-hidden="true">
      <Flag className="h-full w-full" />
    </span>
  );
}

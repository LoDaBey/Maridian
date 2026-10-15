"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SheetViewer } from "./types";

const MeContext = createContext<SheetViewer | null>(null);

export function MeProvider({ me, children }: { me: SheetViewer; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): SheetViewer {
  const me = useContext(MeContext);
  if (!me) {
    throw new Error("useMe must be used inside MeProvider.");
  }
  return me;
}

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { can, type Action } from "@/lib/rbac";
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

/** Actions a sheet viewer may still use: reading, exporting and history. */
const VIEWER_ACTIONS = new Set<Action>(["sheet.view", "sheet.view_all", "history.view", "csv.export"]);

/** What an "assigned only" member may do; the server checks the rows are theirs. */
const ASSIGNED_ACTIONS = new Set<Action>([...VIEWER_ACTIONS, "cell.edit", "row.insert", "row.delete.own", "row.delete.any"]);

/** Role check that also honours a view-only or assigned-only share on this sheet. */
export function canDo(me: SheetViewer, action: Action): boolean {
  if (me.viewOnly && !VIEWER_ACTIONS.has(action)) {
    return false;
  }
  if (me.assignedOnly && !ASSIGNED_ACTIONS.has(action)) {
    return false;
  }
  return can(me.role, action);
}

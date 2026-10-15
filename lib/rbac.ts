export const ROLES = [
  "employee",
  "team_leader",
  "project_manager",
  "operations_manager",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  team_leader: "Team Leader",
  project_manager: "Project Manager",
  operations_manager: "Operations Manager",
  admin: "Admin",
};

export const roleRank = (role: Role) => ROLES.indexOf(role);

export type Action =
  | "sheet.view"
  | "sheet.view_all"
  | "sheet.share"
  | "cell.edit"
  | "row.insert"
  | "row.delete.own"
  | "row.delete.any"
  | "row.move"
  | "sheet.create"
  | "sheet.rename"
  | "sheet.duplicate"
  | "sheet.reorder"
  | "sheet.direction"
  | "column.manage"
  | "column.delete"
  | "column.resize"
  | "sheet.archive"
  | "sheet.restore"
  | "history.view"
  | "csv.export"
  | "csv.import"
  | "user.manage"
  | "sheet.purge"
  | "template.delete";

/** Lowest role allowed to perform the action. Every higher role is allowed too. */
export const MIN_ROLE: Record<Action, Role> = {
  "sheet.view": "employee",
  "sheet.view_all": "operations_manager",
  "sheet.share": "team_leader",
  "cell.edit": "employee",
  "row.insert": "employee",
  "row.delete.own": "employee",
  "csv.export": "employee",
  "row.delete.any": "employee",
  "row.move": "team_leader",
  "column.resize": "team_leader",
  "history.view": "team_leader",
  "sheet.create": "employee",
  "sheet.rename": "project_manager",
  "sheet.duplicate": "employee",
  "sheet.reorder": "project_manager",
  "sheet.direction": "project_manager",
  "column.manage": "employee",
  "column.delete": "employee",
  "csv.import": "project_manager",
  "sheet.archive": "employee",
  "sheet.restore": "employee",
  "user.manage": "admin",
  "sheet.purge": "admin",
  "template.delete": "admin",
};

export function canShareWorkbook(
  user: { id: string; role: Role },
  workbook: { createdBy: string | null },
): boolean {
  if (workbook.createdBy === user.id) {
    return true;
  }
  return can(user.role, "sheet.share");
}

export function can(role: Role, action: Action): boolean {
  return roleRank(role) >= roleRank(MIN_ROLE[action]);
}

export function canDeleteRow(
  user: { id: string; role: Role },
  row: { created_by: string | null },
): boolean {
  return (
    can(user.role, "row.delete.any") ||
    (can(user.role, "row.delete.own") && row.created_by === user.id)
  );
}

export function canDeleteWorkbook(
  user: { id: string; role: Role },
  workbook: { createdBy: string | null },
): boolean {
  return workbook.createdBy === user.id || can(user.role, "sheet.purge");
}

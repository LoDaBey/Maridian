/** Template names and descriptions (client-safe; the builder lives in templates.ts). */
export const DASHBOARD_TEMPLATES = ["operations", "team", "blank"] as const;
export type DashboardTemplate = (typeof DASHBOARD_TEMPLATES)[number];

export const TEMPLATE_INFO: Record<DashboardTemplate, { name: string; description: string }> = {
  operations: {
    name: "Operations overview",
    description: "Monthly output, status, daily heatmap, top editors, report mix, countries and stuck items",
  },
  team: {
    name: "Team performance",
    description: "Leaderboard, weekly workload per person, who works on what, and trends per person",
  },
  blank: { name: "Blank dashboard", description: "Start empty and add your own widgets" },
};

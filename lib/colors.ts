export const PRESENCE_COLORS = [
  "#0073ea",
  "#00c875",
  "#fdab3d",
  "#e2445c",
  "#a25ddc",
  "#037f4c",
  "#ff642e",
  "#66ccff",
  "#bb3354",
  "#9cd326",
  "#ff158a",
  "#784bd1",
] as const;

export type PresenceColor = (typeof PRESENCE_COLORS)[number];

export function pickUserColor(existingCount: number): PresenceColor {
  const count = PRESENCE_COLORS.length;
  const index = ((existingCount % count) + count) % count;
  return PRESENCE_COLORS[index] ?? PRESENCE_COLORS[0];
}

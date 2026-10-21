export function WorkspaceBadge({
  name,
  color,
  size = "md",
}: {
  name: string;
  color: string;
  size?: "sm" | "md" | "lg";
}) {
  const box = size === "sm" ? "size-6 text-xs" : size === "lg" ? "size-12 text-xl" : "size-8 text-sm";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white ${box}`}
      style={{ backgroundColor: color }}
    >
      {(name.trim()[0] ?? "W").toUpperCase()}
    </span>
  );
}

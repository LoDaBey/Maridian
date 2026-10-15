import { usePresenceAt } from "@/stores/presence-store";

export function CellPresenceOverlay({
  rowId,
  columnId,
  editing,
}: {
  rowId: string;
  columnId: string;
  editing: boolean;
}) {
  const presence = usePresenceAt(rowId, columnId);
  if (presence.tags.length === 0 && presence.fills.length === 0 && !(editing && presence.editingName)) {
    return null;
  }

  const border = presence.tags[0]?.color;

  return (
    <>
      {presence.fills.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: tint(color) }}
        />
      ))}
      {border ? (
        <span
          className="pointer-events-none absolute inset-0 border-2"
          style={{ borderColor: border }}
        />
      ) : null}
      {presence.tags.map((tag, index) => (
        <span
          key={tag.socketId}
          data-presence-name={tag.name}
          data-presence-editing={tag.editing ? "true" : "false"}
          className={`pointer-events-none absolute start-0 z-10 max-w-40 truncate rounded-sm px-1 text-[10px] leading-4 text-white ${tag.editing ? "animate-pulse" : ""}`}
          style={{ backgroundColor: tag.color, bottom: `calc(100% + ${index * 16}px)` }}
        >
          {tag.editing ? `${tag.name} · typing…` : tag.name}
        </span>
      ))}
      {editing && presence.editingName ? (
        <span className="pointer-events-none absolute start-0 top-full z-10 whitespace-nowrap text-[10px] text-danger">
          {presence.editingName} is editing this cell
        </span>
      ) : null}
    </>
  );
}

function tint(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}14` : color;
}

export function NewSheetNameStep({
  name,
  onChange,
}: {
  name: string;
  onChange: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 id="new-sheet-title" className="text-xl font-semibold tracking-tight">
        Name your sheet
      </h2>
      <p id="new-sheet-step" className="text-sm text-muted">
        Pick a name your team will recognize. You can rename it later.
      </p>
      <label htmlFor="new-sheet-name" className="mt-4 text-sm font-medium">
        Sheet name
      </label>
      <input
        id="new-sheet-name"
        value={name}
        maxLength={100}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-border px-3 py-3 text-base outline-none focus:border-primary"
      />
    </div>
  );
}

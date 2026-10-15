"use client";

export function UserSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="user-search" className="text-sm font-medium">
        Search
      </label>
      <input
        id="user-search"
        type="search"
        value={value}
        placeholder="Search by name or email"
        onChange={(event) => onChange(event.target.value)}
        className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 outline-none"
      />
    </div>
  );
}

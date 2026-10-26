"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { ROLE_LABEL, type Role } from "@/lib/rbac";
import type { TeamView } from "@/lib/teams/repo";
import { WORKSPACE_COLORS } from "@/lib/workspaces/colors";
import { deleteTeamAction, saveTeamAction } from "../actions";

interface Person {
  id: string;
  fullName: string;
  email: string;
  avatarColor: string;
  role: Role;
}

function Avatar({ person }: { person: Person }) {
  return (
    <span
      aria-hidden="true"
      title={person.fullName}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-surface"
      style={{ backgroundColor: person.avatarColor }}
    >
      {(person.fullName[0] ?? "?").toUpperCase()}
    </span>
  );
}

type Draft = { teamId?: string; name: string; color: (typeof WORKSPACE_COLORS)[number]; leaderId: string | null; memberIds: string[] };

export function TeamsAdmin({ teams, people }: { teams: TeamView[]; people: Person[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const shown = people.filter((person) => `${person.fullName} ${person.email}`.toLowerCase().includes(search.trim().toLowerCase()));

  async function save() {
    if (!draft) {
      return;
    }
    setBusy(true);
    const result = await saveTeamAction(draft);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function remove(team: TeamView) {
    if (!window.confirm(`Delete the team “${team.name}”? People stay; only the team goes.`)) {
      return;
    }
    await deleteTeamAction(team.id);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="text-sm text-muted">
            Team leaders can edit their team&apos;s items on sheets shared as &ldquo;Edits assigned items&rdquo;, and &ldquo;My team&rdquo; filters use these teams.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white hover:bg-primary/90"
          onClick={() => {
            setError("");
            setDraft({ name: "", color: WORKSPACE_COLORS[0], leaderId: null, memberIds: [] });
          }}
        >
          <Plus className="size-4" aria-hidden="true" /> New team
        </button>
      </div>

      {teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
          <Users className="mx-auto mb-2 size-8 text-muted" aria-hidden="true" />
          <p className="font-medium">No teams yet</p>
          <p className="mt-1 text-sm text-muted">Group people under a leader, e.g. &ldquo;Monitoring team&rdquo; or &ldquo;Design team&rdquo;.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {teams.map((team) => {
            const leader = team.leaderId ? byId.get(team.leaderId) : undefined;
            const members = team.memberIds.map((id) => byId.get(id)).filter((person): person is Person => Boolean(person));
            return (
              <li key={team.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
                  <div className="min-w-0 flex-1">
                    <h2 dir="auto" className="truncate font-semibold">{team.name}</h2>
                    <p className="text-xs text-muted">
                      {leader ? `Led by ${leader.fullName}` : "No leader"} · {members.length} member{members.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Edit ${team.name}`}
                    className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-row hover:text-text"
                    onClick={() => {
                      setError("");
                      setDraft({
                        teamId: team.id,
                        name: team.name,
                        color: (WORKSPACE_COLORS as readonly string[]).includes(team.color) ? (team.color as Draft["color"]) : WORKSPACE_COLORS[0],
                        leaderId: team.leaderId,
                        memberIds: team.memberIds,
                      });
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${team.name}`}
                    className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                    onClick={() => void remove(team)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-3 flex -space-x-1.5">
                  {members.slice(0, 12).map((person) => (
                    <Avatar key={person.id} person={person} />
                  ))}
                  {members.length > 12 ? <span className="ps-3 text-xs text-muted">+{members.length - 12}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDraft(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={draft.teamId ? "Edit team" : "New team"}
            className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-surface p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{draft.teamId ? "Edit team" : "New team"}</h2>
              <button type="button" aria-label="Close" className="cursor-pointer rounded-md p-1.5 hover:bg-row" onClick={() => setDraft(null)}>
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="team-name">
              Name
            </label>
            <input
              id="team-name"
              autoFocus
              dir="auto"
              value={draft.name}
              className="mb-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <p className="mb-1 text-xs font-medium text-muted">Colour</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {WORKSPACE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Colour ${color}`}
                  aria-pressed={draft.color === color}
                  className={`size-6 cursor-pointer rounded-full ${draft.color === color ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : ""}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setDraft({ ...draft, color })}
                />
              ))}
            </div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="team-leader">
              Team leader
            </label>
            <select
              id="team-leader"
              value={draft.leaderId ?? ""}
              className="mb-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              onChange={(event) => {
                const leaderId = event.target.value || null;
                setDraft({
                  ...draft,
                  leaderId,
                  memberIds: leaderId && !draft.memberIds.includes(leaderId) ? [...draft.memberIds, leaderId] : draft.memberIds,
                });
              }}
            >
              <option value="">No leader</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName} ({ROLE_LABEL[person.role]})
                </option>
              ))}
            </select>
            <p className="mb-1 text-xs font-medium text-muted">Members ({draft.memberIds.length})</p>
            <input
              value={search}
              placeholder="Search people"
              aria-label="Search people"
              className="mb-1 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
              onChange={(event) => setSearch(event.target.value)}
            />
            <ul className="mb-4 min-h-0 flex-1 overflow-auto rounded-md border border-border p-1">
              {shown.map((person) => {
                const on = draft.memberIds.includes(person.id);
                return (
                  <li key={person.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-row">
                      <input
                        type="checkbox"
                        checked={on}
                        aria-label={person.fullName}
                        className="size-4 accent-primary"
                        onChange={() =>
                          setDraft({ ...draft, memberIds: on ? draft.memberIds.filter((id) => id !== person.id) : [...draft.memberIds, person.id] })
                        }
                      />
                      <Avatar person={person} />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block truncate">{person.fullName}</span>
                        <span className="block truncate text-xs text-muted">{person.email}</span>
                      </span>
                      <span className="text-xs text-muted">{ROLE_LABEL[person.role]}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-end gap-2">
              {error ? (
                <p role="alert" className="me-auto text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <button type="button" className="cursor-pointer rounded-md px-3 py-1.5 text-sm hover:bg-row" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !draft.name.trim()}
                className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save team"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

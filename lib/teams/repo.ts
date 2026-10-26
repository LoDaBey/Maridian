import { query, tx } from "@/lib/db";

/**
 * Everyone in the viewer's teams (as leader or member), including the viewer.
 * Used by "My team" filters on dashboards and sheets.
 */
export async function teamIdsFor(userId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `WITH mine AS (
       SELECT t.id FROM monitor_teams t WHERE t.leader_id = $1
       UNION
       SELECT tm.team_id FROM monitor_team_members tm WHERE tm.user_id = $1
     )
     SELECT DISTINCT u.id::text AS id
     FROM mine
     JOIN monitor_teams t ON t.id = mine.id
     JOIN LATERAL (
       SELECT t.leader_id AS id
       UNION SELECT tm.user_id FROM monitor_team_members tm WHERE tm.team_id = t.id
     ) u ON u.id IS NOT NULL`,
    [userId],
  );
  const ids = new Set(rows.map((row) => row.id));
  ids.add(userId);
  return [...ids];
}

export interface TeamView {
  id: string;
  name: string;
  color: string;
  leaderId: string | null;
  memberIds: string[];
}

export async function listTeams(): Promise<TeamView[]> {
  const rows = await query<{ id: string; name: string; color: string; leader_id: string | null; member_ids: string[] | null }>(
    `SELECT t.id, t.name, t.color, t.leader_id,
            (SELECT array_agg(tm.user_id::text ORDER BY tm.created_at) FROM monitor_team_members tm WHERE tm.team_id = t.id) AS member_ids
     FROM monitor_teams t
     ORDER BY lower(t.name), t.created_at`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, color: row.color, leaderId: row.leader_id, memberIds: row.member_ids ?? [] }));
}

/** Creates or updates a team and replaces its member list. */
export async function saveTeam(input: {
  teamId?: string;
  actorId: string;
  name: string;
  color: string;
  leaderId: string | null;
  memberIds: string[];
}): Promise<string> {
  return tx(async (client) => {
    const saved = input.teamId
      ? await client.query<{ id: string }>(
          `UPDATE monitor_teams SET name = $2, color = $3, leader_id = $4 WHERE id = $1 RETURNING id`,
          [input.teamId, input.name, input.color, input.leaderId],
        )
      : await client.query<{ id: string }>(
          `INSERT INTO monitor_teams (name, color, leader_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
          [input.name, input.color, input.leaderId, input.actorId],
        );
    const id = saved.rows[0]?.id;
    if (!id) {
      throw new Error("Team not found.");
    }
    await client.query(`DELETE FROM monitor_team_members WHERE team_id = $1 AND NOT (user_id = ANY($2::uuid[]))`, [id, input.memberIds]);
    await client.query(
      `INSERT INTO monitor_team_members (team_id, user_id)
       SELECT $1, u.id FROM monitor_users u WHERE u.id = ANY($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [id, input.memberIds],
    );
    return id;
  });
}

export async function deleteTeam(teamId: string): Promise<void> {
  await query(`DELETE FROM monitor_teams WHERE id = $1`, [teamId]);
}

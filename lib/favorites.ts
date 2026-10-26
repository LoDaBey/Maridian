import { query } from "@/lib/db";

/** Sheets (workbooks) this person starred, newest first. */
export async function listFavoriteIds(userId: string): Promise<string[]> {
  const rows = await query<{ workbook_id: string }>(
    `SELECT workbook_id FROM monitor_favorites WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((row) => row.workbook_id);
}

export async function setFavorite(userId: string, workbookId: string, on: boolean): Promise<void> {
  if (on) {
    await query(
      `INSERT INTO monitor_favorites (user_id, workbook_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, workbookId],
    );
  } else {
    await query(`DELETE FROM monitor_favorites WHERE user_id = $1 AND workbook_id = $2`, [userId, workbookId]);
  }
}

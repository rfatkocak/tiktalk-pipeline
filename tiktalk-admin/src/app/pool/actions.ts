"use server";

import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function createPoolItem(data: {
  channel_id: string;
  level: string;
  notes: string;
  seedance_prompt: string;
  vibe_ids: string[];
  tp_ids: string[];
}) {
  const res = await query(
    `INSERT INTO pool_items (channel_id, level, notes, seedance_prompt)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      data.channel_id || null,
      data.level,
      data.notes || null,
      data.seedance_prompt || null,
    ]
  );

  const poolItemId = res.rows[0].id;

  for (const vibeId of data.vibe_ids) {
    await query(
      "INSERT INTO pool_item_vibes (pool_item_id, vibe_id) VALUES ($1, $2)",
      [poolItemId, vibeId]
    );
  }

  for (const tpId of data.tp_ids) {
    await query(
      "INSERT INTO pool_item_teaching_points (pool_item_id, teaching_point_id) VALUES ($1, $2)",
      [poolItemId, tpId]
    );
  }

  revalidatePath("/pool");
}

export async function deletePoolItem(id: string) {
  await query("DELETE FROM pool_items WHERE id = $1", [id]);
  revalidatePath("/pool");
}

// New schema: lessons.published_at NULL → hidden, NOT NULL → on feed.
// "archived" = soft delete (deleted_at set). Re-publishing also clears
// deleted_at so previously-archived lessons can come back.
export async function toggleLessonStatus(
  lessonId: string,
  newStatus: "published" | "archived"
) {
  if (newStatus === "published") {
    await query(
      `UPDATE lessons
         SET published_at = now(), deleted_at = NULL, updated_at = now()
       WHERE id = $1`,
      [lessonId]
    );
  } else {
    await query(
      `UPDATE lessons SET deleted_at = now(), updated_at = now() WHERE id = $1`,
      [lessonId]
    );
  }
  revalidatePath("/pool");
}

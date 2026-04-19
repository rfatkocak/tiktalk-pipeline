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
      "INSERT INTO pool_item_tps (pool_item_id, teaching_point_id) VALUES ($1, $2)",
      [poolItemId, tpId]
    );
  }

  revalidatePath("/pool");
}

export async function deletePoolItem(id: string) {
  await query("DELETE FROM pool_items WHERE id = $1", [id]);
  revalidatePath("/pool");
}

export async function toggleVideoStatus(videoId: string, newStatus: "published" | "archived") {
  await query(
    `UPDATE videos SET status = $1, published_at = $2 WHERE id = $3`,
    [newStatus, newStatus === "published" ? new Date().toISOString() : null, videoId]
  );
  revalidatePath("/pool");
}

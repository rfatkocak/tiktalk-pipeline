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

// Bulk import: paste JSON, each item auto-runs /api/generate (LLM picks
// TPs + writes seedance_prompt) and lands in the pool ready for
// "Start Seedance". User doesn't click Save per item.
//
// Accepted JSON shapes:
//   [ { "channel": "dailyenglish", "level": "beginner",
//       "vibes": ["cozy","realistic"], "notes": "..." }, ... ]
//   { "items": [ ... ] }
//   { "channel": "dailyenglish", "items": [ {"level": ..., "vibes": [...]} ] }
//     → channel applies when item omits one
export type PoolImportResult = {
  created: number;
  failed: number;
  errors: string[];
};

type PoolImportItem = {
  channel?: string;
  level?: string;
  vibes?: string[];
  notes?: string;
};

const VALID_LEVELS = new Set(["beginner", "intermediate", "advanced"]);

export async function importPoolItems(
  jsonText: string,
  baseUrl: string,
): Promise<PoolImportResult> {
  const result: PoolImportResult = { created: 0, failed: 0, errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    result.errors.push("JSON parse: " + (err as Error).message);
    return result;
  }

  // Normalize into flat array.
  const items: (PoolImportItem & { _channel?: string })[] = [];
  const pushFrom = (arr: unknown, inheritedChannel?: string) => {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      if (raw && typeof raw === "object") {
        items.push({ ...(raw as PoolImportItem), _channel: inheritedChannel });
      }
    }
  };
  if (Array.isArray(parsed)) {
    pushFrom(parsed);
  } else if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    const topCh = typeof p.channel === "string" ? p.channel : undefined;
    if (Array.isArray(p.items)) pushFrom(p.items, topCh);
  }
  if (items.length === 0) {
    result.errors.push("No items found in JSON (expected an array or {items:[...]})");
    return result;
  }

  // Pre-load channels + vibes + TP catalog + TP usage counts once. Avoids
  // per-item round trips.
  const [channels, vibes, tps, tpUsage] = await Promise.all([
    query(`SELECT id, name, handle, description FROM channels WHERE deleted_at IS NULL`),
    query(`SELECT id, slug, name, prompt_hint FROM vibes`),
    query(
      `SELECT id, name, category, level, description FROM teaching_points
       ORDER BY category, level, subcategory, name`,
    ),
    query(
      `SELECT teaching_point_id, COUNT(*)::int AS c
       FROM pool_item_teaching_points GROUP BY teaching_point_id`,
    ),
  ]);
  const channelByHandle = new Map<string, { id: string; name: string; description: string | null }>();
  for (const r of channels.rows as { id: string; name: string; handle: string; description: string | null }[]) {
    channelByHandle.set(r.handle.replace(/^@/, "").toLowerCase(), r);
    channelByHandle.set(r.name.toLowerCase(), r); // name fallback
  }
  const vibeBySlug = new Map<string, { id: string; name: string; prompt_hint: string | null }>();
  for (const r of vibes.rows as { id: string; slug: string; name: string; prompt_hint: string | null }[]) {
    vibeBySlug.set(r.slug.toLowerCase(), r);
    vibeBySlug.set(r.name.toLowerCase(), r);
  }
  const tpUsageMap = new Map<string, number>();
  for (const r of tpUsage.rows as { teaching_point_id: string; c: number }[]) {
    tpUsageMap.set(r.teaching_point_id, r.c);
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const channelKey = (it.channel || it._channel || "").replace(/^@/, "").toLowerCase();
      const channel = channelByHandle.get(channelKey);
      if (!channel) {
        throw new Error(`item[${i}] unknown channel "${it.channel || it._channel}"`);
      }

      const level = (it.level || "").toLowerCase();
      if (!VALID_LEVELS.has(level)) {
        throw new Error(`item[${i}] invalid level "${it.level}" (expected beginner|intermediate|advanced)`);
      }

      const rawVibes = Array.isArray(it.vibes) ? it.vibes : [];
      if (rawVibes.length === 0) {
        throw new Error(`item[${i}] vibes required`);
      }
      const matchedVibes: { id: string; name: string; prompt_hint: string | null }[] = [];
      for (const v of rawVibes) {
        const m = vibeBySlug.get(String(v).toLowerCase());
        if (!m) throw new Error(`item[${i}] unknown vibe "${v}"`);
        matchedVibes.push(m);
      }

      // TP candidates filtered by level + under-used.
      const levelTps = (tps.rows as { id: string; name: string; category: string; level: string; description: string | null }[])
        .filter((tp) => tp.level === level && (tpUsageMap.get(tp.id) || 0) < 5)
        .map((tp) => ({
          id: tp.id,
          name: tp.name,
          category: tp.category,
          level: tp.level,
          usage_count: tpUsageMap.get(tp.id) || 0,
        }));
      if (levelTps.length === 0) {
        throw new Error(`item[${i}] no available TPs for ${level} (all have 5+ videos)`);
      }

      // Call /api/generate — same endpoint the manual form uses.
      const genRes = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelName: channel.name,
          channelDescription: channel.description,
          level,
          vibeNames: matchedVibes.map((v) => v.name),
          vibeHints: matchedVibes.map((v) => v.prompt_hint),
          teachingPoints: levelTps,
        }),
      });
      if (!genRes.ok) {
        const body = await genRes.json().catch(() => ({}));
        throw new Error(`item[${i}] generate failed: ${body.error || genRes.status}`);
      }
      const gen = (await genRes.json()) as {
        selected_tp_ids: string[];
        seedance_prompt: string;
        reasoning: string;
      };

      const validTpSet = new Set(levelTps.map((tp) => tp.id));
      const tpIds = gen.selected_tp_ids.filter((id) => validTpSet.has(id));
      if (tpIds.length === 0) {
        throw new Error(`item[${i}] generator returned no valid TPs`);
      }

      // Insert pool_item + junctions atomically.
      const insertRes = await query(
        `INSERT INTO pool_items (channel_id, level, notes, seedance_prompt)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          channel.id,
          level,
          it.notes ? `${it.notes}\n---\n${gen.reasoning}` : gen.reasoning,
          gen.seedance_prompt,
        ],
      );
      const poolItemId = insertRes.rows[0].id as string;

      for (const vId of matchedVibes.map((v) => v.id)) {
        await query(
          "INSERT INTO pool_item_vibes (pool_item_id, vibe_id) VALUES ($1, $2)",
          [poolItemId, vId],
        );
      }
      for (const tpId of tpIds) {
        await query(
          "INSERT INTO pool_item_teaching_points (pool_item_id, teaching_point_id) VALUES ($1, $2)",
          [poolItemId, tpId],
        );
        tpUsageMap.set(tpId, (tpUsageMap.get(tpId) || 0) + 1); // keep local count fresh
      }

      result.created++;
    } catch (err) {
      result.failed++;
      result.errors.push((err as Error).message);
    }
  }

  revalidatePath("/pool");
  return result;
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

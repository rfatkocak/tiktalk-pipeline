import { query } from "@/lib/db";
import { PoolManager } from "./pool-manager";

export const dynamic = "force-dynamic";

export default async function PoolPage() {
  const channels = await query("SELECT id, name, slug, description FROM channels ORDER BY name");
  const vibes = await query("SELECT id, name, slug, prompt_hint FROM vibes ORDER BY name");
  const tps = await query(
    "SELECT id, name, category, level, subcategory FROM teaching_points ORDER BY category, level, subcategory, name"
  );

  // TP usage counts: how many pool items each TP is used in
  const tpUsage = await query(`
    SELECT teaching_point_id, COUNT(*) as usage_count
    FROM pool_item_tps
    GROUP BY teaching_point_id
  `);
  const usageMap: Record<string, number> = {};
  for (const row of tpUsage.rows as { teaching_point_id: string; usage_count: string }[]) {
    usageMap[row.teaching_point_id] = parseInt(row.usage_count);
  }

  let poolItems: { rows: unknown[] } = { rows: [] };
  try {
    poolItems = await query(`
      SELECT pi.*, c.name as channel_name, v.status as video_status,
        (SELECT json_agg(json_build_object('id', v.id, 'name', v.name))
         FROM pool_item_vibes piv JOIN vibes v ON v.id = piv.vibe_id WHERE piv.pool_item_id = pi.id) as vibes,
        (SELECT json_agg(json_build_object('id', tp.id, 'name', tp.name, 'category', tp.category, 'level', tp.level))
         FROM pool_item_tps pit JOIN teaching_points tp ON tp.id = pit.teaching_point_id WHERE pit.pool_item_id = pi.id) as tps
      FROM pool_items pi
      LEFT JOIN channels c ON c.id = pi.channel_id
      LEFT JOIN videos v ON v.id = pi.video_id
      ORDER BY pi.created_at DESC
    `);
  } catch {
    // Table might not exist yet
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Pool</h2>
      <PoolManager
        channels={channels.rows}
        vibes={vibes.rows}
        teachingPoints={tps.rows}
        tpUsageMap={usageMap}
        poolItems={poolItems.rows}
      />
    </div>
  );
}

import { query } from "@/lib/db";
import { TPExplorer, TP } from "./tp-explorer";

export const dynamic = "force-dynamic";

export default async function TeachingPointsPage() {
  const tpRes = await query(`
    SELECT tp.id, tp.category, tp.subcategory, tp.name, tp.level, tp.description,
      tp.created_at,
      COALESCE((SELECT COUNT(*) FROM pool_item_teaching_points pit WHERE pit.teaching_point_id = tp.id), 0)::int AS usage_count
    FROM teaching_points tp
    ORDER BY tp.category, tp.subcategory NULLS FIRST, tp.level, tp.name
  `);

  const tps = tpRes.rows.map((r: Record<string, unknown>) => ({
    ...r,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  })) as TP[];

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Teaching Points</h2>
      <TPExplorer tps={tps} />
    </div>
  );
}

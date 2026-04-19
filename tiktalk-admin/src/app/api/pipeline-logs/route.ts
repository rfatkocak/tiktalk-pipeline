import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolItemId = searchParams.get("poolItemId");
  const level = searchParams.get("level"); // info|warn|error
  const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 1000);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (poolItemId) {
    conditions.push(`pool_item_id = $${i++}`);
    params.push(poolItemId);
  }
  if (level && ["info", "warn", "error"].includes(level)) {
    conditions.push(`level = $${i++}`);
    params.push(level);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  try {
    const { rows } = await query(
      `SELECT id, pool_item_id, phase, level, message, metadata, created_at
       FROM pipeline_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${i}`,
      params
    );
    return NextResponse.json({ logs: rows });
  } catch (err) {
    // Table might not exist yet (first run)
    if ((err as Error).message.includes("does not exist")) {
      return NextResponse.json({ logs: [] });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolItemId = searchParams.get("poolItemId");

  if (poolItemId) {
    await query("DELETE FROM pipeline_logs WHERE pool_item_id = $1", [poolItemId]);
  } else {
    // Clear logs older than 7 days
    await query("DELETE FROM pipeline_logs WHERE created_at < now() - interval '7 days'");
  }

  return NextResponse.json({ ok: true });
}

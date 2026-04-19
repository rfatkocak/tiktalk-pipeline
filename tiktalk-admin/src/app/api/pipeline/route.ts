import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const BASE_URL = "http://localhost:3000";

export async function POST(req: NextRequest) {
  const { poolItemId } = await req.json();

  if (!poolItemId) {
    return NextResponse.json({ error: "poolItemId required" }, { status: 400 });
  }

  // Get current state
  const { rows } = await query(
    "SELECT id, video_file, transcript, video_id, status FROM pool_items WHERE id = $1",
    [poolItemId]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Pool item not found" }, { status: 404 });
  }

  const item = rows[0];
  const steps: string[] = [];

  // Step 1: Whisper (if video_file exists but no transcript)
  if (item.video_file && !item.transcript) {
    const res = await fetch(`${BASE_URL}/api/whisper`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poolItemId }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: `Whisper failed: ${data.error}`, steps }, { status: 500 });
    }
    steps.push("whisper");
  }

  // Re-fetch to get updated state
  const updated1 = await query(
    "SELECT transcript, video_id, status FROM pool_items WHERE id = $1",
    [poolItemId]
  );
  const item2 = updated1.rows[0];

  // Step 2: Content generation (if transcript exists but no video_id)
  if (item2.transcript && !item2.video_id) {
    const res = await fetch(`${BASE_URL}/api/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poolItemId }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: `Content failed: ${data.error}`, steps }, { status: 500 });
    }
    if (!data.match) {
      return NextResponse.json({
        error: `Transcript mismatch (${data.score}): ${data.reason}`,
        match: false,
        steps,
      }, { status: 400 });
    }
    steps.push("content");
  }

  // Re-fetch to get video_id
  const updated2 = await query(
    "SELECT video_id FROM pool_items WHERE id = $1",
    [poolItemId]
  );
  const item3 = updated2.rows[0];

  // Step 3: CDN upload (if video_id exists)
  if (item3.video_id) {
    // Check if already uploaded
    const vid = await query("SELECT video_url FROM videos WHERE id = $1", [item3.video_id]);
    if (!vid.rows[0]?.video_url) {
      const res = await fetch(`${BASE_URL}/api/upload-cdn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolItemId }),
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: `CDN upload failed: ${data.error}`, steps }, { status: 500 });
      }
      steps.push("cdn-upload");
    }
  }

  return NextResponse.json({ success: true, steps });
}

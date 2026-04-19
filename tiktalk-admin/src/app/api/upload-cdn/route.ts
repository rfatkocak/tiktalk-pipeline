import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { query } from "@/lib/db";
import { uploadToBunny } from "@/lib/bunny";
import { logPipeline } from "@/lib/pipeline-log";

const DOWNLOAD_DIR = path.join(process.cwd(), "..", "seedance-automation", "downloads");

export async function POST(req: NextRequest) {
  const { poolItemId } = await req.json();

  // Get pool item + video
  const { rows } = await query(
    `SELECT pi.video_id, pi.video_file, v.slug
     FROM pool_items pi
     JOIN videos v ON v.id = pi.video_id
     WHERE pi.id = $1`,
    [poolItemId]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Pool item or video not found" }, { status: 404 });
  }

  const { video_id, video_file, slug } = rows[0];

  if (!video_file) {
    return NextResponse.json({ error: "No video file" }, { status: 400 });
  }

  const videoPath = path.join(DOWNLOAD_DIR, video_file);
  if (!fs.existsSync(videoPath)) {
    return NextResponse.json({ error: `File not found: ${video_file}` }, { status: 404 });
  }

  // 1. Generate thumbnail with ffmpeg (frame at 1 second)
  const thumbPath = path.join(DOWNLOAD_DIR, `thumb_${slug}.jpg`);
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -ss 1 -vframes 1 -q:v 2 "${thumbPath}"`,
      { timeout: 15000, stdio: "pipe" }
    );
  } catch (err) {
    await logPipeline(poolItemId, "cdn", "error", `ffmpeg thumbnail failed: ${(err as Error).message}`);
    return NextResponse.json({ error: "Thumbnail generation failed" }, { status: 500 });
  }

  try {
    await logPipeline(poolItemId, "cdn", "info", "Uploading video + thumbnail to Bunny CDN");

    // 2. Upload video to Bunny CDN
    const videoBuffer = fs.readFileSync(videoPath);
    const videoUrl = await uploadToBunny(
      videoBuffer,
      `videos/${slug}.mp4`
    );

    // 3. Upload thumbnail to Bunny CDN
    const thumbBuffer = fs.readFileSync(thumbPath);
    const thumbnailUrl = await uploadToBunny(
      thumbBuffer,
      `thumbnails/${slug}.jpg`
    );

    // 4. Update video record
    await query(
      `UPDATE videos SET video_url = $1, thumbnail_url = $2 WHERE id = $3`,
      [videoUrl, thumbnailUrl, video_id]
    );

    // Clean up temp thumbnail
    try { fs.unlinkSync(thumbPath); } catch { /* ignore */ }

    await logPipeline(poolItemId, "cdn", "info", "CDN upload finished", { videoUrl, thumbnailUrl });
    return NextResponse.json({ videoUrl, thumbnailUrl });
  } catch (err) {
    // Clean up temp thumbnail on error too
    try { fs.unlinkSync(thumbPath); } catch { /* ignore */ }
    await logPipeline(poolItemId, "cdn", "error", `CDN upload failed: ${(err as Error).message}`);
    return NextResponse.json({ error: "CDN upload failed: " + (err as Error).message }, { status: 500 });
  }
}

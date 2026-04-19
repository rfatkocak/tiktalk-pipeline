// POST /api/upload-cdn
//
// Last stage of the content pipeline. By now /api/content has created the
// `lessons` row (with bunny_video_id set as a placeholder). This endpoint:
//   1. Reads the local MP4 from seedance-automation/downloads/
//   2. Uploads to Bunny Stream (transcodes, returns guid)
//   3. Generates a mid-frame thumbnail with ffmpeg
//   4. Sets that thumbnail on the Bunny video
//   5. UPDATEs lessons.bunny_video_id to the real guid
//   6. Marks pool_item complete + publishes lesson
//
// Backend signs playback/thumbnail URLs at read time from bunny_video_id —
// pipeline never deals with URLs, only guids.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { query } from "@/lib/db";
import { uploadLessonVideo, setCustomThumbnail, getVideoMeta } from "@/lib/bunny";
import { logPipeline } from "@/lib/pipeline-log";

const DOWNLOAD_DIR = path.join(
  process.cwd(),
  "..",
  "seedance-automation",
  "downloads"
);

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const { poolItemId } = await req.json();
  if (!poolItemId) {
    return NextResponse.json({ error: "poolItemId required" }, { status: 400 });
  }

  // Fetch pool_item + linked lesson
  const { rows } = await query(
    `SELECT pi.lesson_id, pi.video_file
     FROM pool_items pi
     WHERE pi.id = $1`,
    [poolItemId]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "pool_item not found" }, { status: 404 });
  }
  const { lesson_id, video_file } = rows[0];
  if (!lesson_id) {
    return NextResponse.json(
      { error: "no linked lesson — run /api/content first" },
      { status: 400 }
    );
  }
  if (!video_file) {
    return NextResponse.json({ error: "no video_file" }, { status: 400 });
  }

  const videoPath = path.join(DOWNLOAD_DIR, video_file);
  if (!fs.existsSync(videoPath)) {
    return NextResponse.json(
      { error: `file not found: ${video_file}` },
      { status: 404 }
    );
  }

  try {
    // 1. Upload video to Bunny Stream
    await logPipeline(poolItemId, "upload-cdn", "info", "uploading video to Bunny");
    const videoBuffer = fs.readFileSync(videoPath);
    const title = `lesson-${String(lesson_id).slice(0, 8)}`;
    const bunnyGuid = await uploadLessonVideo(videoBuffer, title);
    await logPipeline(poolItemId, "upload-cdn", "info", `video uploaded, guid=${bunnyGuid}`);

    // 2. Read the real duration (ffprobe) so lessons.duration_sec is accurate.
    let durationSec = 15;
    try {
      const durOut = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { encoding: "utf8" }
      ).trim();
      const parsed = parseFloat(durOut);
      if (!isNaN(parsed) && parsed > 0) {
        durationSec = parsed;
      }
    } catch {
      /* fall back to 15 */
    }

    // 3. Mid-frame thumbnail via ffmpeg.
    const thumbPath = path.join(DOWNLOAD_DIR, `thumb-${bunnyGuid}.jpg`);
    const midSec = (durationSec / 2).toFixed(2);
    try {
      execSync(
        `ffmpeg -y -ss ${midSec} -i "${videoPath}" -vframes 1 -q:v 2 "${thumbPath}"`,
        { stdio: "pipe", timeout: 15000 }
      );
    } catch (err) {
      await logPipeline(
        poolItemId,
        "upload-cdn",
        "warn",
        `ffmpeg thumbnail failed: ${(err as Error).message}`
      );
    }

    // 4. Upload custom thumbnail to Bunny — Bunny renames the file on upload
    //    (thumbnail.jpg → thumbnail_<hash>.jpg), so we re-fetch meta after
    //    success and persist the real filename so backend signer knows which
    //    path to sign.
    let thumbnailFileName = "thumbnail.jpg";
    if (fs.existsSync(thumbPath)) {
      try {
        const thumbBuf = fs.readFileSync(thumbPath);
        await setCustomThumbnail(bunnyGuid, thumbBuf, "image/jpeg");
        fs.unlinkSync(thumbPath);
        try {
          const meta = await getVideoMeta(bunnyGuid);
          if (meta.thumbnailFileName) thumbnailFileName = meta.thumbnailFileName;
        } catch {
          /* meta fetch failed — fall back to default thumbnail.jpg */
        }
      } catch (err) {
        await logPipeline(
          poolItemId,
          "upload-cdn",
          "warn",
          `thumbnail upload failed: ${(err as Error).message}`
        );
      }
    }

    // 5. Persist guid + duration + actual thumbnail filename on the lesson row
    await query(
      `UPDATE lessons
       SET bunny_video_id      = $1,
           duration_sec        = $2,
           thumbnail_file_name = $3,
           updated_at          = now()
       WHERE id = $4`,
      [bunnyGuid, durationSec, thumbnailFileName, lesson_id]
    );

    // 6. Publish the lesson and mark pool_item complete
    await query(
      `UPDATE lessons SET published_at = COALESCE(published_at, now())
       WHERE id = $1`,
      [lesson_id]
    );
    await query(
      `UPDATE pool_items SET status = 'completed', updated_at = now()
       WHERE id = $1`,
      [poolItemId]
    );
    await logPipeline(poolItemId, "upload-cdn", "info", "pipeline complete");

    return NextResponse.json({
      lessonId: lesson_id,
      bunnyVideoId: bunnyGuid,
      durationSec,
    });
  } catch (err) {
    await logPipeline(
      poolItemId,
      "upload-cdn",
      "error",
      `upload-cdn failed: ${(err as Error).message}`
    );
    return NextResponse.json(
      { error: "upload-cdn failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}

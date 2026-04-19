import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { query } from "@/lib/db";
import { logPipeline } from "@/lib/pipeline-log";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const DOWNLOAD_DIR = path.join(process.cwd(), "..", "seedance-automation", "downloads");

export async function POST(req: NextRequest) {
  const { poolItemId } = await req.json();

  // Get pool item
  const { rows } = await query(
    "SELECT id, video_file FROM pool_items WHERE id = $1",
    [poolItemId]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Pool item not found" }, { status: 404 });
  }

  const item = rows[0];
  if (!item.video_file) {
    return NextResponse.json({ error: "No video file" }, { status: 400 });
  }

  const filePath = path.join(DOWNLOAD_DIR, item.video_file);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: `File not found: ${item.video_file}` }, { status: 404 });
  }

  // Send to OpenAI Whisper API
  const fileBuffer = fs.readFileSync(filePath);
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer], { type: "video/mp4" }), item.video_file);
  formData.append("model", "gpt-4o-transcribe-diarize");
  formData.append("response_format", "diarized_json");
  formData.append("language", "en");

  await logPipeline(poolItemId, "whisper", "info", "Whisper transcription started", { file: item.video_file });
  const start = Date.now();

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    await logPipeline(poolItemId, "whisper", "error", `Whisper API error ${res.status}`, {
      response: text.slice(0, 500),
      duration_ms: Date.now() - start,
    });
    return NextResponse.json({ error: `Whisper API error: ${res.status} ${text}` }, { status: 500 });
  }

  const whisperResult = await res.json();
  console.log("Whisper raw:", JSON.stringify(whisperResult).slice(0, 1000));

  // Whisper returns start/end in SECONDS. We keep it that way — iOS expects
  // seconds, mock lessons use seconds, backend passes subtitles.jsonb through
  // unchanged. Round to 2 decimals so the jsonb stays compact.
  const segments = (whisperResult.segments || []).map(
    (seg: { start: number; end: number; text: string; speaker: string }) => ({
      start: Math.round(seg.start * 100) / 100,
      end: Math.round(seg.end * 100) / 100,
      text: seg.text.trim(),
      speaker: seg.speaker || null,
    })
  );

  const transcript = {
    full_text: whisperResult.text,
    segments,
    language: whisperResult.language || "en",
    duration: whisperResult.duration || 0,
  };

  // Save to DB
  await query("UPDATE pool_items SET transcript = $1 WHERE id = $2", [
    JSON.stringify(transcript),
    poolItemId,
  ]);

  await logPipeline(poolItemId, "whisper", "info", "Whisper transcription finished", {
    duration_ms: Date.now() - start,
    segment_count: segments.length,
    audio_duration_s: transcript.duration,
  });

  return NextResponse.json(transcript);
}

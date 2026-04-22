import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { query } from "@/lib/db";
import { logPipeline } from "@/lib/pipeline-log";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const DOWNLOAD_DIR = path.join(process.cwd(), "..", "seedance-automation", "downloads");

// OpenAI's `prompt` param caps around 244 tokens / ~1000 chars. We keep ours
// well under that — it's meant to prime vocabulary, not replace the audio.
const WHISPER_PROMPT_MAX_CHARS = 800;

export async function POST(req: NextRequest) {
  const { poolItemId } = await req.json();

  // Fetch video_file + seedance_prompt + TP names so we can build a compact
  // priming prompt for Whisper. Character names, idioms, and slang in the
  // prompt reduce mis-transcriptions ("Mya" vs "Mia", "out the blue" vs
  // "out of the blue", "going to" vs "gonna").
  const { rows } = await query(`
    SELECT pi.id, pi.video_file, pi.seedance_prompt, pi.level,
      (SELECT json_agg(tp.name)
       FROM pool_item_teaching_points pit
       JOIN teaching_points tp ON tp.id = pit.teaching_point_id
       WHERE pit.pool_item_id = pi.id) AS tp_names
    FROM pool_items pi
    WHERE pi.id = $1`,
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

  // NOTE on priming prompt: OpenAI's gpt-4o-transcribe-diarize rejects the
  // `prompt` field ("Prompt is not supported for diarization models").
  // Only the legacy whisper-1 supports it, and that one can't diarize.
  // We keep buildWhisperPrompt around (unused) in case OpenAI adds prompt
  // support to a future diarize model — easy to re-enable. For now, the
  // segment-merge post-process below handles the same-speaker continuation
  // case on its own.
  const fileBuffer = fs.readFileSync(filePath);
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer], { type: "video/mp4" }), item.video_file);
  formData.append("model", "gpt-4o-transcribe-diarize");
  formData.append("response_format", "diarized_json");
  formData.append("language", "en");

  await logPipeline(poolItemId, "whisper", "info", "Whisper transcription started", {
    file: item.video_file,
  });
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
  const rawSegments = (whisperResult.segments || []).map(
    (seg: { start: number; end: number; text: string; speaker: string }) => ({
      start: Math.round(seg.start * 100) / 100,
      end: Math.round(seg.end * 100) / 100,
      text: seg.text.trim(),
      speaker: seg.speaker || null,
    })
  );

  // Merge same-speaker continuations. diarize splits on short in-turn
  // pauses ("I love you" … "so much"); for a learner subtitle those read
  // better as a single line. Merge when:
  //   - next segment has the SAME speaker as the current one,
  //   - gap between them is <= 1.5 seconds,
  //   - combined text stays under ~90 chars / ~18 words (keeps subtitles
  //     readable — learners can't handle a wall of text in 3 sec).
  const MERGE_MAX_GAP_SEC = 1.5;
  const MERGE_MAX_CHARS = 90;
  const MERGE_MAX_WORDS = 18;
  const segments: typeof rawSegments = [];
  for (const seg of rawSegments) {
    const prev = segments[segments.length - 1];
    if (!prev) {
      segments.push(seg);
      continue;
    }
    const sameSpeaker = prev.speaker && seg.speaker && prev.speaker === seg.speaker;
    const gap = seg.start - prev.end;
    const combinedText = `${prev.text} ${seg.text}`.trim();
    const combinedWords = combinedText.split(/\s+/).length;
    if (
      sameSpeaker &&
      gap <= MERGE_MAX_GAP_SEC &&
      combinedText.length <= MERGE_MAX_CHARS &&
      combinedWords <= MERGE_MAX_WORDS
    ) {
      prev.end = seg.end;
      prev.text = combinedText;
    } else {
      segments.push(seg);
    }
  }

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

// buildWhisperPrompt assembles a short priming string for Whisper's `prompt`
// field. Contents:
//  1. Character-name hint  ("Speakers: Mia, Jake.")   — reduces name mis-hears.
//  2. Expected vocabulary   — teaching-point names / quoted phrases.
//  3. Style hint            — contractions + punctuation for conversational
//     casual American English, level-aware.
// Capped at WHISPER_PROMPT_MAX_CHARS so we never blow OpenAI's token budget.
function buildWhisperPrompt(args: {
  seedancePrompt: string;
  tpNames: string[];
  level: string;
}): string {
  const parts: string[] = [];

  // 1) Characters — pull any name that looks like "Name:" from the seedance
  // prompt's dialog lines. Works on the existing "Barista:" / "Mia:" format.
  const speakerNames = extractSpeakerNames(args.seedancePrompt);
  if (speakerNames.length > 0) {
    parts.push(`Speakers in the scene: ${speakerNames.join(", ")}.`);
  }

  // 2) Teaching-point vocabulary — helps idioms / collocations transcribe
  // correctly (e.g. "break the ice", "out of the blue").
  if (args.tpNames.length > 0) {
    // TP names often contain parenthetical examples — strip them for brevity.
    const cleaned = args.tpNames
      .map((n) => n.replace(/\s*\([^)]*\)\s*/g, "").trim())
      .filter(Boolean)
      .slice(0, 10); // cap
    if (cleaned.length > 0) {
      parts.push(`Key phrases that may appear: ${cleaned.map((x) => `"${x}"`).join(", ")}.`);
    }
  }

  // 3) Style — casual American English, transcribe contractions literally so
  // Phase 2/3 can teach "gonna/wanna/gotta" as phrases rather than normalized.
  parts.push(
    args.level === "advanced"
      ? "Conversational American English at natural pace. Transcribe contractions and connected speech literally (gonna, wanna, gotta, lemme). Use proper punctuation."
      : args.level === "beginner"
      ? "Slow, clear conversational American English. Transcribe contractions literally when used (gonna, wanna). Use proper punctuation."
      : "Natural conversational American English. Transcribe contractions literally (gonna, wanna, gotta). Use proper punctuation."
  );

  // 4) Segmentation hint — when the same speaker pauses briefly and
  // continues the same thought, keep it as ONE segment. Avoids subtitle
  // fragmentation like ["I love you", "so much"] → ["I love you so much"].
  parts.push(
    "When a speaker pauses briefly mid-thought and then continues, transcribe the full utterance as a single segment. Only split segments when a different speaker begins.",
  );

  const joined = parts.join(" ");
  if (joined.length <= WHISPER_PROMPT_MAX_CHARS) return joined;
  return joined.slice(0, WHISPER_PROMPT_MAX_CHARS - 1) + "…";
}

// Matches "Name:" at the start of a dialog line. Accepts 1-3 word names
// (handles "John", "Mia Wells", "a tired barista" — the last gets skipped
// because it has more than 3 words / lowercase article).
function extractSpeakerNames(seedance: string): string[] {
  if (!seedance) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const lineRe = /^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(seedance)) !== null) {
    const name = m[1].trim();
    if (name.length <= 40 && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    if (out.length >= 4) break; // 2 speakers + safety
  }
  return out;
}

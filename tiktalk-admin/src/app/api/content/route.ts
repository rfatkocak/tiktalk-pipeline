import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import pool from "@/lib/db";
import { logPipeline } from "@/lib/pipeline-log";
import { callGemini } from "@/lib/gemini";

const LOCALES = ["tr", "pt-BR", "es", "ja", "ko", "id", "ar", "de", "fr", "it", "ru", "pl"];
const LOCALE_NAMES: Record<string, string> = {
  "tr": "Turkish", "pt-BR": "Brazilian Portuguese", "es": "Spanish",
  "ja": "Japanese", "ko": "Korean", "id": "Indonesian",
  "ar": "Arabic (MSA)", "de": "German", "fr": "French",
  "it": "Italian", "ru": "Russian", "pl": "Polish"
};

// 4 batches × 3 locales each = 12 locales parallel
const TRANSLATION_BATCHES: string[][] = [
  ["tr", "pt-BR", "es"],
  ["ja", "ko", "id"],
  ["ar", "de", "fr"],
  ["it", "ru", "pl"],
];

const VALID_QUIZ_TYPES = ["comprehension", "grammar", "vocabulary"];
const VALID_SECTION_TYPES = ["grammar", "cultural", "contextual_translation", "extra_notes", "common_mistakes"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 800;

// ═══════════════════════════════════════════════════════════════
// SCHEMAS — force Gemini to produce exact shapes
// ═══════════════════════════════════════════════════════════════

const MATCH_SCHEMA = {
  type: "object",
  properties: {
    match: { type: "boolean" },
    match_score: { type: "number" },
    match_reason: { type: "string" },
    speaker_mapping: {
      type: "object",
      properties: {
        speakers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              role: { type: "string" },
            },
            required: ["id", "name", "role"],
          },
        },
      },
      required: ["speakers"],
    },
    corrected_speakers: {
      type: "array",
      description: "One entry per transcript segment, in order. The correct character name for each segment.",
      items: { type: "string" },
    },
  },
  required: ["match", "match_score", "match_reason"],
};

const ENGLISH_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    slug: { type: "string" },
    description: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    quizzes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quiz_type: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_index: { type: "integer" },
          explanation_en: { type: "string" },
        },
        required: ["quiz_type", "question", "options", "correct_index", "explanation_en"],
      },
    },
    info_sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section_type: { type: "string" },
          teaching_point_id: { type: "string", nullable: true },
          title_en: { type: "string" },
          body_en: { type: "string" },
        },
        required: ["section_type", "title_en", "body_en"],
      },
    },
    speaking_prompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          prompt_type: { type: "string" },
          prompt_text: { type: "string" },
          expected_text: { type: "string", nullable: true },
          context_hint: { type: "string", nullable: true },
        },
        required: ["prompt_type", "prompt_text"],
      },
    },
  },
  required: ["title", "slug", "description", "keywords", "quizzes", "info_sections", "speaking_prompts"],
};

// Built dynamically per batch — locale keys are required so Gemini cannot drift
function buildTranslationSchema(locales: string[]) {
  const localeEntrySchema = {
    type: "object",
    properties: {
      subtitles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: { type: "number" },
            end: { type: "number" },
            text: { type: "string" },
            speaker: { type: "string" },
          },
          required: ["start", "end", "text"],
        },
      },
      quiz_explanations: {
        type: "array",
        items: { type: "string" },
      },
      info_sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["title", "body"],
        },
      },
    },
    required: ["subtitles", "quiz_explanations", "info_sections"],
  };

  const translationsProps: Record<string, unknown> = {};
  for (const loc of locales) {
    translationsProps[loc] = localeEntrySchema;
  }

  return {
    type: "object",
    properties: {
      translations: {
        type: "object",
        properties: translationsProps,
        required: locales,
      },
    },
    required: ["translations"],
  };
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildMatchPrompt(args: {
  seedancePrompt: string;
  transcript: { segments: unknown[]; full_text: string; duration: number };
  level: string;
  channelName: string;
  tps: { name: string; category: string }[];
}): string {
  return `You are a QA reviewer for TikTalk, a language-learning app. Your only job is STEP 1: decide if the spoken dialogue matches what the seedance prompt intended.

=== SEEDANCE PROMPT (what was intended) ===
${args.seedancePrompt}

=== WHISPER TRANSCRIPT (what was actually spoken) ===
${args.transcript.full_text}

=== TRANSCRIPT SEGMENTS (${(args.transcript.segments as Array<{speaker?: string; text?: string}>).length} segments) ===
${(args.transcript.segments as Array<{speaker?: string; text?: string}>).map((seg, i) => `[${i}] ${seg.speaker || "?"}: "${seg.text || ""}"`).join("\n")}

Duration: ${args.transcript.duration}s
Channel: ${args.channelName}
Level: ${args.level}
Teaching points: ${args.tps.map((tp) => `${tp.category}:${tp.name}`).join(", ")}

=== TASK ===

1) Decide if the transcript reasonably matches the intended scene. Score 0.0-1.0.
   - 1.0 = dialogue is almost exactly what was planned
   - 0.7 = same scene, different wording, TPs are still covered
   - 0.5 = related but drifts, some TPs missing
   - < 0.5 = fails, reject
2) match_reason MUST be written in Turkish.
3) SPEAKER IDENTIFICATION — this is critical:
   The transcript uses generic labels like "Speaker 0", "Speaker 1" (or sometimes both are "Speaker 0" if Whisper can't distinguish voices).
   The seedance prompt has CHARACTER NAMES (e.g., "John", "Betty", "a tired barista").

   Your job:
   a) "speaker_mapping": List the unique characters with their names and roles.
      - "name": The character name from the seedance prompt (e.g., "John", "Betty"). If the prompt uses descriptions like "a tired barista", use a short label like "Barista".
      - "role": The character's role in the scene (e.g., "barista", "customer").

   b) "corrected_speakers": An array with EXACTLY ${(args.transcript.segments as unknown[]).length} entries (one per transcript segment, in order).
      Each entry is the character NAME who actually spoke that segment.
      IMPORTANT: Whisper often assigns the same speaker label to both characters (e.g., all segments say "Speaker 0").
      You MUST analyze the DIALOGUE CONTENT to figure out who said what — compare with the seedance prompt's dialogue lines.
      Example: if seedance says Barista asks "What can I get you?" and segment [0] contains that line, then corrected_speakers[0] = "Barista".

Return raw JSON (no markdown):
{
  "match": true,
  "match_score": 0.85,
  "match_reason": "Türkçe açıklama",
  "speaker_mapping": {
    "speakers": [
      {"id": "Speaker 0", "name": "John", "role": "barista"},
      {"id": "Speaker 1", "name": "Betty", "role": "customer"}
    ]
  },
  "corrected_speakers": ["John", "Betty", "John", "Betty"]
}

If match is false, speaker_mapping can be empty. Be strict — only set match=true if the TPs are actually present in the dialogue.`;
}

function buildEnglishPrompt(args: {
  channelName: string;
  channelDescription: string;
  level: string;
  vibes: { name: string }[];
  seedancePrompt: string;
  tps: { id: string; name: string; category: string; description: string }[];
  transcript: { segments: unknown[]; full_text: string; duration: number };
  speakerMapping: { id: string; role: string }[];
}): string {
  const tpCount = args.tps.length;
  const expectedSectionCount = tpCount + 1;

  return `You are a content generator for TikTalk, a social-media style language learning app. This is PHASE 2 of 3 — you generate ALL English-language content for a single video. Translations are handled separately in phase 3, so DO NOT translate anything here. English only.

=== CONTEXT ===

CHANNEL: "${args.channelName}"
CHANNEL DESCRIPTION: ${args.channelDescription || "(no description)"}
LEVEL: ${args.level}
VIBES: ${args.vibes.map((v) => v.name).join(", ")}

SEEDANCE PROMPT (what was filmed):
${args.seedancePrompt}

TEACHING POINTS in this video:
${args.tps.map((tp) => `- [${tp.id}] ${tp.category}: ${tp.name} — ${tp.description || "no description"}`).join("\n")}

WHISPER TRANSCRIPT:
${args.transcript.full_text}

SPEAKER ROLES (identified in phase 1):
${args.speakerMapping.map((s) => `${s.id} → ${s.role}`).join("\n") || "(unknown)"}

=== TASK ===

A) METADATA:
- title: Short, catchy English title (5-8 words). Make it feed-friendly, hook-worthy.
- description: 1-2 sentences + 3-5 hashtags. Written for a TikTok-style feed.
- slug: URL-friendly (lowercase, hyphens). Descriptive and distinctive.
- keywords: 5-10 English learning keywords from the dialogue.

B) QUIZZES (exactly 3):
Difficulty MUST match the "${args.level}" level.
- beginner: Simple direct questions. Short options. Test basic comprehension.
- intermediate: Contextual distractors. Test grammar patterns.
- advanced: Inference questions. Subtle distinctions, idioms, tone.

Each quiz has:
- quiz_type: "comprehension" | "grammar" | "vocabulary" (prefer 3 different types)
- question: English
- options: Exactly 4 English choices
- correct_index: 0-3
- explanation_en: English explanation of WHY the correct answer is right. Educational, level-appropriate. This will be translated into 12 languages in phase 3.

Example of a good beginner quiz explanation:
"We use 'Can I have...' to politely ask for something. 'Could I' and 'May I' are also polite, but 'Can I' is the most common in everyday speech."

C) INFO SECTIONS (${expectedSectionCount} required + 1 optional: one "grammar" per teaching point + one "cultural" or "contextual_translation", and optionally one "common_mistakes" section — see below):
Depth must match the "${args.level}" level.
- beginner: Simple language, basic examples, focus on core concept. Avoid jargon.
- intermediate: More examples, compare structures, note common mistakes.
- advanced: Deep linguistic analysis, nuance, register, edge cases.

Each section has:
- section_type: "grammar" | "cultural" | "contextual_translation" | "extra_notes" | "common_mistakes"
- teaching_point_id: MUST be one of the TP UUIDs above for "grammar" sections. Null otherwise.
- title_en: Section title in English
- body_en: Rich markdown for mobile display. Will be translated in phase 3.

BODY MARKDOWN FORMAT — follow this structure consistently for every grammar section:

**[Key term/pattern]** — one sentence explanation.

**Pattern:** \`Subject + can + verb + object\`

**From the video:**
> *Speaker: "Exact quote from dialogue"*

**Examples:**
- First example sentence
- Second example sentence

**Tip:** One practical usage tip or formality note.

RULES for body_en:
- ALWAYS use **bold** for key terms and section labels
- ALWAYS use \`code spans\` for patterns/formulas
- ALWAYS use > blockquotes for dialogue references from the video
- ALWAYS use - bullet lists for examples (2-4 examples)
- ALWAYS include a "From the video" blockquote referencing actual dialogue
- ALWAYS end with a practical **Tip**
- NEVER write plain wall-of-text paragraphs
- Keep the same structure order across all sections for visual consistency

COMMON_MISTAKES SECTION (optional, but strongly recommended for collocations and easily-confused patterns):
- Use this when the teaching point has a typical L1-interference error that learners (especially Turkish speakers) make.
- Examples of when to add it:
  * Collocation TPs: "make a decision" (learners say "do a decision")
  * Phrasal/preposition confusions: "listen TO music" (learners drop the "to")
  * False friends / confusing pairs: say vs tell, make vs do
- Title should be clear, e.g., "Common Mistakes: Make vs Do"
- Body markdown format for common_mistakes:

❌ **Wrong:** \`She did a decision.\`
✅ **Correct:** \`She made a decision.\`

❌ **Wrong:** \`I did a mistake.\`
✅ **Correct:** \`I made a mistake.\`

**Why:** "Make" is used for decisions, mistakes, and plans — not "do".

- IMPORTANT: The wrong form MUST NEVER appear in the video dialogue itself — only in this info section as a warning. The scene shows only correct English.
- If the teaching points in this video don't have a clear L1-interference pattern, SKIP this section entirely. Don't force it.

CULTURAL / CONTEXTUAL_TRANSLATION section format:

**[Cultural insight or translation note]** — one sentence hook.

**In the video:**
> *Speaker: "Relevant quote"*

**What this means:** Explanation of cultural context, register, or why direct translation fails.

**In practice:**
- When/where this is commonly used
- Social context or formality level

D) SPEAKING PROMPTS (exactly 3) matched to "${args.level}" level:
1. prompt_type "repeat": A sentence from the video. Set expected_text to the exact sentence. prompt_text should instruct the user in English (e.g., "Repeat: ...").
2. prompt_type "repeat": Another sentence from the video. Set expected_text.
3. prompt_type "produce": A task asking the user to create their own sentence using the video's patterns.
   - beginner: Very guided with a template
   - intermediate: Moderately open
   - advanced: Fully open-ended
   Set context_hint for LLM evaluation, expected_text null.

=== OUTPUT FORMAT ===

Return raw JSON (no markdown, no code blocks):
{
  "title": "...",
  "slug": "ordering-coffee-beginner",
  "description": "... #tag1 #tag2 #tag3",
  "keywords": ["coffee", "order", "please"],
  "quizzes": [
    {
      "quiz_type": "comprehension",
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "correct_index": 0,
      "explanation_en": "..."
    }
  ],
  "info_sections": [
    {
      "section_type": "grammar",
      "teaching_point_id": "uuid-or-null",
      "title_en": "...",
      "body_en": "..."
    }
  ],
  "speaking_prompts": [
    {"prompt_type": "repeat", "prompt_text": "Repeat: ...", "expected_text": "...", "context_hint": null},
    {"prompt_type": "repeat", "prompt_text": "Repeat: ...", "expected_text": "...", "context_hint": null},
    {"prompt_type": "produce", "prompt_text": "...", "expected_text": null, "context_hint": "..."}
  ]
}`;
}

function buildTranslationPrompt(args: {
  locales: string[];
  level: string;
  channelName: string;
  speakerMapping: { id: string; role: string }[];
  transcript: { segments: { start: number; end: number; text: string; speaker?: string }[] };
  english: {
    quizzes: { explanation_en: string }[];
    info_sections: { title_en: string; body_en: string }[];
  };
}): string {
  const localeList = args.locales.map((l) => `${l} (${LOCALE_NAMES[l]})`).join(", ");
  const expectedSegCount = args.transcript.segments.length;
  const expectedQuizCount = args.english.quizzes.length;
  const expectedSectionCount = args.english.info_sections.length;

  return `You are a professional translator for TikTalk, a language-learning app. This is PHASE 3 — translate English content into the following ${args.locales.length} target languages: ${localeList}.

CRITICAL RULES:
- Translations must be NATURAL and CONVERSATIONAL, not literal Google Translate style.
- Use correct honorifics / formality appropriate to the speaker roles (e.g., customer-to-staff in Japanese/Korean formal, friends in casual).
- Preserve meaning, tone, and any cultural nuances.
- The "${args.level}" level matters: explanations and bodies should match that depth in each language.
- Return EXACTLY ${expectedSegCount} subtitle segments per locale (same count as English).
- Return EXACTLY ${expectedQuizCount} quiz explanations per locale.
- Return EXACTLY ${expectedSectionCount} info section entries per locale.

=== CONTEXT ===
Channel: ${args.channelName}
Level: ${args.level}
Speakers: ${args.speakerMapping.map((s) => `${s.id}=${s.role}`).join(", ") || "unknown"}

=== ENGLISH SUBTITLE SEGMENTS (to translate) ===
${JSON.stringify(args.transcript.segments)}

=== ENGLISH QUIZ EXPLANATIONS (to translate) ===
${args.english.quizzes.map((q, i) => `Quiz ${i + 1}: ${q.explanation_en}`).join("\n")}

=== ENGLISH INFO SECTIONS (to translate) ===
${args.english.info_sections.map((s, i) => `Section ${i + 1}:\nTitle: ${s.title_en}\nBody: ${s.body_en}`).join("\n\n")}

=== TASK ===

For each of the ${args.locales.length} locales (${args.locales.join(", ")}), produce:
1) subtitles: array of ${expectedSegCount} segments. Keep start/end/speaker unchanged from English. Only translate "text".
2) quiz_explanations: array of ${expectedQuizCount} translated explanation strings (in order).
3) info_sections: array of ${expectedSectionCount} {title, body} objects (in order). Body is markdown.

=== OUTPUT FORMAT ===

Return raw JSON (no markdown):
{
  "translations": {
    "${args.locales[0]}": {
      "subtitles": [{"start": 1640, "end": 3340, "text": "...", "speaker": "Speaker 0"}],
      "quiz_explanations": ["...", "...", "..."],
      "info_sections": [{"title": "...", "body": "..."}]
    },
    "${args.locales[1]}": { ... },
    "${args.locales[2]}": { ... }
  }
}`;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATORS + HELPERS
// ═══════════════════════════════════════════════════════════════

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  return keywords.filter((kw) => {
    const lower = kw.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[ğ]/g, "g").replace(/[ü]/g, "u").replace(/[ş]/g, "s")
    .replace(/[ı]/g, "i").replace(/[ö]/g, "o").replace(/[ç]/g, "c")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validateEnglish(
  result: Record<string, unknown>,
  tpIds: string[]
): string | null {
  if (typeof result.title !== "string" || !result.title) return "Missing title";
  if (typeof result.slug !== "string" || !result.slug) return "Missing slug";
  if (typeof result.description !== "string") return "Missing description";
  if (!Array.isArray(result.keywords) || result.keywords.length === 0) return "Missing keywords";

  const quizzes = result.quizzes;
  if (!Array.isArray(quizzes) || quizzes.length !== 3) {
    return `Expected 3 quizzes, got ${Array.isArray(quizzes) ? quizzes.length : 0}`;
  }
  for (const q of quizzes as Record<string, unknown>[]) {
    if (!q.question || !Array.isArray(q.options) || q.options.length !== 4) return "Quiz missing question or options";
    if (typeof q.correct_index !== "number" || q.correct_index < 0 || q.correct_index > 3) return "Quiz correct_index must be 0-3";
    if (!VALID_QUIZ_TYPES.includes(q.quiz_type as string)) return `Invalid quiz_type: ${q.quiz_type}`;
    if (!q.explanation_en || typeof q.explanation_en !== "string") return "Quiz missing explanation_en";
  }

  const sections = result.info_sections;
  if (!Array.isArray(sections) || sections.length === 0) return "Missing info_sections";
  for (const sec of sections as Record<string, unknown>[]) {
    if (!VALID_SECTION_TYPES.includes(sec.section_type as string)) return `Invalid section_type: ${sec.section_type}`;
    if (!sec.title_en || !sec.body_en) return "Info section missing title_en/body_en";
    if (sec.teaching_point_id && !tpIds.includes(sec.teaching_point_id as string)) {
      return `Info section references unknown teaching_point_id: ${sec.teaching_point_id}`;
    }
  }

  const sps = result.speaking_prompts;
  if (!Array.isArray(sps) || sps.length !== 3) {
    return `Expected 3 speaking prompts, got ${Array.isArray(sps) ? sps.length : 0}`;
  }
  const spArr = sps as Record<string, unknown>[];
  if (spArr[0]?.prompt_type !== "repeat" || !spArr[0]?.expected_text) return "Speaking prompt 1 must be repeat with expected_text";
  if (spArr[1]?.prompt_type !== "repeat" || !spArr[1]?.expected_text) return "Speaking prompt 2 must be repeat with expected_text";
  if (spArr[2]?.prompt_type !== "produce") return "Speaking prompt 3 must be produce";

  return null;
}

function validateTranslationBatch(
  batch: Record<string, unknown>,
  locales: string[],
  expectedSegCount: number,
  expectedQuizCount: number,
  expectedSectionCount: number
): string | null {
  const translations = batch.translations as Record<string, unknown> | undefined;
  if (!translations || typeof translations !== "object") return "Missing translations";

  for (const loc of locales) {
    const entry = translations[loc] as Record<string, unknown> | undefined;
    if (!entry) return `Missing locale: ${loc}`;

    const subs = entry.subtitles;
    if (!Array.isArray(subs) || subs.length !== expectedSegCount) {
      return `${loc}: expected ${expectedSegCount} subtitle segments, got ${Array.isArray(subs) ? subs.length : 0}`;
    }
    for (const seg of subs) {
      const s = seg as Record<string, unknown>;
      if (typeof s.start !== "number" || typeof s.end !== "number" || typeof s.text !== "string") {
        return `${loc}: subtitle segment missing start/end/text`;
      }
    }

    const quizExp = entry.quiz_explanations;
    if (!Array.isArray(quizExp) || quizExp.length !== expectedQuizCount) {
      return `${loc}: expected ${expectedQuizCount} quiz explanations, got ${Array.isArray(quizExp) ? quizExp.length : 0}`;
    }

    const secs = entry.info_sections;
    if (!Array.isArray(secs) || secs.length !== expectedSectionCount) {
      return `${loc}: expected ${expectedSectionCount} info sections, got ${Array.isArray(secs) ? secs.length : 0}`;
    }
    for (const sec of secs) {
      const s = sec as Record<string, unknown>;
      if (!s.title || !s.body) return `${loc}: info section missing title/body`;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { poolItemId } = await req.json();

  if (!poolItemId || typeof poolItemId !== "string" || !UUID_REGEX.test(poolItemId)) {
    return NextResponse.json({ error: "Invalid poolItemId format" }, { status: 400 });
  }

  // === DUPLICATE GUARD ===
  const { rows: checkRows } = await query(
    "SELECT id, video_id, status FROM pool_items WHERE id = $1",
    [poolItemId]
  );
  if (checkRows.length === 0) {
    return NextResponse.json({ error: "Pool item not found" }, { status: 404 });
  }
  if (checkRows[0].video_id) {
    return NextResponse.json(
      { error: "Content already generated for this pool item", videoId: checkRows[0].video_id },
      { status: 409 }
    );
  }

  // === FETCH POOL ITEM + RELATED DATA ===
  const { rows } = await query(`
    SELECT pi.*, c.name as channel_name, c.slug as channel_slug, c.description as channel_description,
      (SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'slug', v.slug))
       FROM pool_item_vibes piv JOIN vibes v ON v.id = piv.vibe_id WHERE piv.pool_item_id = pi.id) as vibes,
      (SELECT json_agg(json_build_object('id', tp.id, 'name', tp.name, 'category', tp.category, 'level', tp.level, 'description', tp.description))
       FROM pool_item_tps pit JOIN teaching_points tp ON tp.id = pit.teaching_point_id WHERE pit.pool_item_id = pi.id) as tps
    FROM pool_items pi
    LEFT JOIN channels c ON c.id = pi.channel_id
    WHERE pi.id = $1
  `, [poolItemId]);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Pool item not found" }, { status: 404 });
  }

  const item = rows[0];
  if (!item.transcript || !item.seedance_prompt) {
    return NextResponse.json({ error: "Missing transcript or seedance_prompt" }, { status: 400 });
  }

  const tps = item.tps || [];
  const vibes = item.vibes || [];
  const transcript = item.transcript;
  const tpIds: string[] = tps.map((tp: { id: string }) => tp.id);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1 — MATCH CHECK + SPEAKER MAPPING
  // ═══════════════════════════════════════════════════════════════

  let matchResult: {
    match: boolean;
    match_score: number;
    match_reason: string;
    speaker_mapping?: { speakers: { id: string; name: string; role: string }[] };
    corrected_speakers?: string[];
  };

  await logPipeline(poolItemId, "content", "info", "Phase 1 (match check) started");
  const phase1Start = Date.now();
  try {
    const { data } = await callGemini<typeof matchResult>({
      prompt: buildMatchPrompt({
        seedancePrompt: item.seedance_prompt,
        transcript,
        level: item.level,
        channelName: item.channel_name,
        tps,
      }),
      temperature: 0.2,
      maxOutputTokens: 8192,
      schema: MATCH_SCHEMA,
    });
    matchResult = data;
    await logPipeline(poolItemId, "content", "info", "Phase 1 finished", {
      duration_ms: Date.now() - phase1Start,
      match: matchResult.match,
      match_score: matchResult.match_score,
    });
  } catch (err) {
    await logPipeline(poolItemId, "content", "error", `Phase 1 failed: ${(err as Error).message}`, {
      duration_ms: Date.now() - phase1Start,
    });
    return NextResponse.json({ error: `Phase 1 (match) failed: ${(err as Error).message}` }, { status: 500 });
  }

  if (typeof matchResult.match_score !== "number" || matchResult.match_score < 0 || matchResult.match_score > 1) {
    return NextResponse.json({ error: "Invalid match_score from Gemini" }, { status: 500 });
  }

  if (!matchResult.match) {
    const cancelNote = `Match failed (${matchResult.match_score}): ${matchResult.match_reason}`;
    await logPipeline(poolItemId, "content", "warn", "Match check failed — pool item cancelled", {
      match_score: matchResult.match_score,
      match_reason: matchResult.match_reason,
    });
    await query(
      "UPDATE pool_items SET status = 'cancelled', notes = CASE WHEN notes IS NOT NULL THEN notes || E'\\n---\\n' || $1 ELSE $1 END WHERE id = $2",
      [cancelNote, poolItemId]
    );
    return NextResponse.json({
      match: false,
      reason: matchResult.match_reason,
      score: matchResult.match_score,
    });
  }

  const speakerMapping = matchResult.speaker_mapping?.speakers || [];
  const correctedSpeakers: string[] = matchResult.corrected_speakers || [];

  // Apply corrected speaker names to transcript segments
  // Priority: corrected_speakers (per-segment, handles Whisper errors like both being "Speaker 0")
  // Fallback: speaker_mapping name map (simple id→name replacement)
  if (Array.isArray(transcript.segments) && transcript.segments.length > 0) {
    if (correctedSpeakers.length === transcript.segments.length) {
      // Per-segment correction — most reliable, handles Whisper mis-labeling
      for (let i = 0; i < transcript.segments.length; i++) {
        const seg = transcript.segments[i] as { speaker?: string; text?: string };
        seg.speaker = correctedSpeakers[i];
      }
      await logPipeline(poolItemId, "content", "info", "Speaker names applied per-segment (corrected_speakers)", {
        corrected: correctedSpeakers,
      });
    } else if (speakerMapping.length > 0) {
      // Fallback: simple id→name mapping
      const nameMap = new Map(speakerMapping.map((s: { id: string; name: string }) => [s.id, s.name]));
      for (const seg of transcript.segments) {
        const s = seg as { speaker?: string };
        if (s.speaker && nameMap.has(s.speaker)) {
          s.speaker = nameMap.get(s.speaker)!;
        }
      }
      await logPipeline(poolItemId, "content", "info", "Speaker names applied via mapping fallback", {
        mapping: Object.fromEntries(nameMap),
      });
    }

    // Rebuild full_text with corrected speaker names
    transcript.full_text = (transcript.segments as Array<{ speaker?: string; text?: string }>)
      .map((seg) => `${seg.speaker || "?"}: ${seg.text || ""}`)
      .join("\n");
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2 — ENGLISH CONTENT
  // ═══════════════════════════════════════════════════════════════

  type EnglishContent = {
    title: string;
    slug: string;
    description: string;
    keywords: string[];
    quizzes: {
      quiz_type: string;
      question: string;
      options: string[];
      correct_index: number;
      explanation_en: string;
    }[];
    info_sections: {
      section_type: string;
      teaching_point_id: string | null;
      title_en: string;
      body_en: string;
    }[];
    speaking_prompts: {
      prompt_type: string;
      prompt_text: string;
      expected_text: string | null;
      context_hint: string | null;
    }[];
  };

  let english: EnglishContent;
  await logPipeline(poolItemId, "content", "info", "Phase 2 (English content) started");
  const phase2Start = Date.now();
  try {
    const { data } = await callGemini<EnglishContent>({
      prompt: buildEnglishPrompt({
        channelName: item.channel_name,
        channelDescription: item.channel_description || "",
        level: item.level,
        vibes,
        seedancePrompt: item.seedance_prompt,
        tps,
        transcript,
        speakerMapping,
      }),
      temperature: 0.6,
      maxOutputTokens: 65536,
      schema: ENGLISH_SCHEMA,
      thinkingLevel: "MEDIUM",
    });
    english = data;
    await logPipeline(poolItemId, "content", "info", "Phase 2 finished", {
      duration_ms: Date.now() - phase2Start,
      quizzes: english.quizzes?.length,
      info_sections: english.info_sections?.length,
    });
  } catch (err) {
    await logPipeline(poolItemId, "content", "error", `Phase 2 failed: ${(err as Error).message}`, {
      duration_ms: Date.now() - phase2Start,
    });
    await markFailed(poolItemId, `Phase 2 (English) failed: ${(err as Error).message}`);
    return NextResponse.json({ error: `Phase 2 failed: ${(err as Error).message}` }, { status: 500 });
  }

  const englishError = validateEnglish(english as unknown as Record<string, unknown>, tpIds);
  if (englishError) {
    await logPipeline(poolItemId, "content", "error", `Phase 2 validation: ${englishError}`);
    await markFailed(poolItemId, `Phase 2 validation: ${englishError}`);
    return NextResponse.json({ error: `Phase 2 validation: ${englishError}` }, { status: 500 });
  }

  // Normalize English
  english.keywords = dedupeKeywords(english.keywords);
  english.slug = sanitizeSlug(english.slug) || `video-${Date.now().toString(36)}`;

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3 — PARALLEL TRANSLATIONS (4 batches × 3 locales)
  // ═══════════════════════════════════════════════════════════════

  type TranslationEntry = {
    subtitles: { start: number; end: number; text: string; speaker?: string }[];
    quiz_explanations: string[];
    info_sections: { title: string; body: string }[];
  };
  type TranslationBatchResponse = {
    translations: Record<string, TranslationEntry>;
  };

  const expectedSegCount = transcript.segments?.length || 0;
  const expectedQuizCount = english.quizzes.length;
  const expectedSectionCount = english.info_sections.length;

  await logPipeline(poolItemId, "content", "info", "Phase 3 (translations) started — 4 parallel batches");
  const phase3Start = Date.now();

  const translationPromises = TRANSLATION_BATCHES.map(async (batchLocales) => {
    const batchStart = Date.now();
    const { data: batchResult } = await callGemini<TranslationBatchResponse>({
      prompt: buildTranslationPrompt({
        locales: batchLocales,
        level: item.level,
        channelName: item.channel_name,
        speakerMapping,
        transcript,
        english: {
          quizzes: english.quizzes.map((q) => ({ explanation_en: q.explanation_en })),
          info_sections: english.info_sections.map((s) => ({ title_en: s.title_en, body_en: s.body_en })),
        },
      }),
      temperature: 0.3,
      maxOutputTokens: 65536,
      schema: buildTranslationSchema(batchLocales),
    });

    const validationErr = validateTranslationBatch(
      batchResult as unknown as Record<string, unknown>,
      batchLocales,
      expectedSegCount,
      expectedQuizCount,
      expectedSectionCount
    );
    if (validationErr) {
      await logPipeline(poolItemId, "content", "error", `Translation batch validation failed`, {
        locales: batchLocales,
        error: validationErr,
      });
      throw new Error(`Batch ${batchLocales.join(",")}: ${validationErr}`);
    }

    await logPipeline(poolItemId, "content", "info", `Translation batch finished`, {
      locales: batchLocales,
      duration_ms: Date.now() - batchStart,
    });
    return batchResult.translations;
  });

  let allTranslations: Record<string, TranslationEntry> = {};
  try {
    const batches = await Promise.all(translationPromises);
    for (const batch of batches) {
      allTranslations = { ...allTranslations, ...batch };
    }
    await logPipeline(poolItemId, "content", "info", "Phase 3 finished (all 12 locales)", {
      duration_ms: Date.now() - phase3Start,
    });
  } catch (err) {
    await logPipeline(poolItemId, "content", "error", `Phase 3 failed: ${(err as Error).message}`, {
      duration_ms: Date.now() - phase3Start,
    });
    await markFailed(poolItemId, `Phase 3 (translation) failed: ${(err as Error).message}`);
    return NextResponse.json({ error: `Phase 3 failed: ${(err as Error).message}` }, { status: 500 });
  }

  // Sanity check: all 12 locales present
  for (const loc of LOCALES) {
    if (!allTranslations[loc]) {
      await markFailed(poolItemId, `Translation missing for locale: ${loc}`);
      return NextResponse.json({ error: `Translation missing for locale: ${loc}` }, { status: 500 });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ASSEMBLE + DB INSERT (all in transaction)
  // ═══════════════════════════════════════════════════════════════

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Slug uniqueness inside transaction
    let slug = english.slug;
    const { rows: slugCheck } = await client.query("SELECT id FROM videos WHERE slug = $1", [slug]);
    if (slugCheck.length > 0) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    // 1. videos
    const videoRes = await client.query(`
      INSERT INTO videos (channel_id, slug, target_language, level, title, description,
        duration_sec, status, original_script, seedance_prompt, transcript_match_score)
      VALUES ($1, $2, 'en', $3, $4, $5, $6, 'review', $7, $8, $9)
      RETURNING id
    `, [
      item.channel_id,
      slug,
      item.level,
      english.title,
      english.description,
      Math.round(transcript.duration || 15),
      JSON.stringify(transcript.segments),
      item.seedance_prompt,
      matchResult.match_score,
    ]);
    const videoId = videoRes.rows[0].id;

    // 2. transcript
    await client.query(`
      INSERT INTO transcripts (video_id, language, segments, full_text)
      VALUES ($1, 'en', $2, $3)
    `, [videoId, JSON.stringify(transcript.segments), transcript.full_text]);

    // 3. subtitles — English from transcript + 12 translated locales
    {
      const subValues: unknown[] = [];
      const subPlaceholders: string[] = [];
      let idx = 1;

      // English (from original transcript)
      subPlaceholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
      subValues.push(videoId, "en", true, JSON.stringify(transcript.segments));
      idx += 4;

      // 12 translated locales
      for (const loc of LOCALES) {
        const entry = allTranslations[loc];
        subPlaceholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
        subValues.push(videoId, loc, false, JSON.stringify(entry.subtitles));
        idx += 4;
      }

      await client.query(`
        INSERT INTO subtitles (video_id, locale, is_target_language, segments)
        VALUES ${subPlaceholders.join(", ")}
      `, subValues);
    }

    // 4. quizzes (with combined explanations: EN + 12 translated)
    {
      const quizValues: unknown[] = [];
      const quizPlaceholders: string[] = [];
      let idx = 1;
      for (let i = 0; i < english.quizzes.length; i++) {
        const q = english.quizzes[i];
        const explanations: Record<string, string> = {};
        for (const loc of LOCALES) {
          explanations[loc] = allTranslations[loc].quiz_explanations[i];
        }
        quizPlaceholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`);
        quizValues.push(
          videoId,
          i + 1,
          q.quiz_type,
          q.question,
          JSON.stringify(q.options),
          q.correct_index,
          JSON.stringify(explanations),
        );
        idx += 7;
      }
      await client.query(`
        INSERT INTO quizzes (video_id, quiz_order, quiz_type, question, options, correct_index, explanations)
        VALUES ${quizPlaceholders.join(", ")}
      `, quizValues);
    }

    // 5. info sections + locales (en + 12 translated)
    for (let i = 0; i < english.info_sections.length; i++) {
      const sec = english.info_sections[i];
      const secRes = await client.query(`
        INSERT INTO info_sections (video_id, section_type, teaching_point_id, section_order)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [videoId, sec.section_type, sec.teaching_point_id || null, i + 1]);
      const sectionId = secRes.rows[0].id;

      const locValues: unknown[] = [];
      const locPlaceholders: string[] = [];
      let idx = 1;

      // English
      locPlaceholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
      locValues.push(sectionId, "en", sec.title_en, sec.body_en);
      idx += 4;

      // 12 translations
      for (const loc of LOCALES) {
        const locEntry = allTranslations[loc].info_sections[i];
        locPlaceholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
        locValues.push(sectionId, loc, locEntry.title, locEntry.body);
        idx += 4;
      }

      await client.query(`
        INSERT INTO info_section_locales (info_section_id, locale, title, body)
        VALUES ${locPlaceholders.join(", ")}
      `, locValues);
    }

    // 6. speaking prompts
    {
      const spValues: unknown[] = [];
      const spPlaceholders: string[] = [];
      let idx = 1;
      for (let i = 0; i < english.speaking_prompts.length; i++) {
        const sp = english.speaking_prompts[i];
        spPlaceholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
        spValues.push(videoId, i + 1, sp.prompt_type, sp.prompt_text, sp.expected_text || null, sp.context_hint || null);
        idx += 6;
      }
      await client.query(`
        INSERT INTO speaking_prompts (video_id, prompt_order, prompt_type, prompt_text, expected_text, context_hint)
        VALUES ${spPlaceholders.join(", ")}
      `, spValues);
    }

    // 7. video ↔ TPs
    if (tps.length > 0) {
      const tpValues: unknown[] = [];
      const tpPlaceholders: string[] = [];
      let idx = 1;
      for (const tp of tps) {
        tpPlaceholders.push(`($${idx}, $${idx + 1})`);
        tpValues.push(videoId, tp.id);
        idx += 2;
      }
      await client.query(`
        INSERT INTO video_teaching_points (video_id, teaching_point_id)
        VALUES ${tpPlaceholders.join(", ")}
      `, tpValues);
    }

    // 8. video ↔ vibes
    if (vibes.length > 0) {
      const vValues: unknown[] = [];
      const vPlaceholders: string[] = [];
      let idx = 1;
      for (const v of vibes) {
        vPlaceholders.push(`($${idx}, $${idx + 1})`);
        vValues.push(videoId, v.id);
        idx += 2;
      }
      await client.query(`
        INSERT INTO video_vibes (video_id, vibe_id)
        VALUES ${vPlaceholders.join(", ")}
      `, vValues);
    }

    // 9. keywords
    if (english.keywords.length > 0) {
      const kwValues: unknown[] = [];
      const kwPlaceholders: string[] = [];
      let idx = 1;
      for (const kw of english.keywords) {
        kwPlaceholders.push(`($${idx}, $${idx + 1})`);
        kwValues.push(videoId, kw.toLowerCase());
        idx += 2;
      }
      await client.query(`
        INSERT INTO video_keywords (video_id, keyword)
        VALUES ${kwPlaceholders.join(", ")}
      `, kwValues);
    }

    // 10. link pool item
    await client.query(
      "UPDATE pool_items SET status = 'completed', video_id = $1 WHERE id = $2",
      [videoId, poolItemId]
    );

    await client.query("COMMIT");

    await logPipeline(poolItemId, "content", "info", "DB transaction committed — content saved", {
      video_id: videoId,
      title: english.title,
    });

    return NextResponse.json({
      match: true,
      score: matchResult.match_score,
      videoId,
      title: english.title,
      message: "All content generated and saved (3-phase pipeline)",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* dead connection */ }
    await logPipeline(poolItemId, "content", "error", `DB transaction failed: ${(err as Error).message}`);
    await markFailed(poolItemId, `DB error: ${(err as Error).message}`);
    return NextResponse.json(
      { error: "DB error: " + (err as Error).message, match: true, score: matchResult.match_score },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

async function markFailed(poolItemId: string, note: string) {
  try {
    await query(
      "UPDATE pool_items SET status = 'failed', notes = CASE WHEN notes IS NOT NULL THEN notes || E'\\n---\\n' || $1 ELSE $1 END WHERE id = $2",
      [note, poolItemId]
    );
  } catch { /* best effort */ }
}

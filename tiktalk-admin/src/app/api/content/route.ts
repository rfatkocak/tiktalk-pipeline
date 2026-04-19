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

// Quiz dimensions (both tracked separately on backend Question struct):
//  - kind     = FORMAT     (UI rendering)
//  - purpose  = SEMANTIC   (feed ranking, "weak on grammar quizzes" etc.)
const VALID_QUIZ_KINDS = ["multipleChoice", "fillInBlank", "listenAndPick"];
const VALID_QUIZ_PURPOSES = ["comprehension", "grammar", "vocabulary"];
const VALID_SECTION_TYPES = ["grammar", "cultural", "contextual_translation", "extra_notes", "common_mistakes"];

// section_type → info.topics[].kind (camelCase for iOS).
const SECTION_KIND_MAP: Record<string, string> = {
  grammar: "teachingPoint",
  cultural: "cultural",
  contextual_translation: "contextualTranslation",
  extra_notes: "extraNotes",
  common_mistakes: "commonMistakes",
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_VERSION = "v8-jsonb";

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
          kind: { type: "string" },     // multipleChoice | fillInBlank | listenAndPick
          purpose: { type: "string" },  // comprehension | grammar | vocabulary
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_index: { type: "integer" },
          explanation_en: { type: "string" },
        },
        required: ["kind", "purpose", "question", "options", "correct_index", "explanation_en"],
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
   - 0.8 = same scene, slightly different wording, all TPs clearly covered
   - 0.7 = same scene, some TPs present but one is weak or implicit
   - < 0.7 = fails, reject (pool item is cancelled, not sent to review)
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

Each quiz has TWO independent dimensions — pick variety across all 3 quizzes.

- kind (FORMAT — how the user answers): one of
   * "multipleChoice"  → 4 text options, pick the right one
   * "fillInBlank"     → question contains "___", options are 4 words/phrases that fit the blank
   * "listenAndPick"   → question references hearing a line from the dialogue ("Listen — what did the barista say?"), options are 4 transcribed phrases
   (Aim for 3 different kinds across the 3 quizzes when the dialogue allows.)
- purpose (SEMANTIC — what skill it tests): one of
   * "comprehension" → did the user understand what happened?
   * "grammar"       → does the user recognize the pattern from the teaching point?
   * "vocabulary"    → does the user know the meaning of a key word/phrase?
   (Aim for 3 different purposes across the 3 quizzes.)
- question: English. For "fillInBlank" use "___" as the blank marker.
- options: Exactly 4 English choices.
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
      "kind": "multipleChoice",
      "purpose": "comprehension",
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
    if (!VALID_QUIZ_KINDS.includes(q.kind as string)) return `Invalid quiz kind: ${q.kind}`;
    if (!VALID_QUIZ_PURPOSES.includes(q.purpose as string)) return `Invalid quiz purpose: ${q.purpose}`;
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
    "SELECT id, lesson_id, status FROM pool_items WHERE id = $1",
    [poolItemId]
  );
  if (checkRows.length === 0) {
    return NextResponse.json({ error: "Pool item not found" }, { status: 404 });
  }
  if (checkRows[0].lesson_id) {
    return NextResponse.json(
      { error: "Content already generated for this pool item", lessonId: checkRows[0].lesson_id },
      { status: 409 }
    );
  }

  // === FETCH POOL ITEM + RELATED DATA ===
  const { rows } = await query(`
    SELECT pi.*,
      c.name as channel_name,
      c.handle as channel_handle,
      c.description as channel_description,
      c.target_language as channel_target_language,
      (SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'slug', v.slug))
       FROM pool_item_vibes piv JOIN vibes v ON v.id = piv.vibe_id WHERE piv.pool_item_id = pi.id) as vibes,
      (SELECT json_agg(json_build_object('id', tp.id, 'name', tp.name, 'category', tp.category, 'level', tp.level, 'description', tp.description))
       FROM pool_item_teaching_points pit
       JOIN teaching_points tp ON tp.id = pit.teaching_point_id
       WHERE pit.pool_item_id = pi.id) as tps
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

  // Hard numeric gate: reject below 0.7 even if Gemini set match=true.
  // Per product decision, low-match items are cancelled outright — no review queue.
  const MATCH_THRESHOLD = 0.7;
  const rejected = !matchResult.match || matchResult.match_score < MATCH_THRESHOLD;

  if (rejected) {
    const cancelNote = `Match failed (${matchResult.match_score}): ${matchResult.match_reason}`;
    await logPipeline(poolItemId, "content", "warn", "Match check failed — pool item cancelled", {
      match_score: matchResult.match_score,
      match_reason: matchResult.match_reason,
      threshold: MATCH_THRESHOLD,
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
      kind: string;
      purpose: string;
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
  // ASSEMBLE JSONB BLOBS (subtitles / questions / info)
  // ═══════════════════════════════════════════════════════════════
  //
  // Storage shape mirrors what backend's lesson/repo.go decodes:
  //  - subtitles[i]: { id, start, end, speaker, text, translations:{lang→str} }
  //  - questions[i]: { id, kind, purpose, text, options, correctIndex,
  //                    explanations:{en+12 langs} }
  //  - info: free-form jsonb walked by LocalizeInPlace; we use
  //          { topics:[{id,kind,teachingPointId,title:{lang→str},body:{lang→str}}],
  //            speakPrompts:[…], vocabulary:[], createPrompts:[] }
  //          The selfLangKeys (title,body) collapse on read; speakPrompts stay
  //          single-language for v1.

  type Seg = { start: number; end: number; text: string; speaker?: string };
  const enSegments: Seg[] = transcript.segments as Seg[];

  const subtitlesJson = enSegments.map((seg, i) => {
    const translations: Record<string, string> = {};
    for (const loc of LOCALES) {
      translations[loc] = allTranslations[loc].subtitles[i]?.text ?? "";
    }
    return {
      id: `s-${i}`,
      start: seg.start,
      end: seg.end,
      speaker: seg.speaker || "",
      text: seg.text,
      translations,
    };
  });

  const questionsJson = english.quizzes.map((q, i) => {
    const explanations: Record<string, string> = { en: q.explanation_en };
    for (const loc of LOCALES) {
      explanations[loc] = allTranslations[loc].quiz_explanations[i] ?? "";
    }
    return {
      id: `q-${i}`,
      kind: q.kind,
      purpose: q.purpose,
      text: q.question,
      options: q.options,
      correctIndex: q.correct_index,
      explanations,
    };
  });

  const topicsJson = english.info_sections.map((sec, i) => {
    const title: Record<string, string> = { en: sec.title_en };
    const body: Record<string, string> = { en: sec.body_en };
    for (const loc of LOCALES) {
      const entry = allTranslations[loc].info_sections[i];
      title[loc] = entry?.title ?? "";
      body[loc] = entry?.body ?? "";
    }
    return {
      id: `t-${i}`,
      kind: SECTION_KIND_MAP[sec.section_type] || sec.section_type,
      teachingPointId: sec.teaching_point_id || null,
      title,
      body,
    };
  });

  const speakPromptsJson = english.speaking_prompts.map((sp, i) => ({
    id: `sp-${i}`,
    kind: sp.prompt_type,
    promptText: sp.prompt_text,
    expectedText: sp.expected_text,
    contextHint: sp.context_hint,
  }));

  const infoJson = {
    topics: topicsJson,
    speakPrompts: speakPromptsJson,
    vocabulary: [] as unknown[],
    createPrompts: [] as unknown[],
  };

  const subjectTags = english.keywords.map((k) => k.toLowerCase());
  const targetLang = item.channel_target_language || "en";

  // ═══════════════════════════════════════════════════════════════
  // DB INSERT (transaction: lesson + 2 junctions + pool_item link)
  // ═══════════════════════════════════════════════════════════════

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // bunny_video_id + thumbnail_url are NOT NULL — placeholder until
    // /api/upload-cdn populates them. published_at stays NULL → lesson
    // is invisible on the iOS feed until upload-cdn flips it.
    const lessonRes = await client.query(`
      INSERT INTO lessons (
        channel_id, source_topic_pack_id, bunny_video_id,
        title, description, level, learning_language_code,
        duration_sec, thumbnail_url, subject_tags,
        subtitles, questions, info, interactions,
        content_version, original_script, seedance_prompt, match_score
      )
      VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10,
        $11::jsonb, $12::jsonb, $13::jsonb, '[]'::jsonb,
        $14, $15::jsonb, $16, $17
      )
      RETURNING id
    `, [
      item.channel_id,
      poolItemId,
      "",
      english.title,
      english.description,
      item.level,
      targetLang,
      Math.round(transcript.duration || 15),
      "",
      subjectTags,
      JSON.stringify(subtitlesJson),
      JSON.stringify(questionsJson),
      JSON.stringify(infoJson),
      CONTENT_VERSION,
      JSON.stringify(transcript.segments),
      item.seedance_prompt,
      matchResult.match_score,
    ]);
    const lessonId: string = lessonRes.rows[0].id;

    if (tps.length > 0) {
      const tpVals: unknown[] = [];
      const tpPh: string[] = [];
      let idx = 1;
      for (const tp of tps) {
        tpPh.push(`($${idx}, $${idx + 1})`);
        tpVals.push(lessonId, tp.id);
        idx += 2;
      }
      await client.query(
        `INSERT INTO lesson_teaching_points (lesson_id, teaching_point_id)
         VALUES ${tpPh.join(", ")}
         ON CONFLICT DO NOTHING`,
        tpVals,
      );
    }

    if (vibes.length > 0) {
      const vVals: unknown[] = [];
      const vPh: string[] = [];
      let idx = 1;
      for (const v of vibes) {
        vPh.push(`($${idx}, $${idx + 1})`);
        vVals.push(lessonId, v.id);
        idx += 2;
      }
      await client.query(
        `INSERT INTO lesson_vibes (lesson_id, vibe_id)
         VALUES ${vPh.join(", ")}
         ON CONFLICT DO NOTHING`,
        vVals,
      );
    }

    // Leave status='processing' — upload-cdn flips it to 'completed' once
    // the Bunny upload + thumbnail succeed. lesson_id is the link.
    await client.query(
      `UPDATE pool_items
       SET lesson_id = $1, status = 'processing', updated_at = now()
       WHERE id = $2`,
      [lessonId, poolItemId],
    );

    await client.query("COMMIT");

    await logPipeline(poolItemId, "content", "info", "DB transaction committed — lesson row created", {
      lesson_id: lessonId,
      title: english.title,
      tps: tps.length,
      vibes: vibes.length,
    });

    return NextResponse.json({
      match: true,
      score: matchResult.match_score,
      lessonId,
      title: english.title,
      message: "Content generated, lesson row created — run /api/upload-cdn next",
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

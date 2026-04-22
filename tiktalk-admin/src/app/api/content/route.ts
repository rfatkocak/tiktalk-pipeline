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
const VALID_VOCAB_KINDS = ["basics", "phrase", "idiom"];

// grammar_label — UI badge for info section. ~10 values covers the useful
// pedagogical categories; anything unusual goes under "other".
const VALID_GRAMMAR_LABELS = [
  "idiom", "phrase", "tense", "modal", "verb-pattern",
  "preposition", "conditional", "question", "pronoun", "adjective", "other",
];

// Block types rendered by iOS. Keep in sync with iOS_INTEGRATION_GUIDE §6.
const VALID_BLOCK_TYPES = [
  "paragraph", "heading", "bullet_list", "numbered_list", "table", "divider",
  "tip", "warning", "note",
  "video_quote", "example", "examples_group", "formula", "comparison",
  "common_mistake", "phrase",
];

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
          section_type: { type: "string" },       // grammar | cultural | contextual_translation | extra_notes | common_mistakes
          teaching_point_id: { type: "string", nullable: true },
          title_en: { type: "string" },
          summary_en: { type: "string" },         // one-liner shown under title
          grammar_label: { type: "string" },      // UI badge: idiom | phrase | tense | modal | verb-pattern | preposition | conditional | question | pronoun | adjective | other
          blocks: {
            type: "array",
            items: {
              // Discriminated union — `type` picks the shape. All fields
              // listed as optional; validator checks per-type requirements.
              type: "object",
              properties: {
                type:          { type: "string" },
                text:          { type: "string" },
                fallback_text: { type: "string" }, // forward-compat plain-text summary for unknown block types
                level:         { type: "integer" }, // heading
                items: {                            // bullet_list, numbered_list, examples_group
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text:        { type: "string" },
                      english:     { type: "string" },
                      translation: { type: "string" },
                      note:        { type: "string" },
                    },
                  },
                },
                headers: { type: "array", items: { type: "string" } }, // table
                rows: {                                                  // table, comparison
                  type: "array",
                  items: {
                    // Either string[] (table) or object {label, example, exampleTranslation, nuance} (comparison)
                    type: "array",
                    items: { type: "string" },
                  },
                },
                comparison_rows: {                                       // comparison (typed rows)
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label:                { type: "string" },
                      example:              { type: "string" },
                      example_translation:  { type: "string" },
                      nuance:               { type: "string" },
                    },
                  },
                },
                title:   { type: "string" },   // tip | warning | note | examples_group | comparison | table caption
                body:    { type: "string" },   // tip | warning | note
                english: { type: "string" },   // example | video_quote
                translation: { type: "string" },
                speaker:       { type: "string" }, // video_quote
                timestamp_sec: { type: "number" }, // video_quote
                note:          { type: "string" }, // example | common_mistake
                formula:       { type: "string" }, // formula
                explanation:   { type: "string" }, // formula
                wrong:         { type: "string" }, // common_mistake
                correct:       { type: "string" }, // common_mistake
                phrase:        { type: "string" }, // phrase
                meaning:       { type: "string" }, // phrase
                usage:         { type: "string" }, // phrase
              },
              required: ["type"],
            },
          },
        },
        required: ["section_type", "title_en", "summary_en", "grammar_label", "blocks"],
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
    vocabulary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          kind: { type: "string" },           // basics | phrase | idiom
          phonetic: { type: "string" },       // IPA
          meaning_en: { type: "string" },
          examples_en: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["word", "kind", "meaning_en", "examples_en"],
      },
    },
  },
  required: ["title", "slug", "description", "keywords", "quizzes", "info_sections", "speaking_prompts", "vocabulary"],
};

// Built dynamically per batch — locale keys + array lengths locked so
// Gemini cannot drift on item count (we've seen ES returning 4 quiz
// explanations for a 3-quiz lesson; minItems/maxItems stops that at the
// schema layer, before we fall back to post-hoc validation).
function buildTranslationSchema(
  locales: string[],
  counts: {
    subtitles: number;
    quizExplanations: number;
    infoSections: number;
    vocabulary: number;
  },
) {
  const localeEntrySchema = {
    type: "object",
    properties: {
      subtitles: {
        type: "array",
        minItems: counts.subtitles,
        maxItems: counts.subtitles,
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
        minItems: counts.quizExplanations,
        maxItems: counts.quizExplanations,
        items: { type: "string" },
      },
      info_sections: {
        type: "array",
        minItems: counts.infoSections,
        maxItems: counts.infoSections,
        items: {
          type: "object",
          properties: {
            title:   { type: "string" },
            summary: { type: "string" },
            // Per-block translations. Order + length MUST match the English
            // blocks array. All fields optional — only fill the ones the
            // English block uses. divider has no fields.
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type:          { type: "string" },
                  text:          { type: "string" },
                  fallback_text: { type: "string" },
                  level:         { type: "integer" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        text:        { type: "string" },
                        translation: { type: "string" },
                        note:        { type: "string" },
                      },
                    },
                  },
                  headers: { type: "array", items: { type: "string" } },
                  rows: {
                    type: "array",
                    items: { type: "array", items: { type: "string" } },
                  },
                  comparison_rows: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label:                { type: "string" },
                        example_translation:  { type: "string" },
                        nuance:               { type: "string" },
                      },
                    },
                  },
                  title:        { type: "string" },
                  body:         { type: "string" },
                  translation:  { type: "string" },
                  note:         { type: "string" },
                  explanation:  { type: "string" },
                  meaning:      { type: "string" },
                  usage:        { type: "string" },
                },
                required: ["type"],
              },
            },
          },
          required: ["title", "summary", "blocks"],
        },
      },
      vocabulary: {
        type: "array",
        minItems: counts.vocabulary,
        maxItems: counts.vocabulary,
        items: {
          type: "object",
          properties: {
            meaning: { type: "string" },
            examples: { type: "array", items: { type: "string" } },
          },
          required: ["meaning", "examples"],
        },
      },
    },
    required: ["subtitles", "quiz_explanations", "info_sections", "vocabulary"],
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

C) INFO SECTIONS (${expectedSectionCount} required + 1 optional):
- One section per teaching point (section_type="grammar"), plus
- One "cultural" or "contextual_translation" section, plus
- Optionally one "common_mistakes" section when a clear L1-interference
  pattern exists (skip if none).

Depth must match the "${args.level}" level:
- beginner: Simple language, basic examples, focus on core concept. Avoid jargon.
- intermediate: More examples, compare structures, note common mistakes.
- advanced: Deep linguistic analysis, nuance, register, edge cases.

Each section has:
- section_type: "grammar" | "cultural" | "contextual_translation" | "extra_notes" | "common_mistakes"
- teaching_point_id: MUST be one of the TP UUIDs above for "grammar" sections. Null otherwise.
- title_en: Section title in English (short, scannable — e.g. "Should & Shouldn't", "Idiom: Out of the Blue").
- summary_en: One sentence hook shown under the title. Plain English, no markdown.
- grammar_label: UI badge for the section — one of:
    "idiom" | "phrase" | "tense" | "modal" | "verb-pattern" |
    "preposition" | "conditional" | "question" | "pronoun" | "adjective" | "other"
  Pick the most specific fit. Use "other" for cultural/contextual_translation sections.
- blocks: ORDERED ARRAY of structured content blocks (see block vocabulary below).
  The iOS client renders each block with its own UI — paragraph, heading, table,
  tip callout, video quote card, comparison table, etc. No markdown body anymore.

=== BLOCK VOCABULARY ===

Each block is { "type": "<kind>", ...fields }. Produce blocks in the order
the learner should read them (top-down on a mobile card). Always start with
a short "paragraph" opener, then mix in structured blocks, then close with a
"tip" / "warning" / "note".

Text-flow blocks:

{ "type": "paragraph", "text": "..." }
   Plain explanation. Keep under 2 sentences per paragraph; break long ideas
   into multiple paragraphs. Inline **bold** and *italics* are allowed inside
   text — the renderer parses them. No headings, no lists in the text field.

{ "type": "heading", "level": 2 | 3, "text": "..." }
   Sub-section label inside the card. level=2 for major sections, level=3 for
   sub-sections. Use sparingly — most cards don't need more than 1-2 headings.

{ "type": "bullet_list", "items": [ { "text": "..." }, { "text": "..." } ] }
{ "type": "numbered_list", "items": [ { "text": "..." }, ... ] }
   Lists of short points. Keep each item to one sentence, <15 words. Use
   numbered_list ONLY for ordered procedures ("First do X, then do Y").

{ "type": "table",
  "headers": ["Col A", "Col B"],
  "rows": [["cell", "cell"], ["cell", "cell"]]
}
   Summary/comparison tables. 2-4 columns, 2-6 rows max. Keep cells short.

{ "type": "divider" }
   Horizontal rule for breathing room between two unrelated sub-sections.

Callouts (iconed + colored):

{ "type": "tip",     "title": "...", "body": "..." }    // 💡 soft yellow
{ "type": "warning", "title": "...", "body": "..." }    // ⚠️ soft red
{ "type": "note",    "title": "...", "body": "..." }    // ℹ️ neutral gray
   title is OPTIONAL (omit if not useful). body is REQUIRED, 1-3 sentences.

Language-learning blocks (structured — DO NOT encode these inside paragraphs):

{ "type": "video_quote",
  "english": "EXACT quote from the dialog",
  "speaker": "Character name from the scene",
  "timestamp_sec": 3.4
}
   A shout-out to a specific moment in the video. REQUIRED for any grammar
   section that references the scene. Quote must be verbatim; speaker from
   the speaker mapping above. timestamp_sec optional if unknown.

{ "type": "example",
  "english": "He quit his job out of the blue.",
  "note": "Past tense is typical for sudden events." // OPTIONAL
}
   Single example sentence illustrating the teaching point. Keep under 12
   words. Don't add a translation field — phase 3 does that.

{ "type": "examples_group",
  "title": "More examples",   // optional group caption
  "items": [
    { "english": "An old friend texted me out of the blue." },
    { "english": "She called me out of the blue." }
  ]
}
   Use when you want 2-4 examples in a carousel/list. Prefer over multiple
   standalone example blocks when they share a theme.

{ "type": "formula",
  "formula": "Subject + should/shouldn't + verb (base)",
  "explanation": "The base form of the verb never takes 'to'."  // optional
}
   Formal grammar pattern. \`formula\` is rendered monospace, ideal for
   teaching point structures.

{ "type": "comparison",
  "title": "Should vs must vs have to",
  "comparison_rows": [
    { "label": "should",   "example": "You should rest.",  "nuance": "gentle advice" },
    { "label": "must",     "example": "You must leave.",   "nuance": "strong obligation, speaker-imposed" },
    { "label": "have to",  "example": "I have to go.",     "nuance": "obligation from external rule" }
  ]
}
   2-4 rows comparing closely-related structures. Prefer this over a plain
   table when explaining nuance differences.

{ "type": "common_mistake",
  "wrong":   "She did a decision.",
  "correct": "She made a decision.",
  "note":    "Use 'make' with decisions and plans."  // optional
}
   ❌/✅ pattern. IMPORTANT: the "wrong" form MUST NEVER appear in the actual
   video dialogue — only in this block as a warning.

{ "type": "phrase",
  "phrase": "out of the blue",
  "meaning": "unexpectedly, with no warning",
  "usage": "Usually past tense to describe a sudden event."   // optional
}
   Key phrase callout — headword + meaning + usage. One phrase block per key
   expression in the topic.

=== BLOCK USAGE RULES ===

- LLM, not human: decide how many blocks each section needs. A beginner
  grammar section is typically 4-7 blocks; advanced can be 6-10.
- Do not wrap examples inside paragraph text. Pull them out into dedicated
  example / examples_group blocks.
- Start every grammar section with: paragraph (1-2 sentences explaining the
  term) → formula (the pattern) → video_quote (from the scene).
- End every section with a tip/warning/note callout so the card has a
  visual closer. Never end on a bare paragraph.
- Cultural / contextual_translation sections should start with a short
  paragraph hook, include a video_quote, then explain with paragraphs +
  tip/note at the end.
- common_mistakes sections should lead with a paragraph explaining WHEN the
  mistake happens, then 1-3 common_mistake blocks, then a tip explaining
  the rule.
- Do NOT repeat video_quote blocks — one per section max.
- Every block MUST have a type field. Optional fields can be omitted.

D) SPEAKING PROMPTS (exactly 3) matched to "${args.level}" level:
1. prompt_type "repeat": A sentence from the video. Set expected_text to the exact sentence. prompt_text should instruct the user in English (e.g., "Repeat: ...").
2. prompt_type "repeat": Another sentence from the video. Set expected_text.
3. prompt_type "produce": A task asking the user to create their own sentence using the video's patterns.
   - beginner: Very guided with a template
   - intermediate: Moderately open
   - advanced: Fully open-ended
   Set context_hint for LLM evaluation, expected_text null.

E) VOCABULARY (3-6 items — most useful words/phrases the learner should
   walk away knowing after watching this scene):
- word: The word or short phrase AS IT APPEARS in the dialog ("neural link",
  "gotta", "grab a coffee"). Case-sensitive preservation not required —
  lowercase unless it's a proper noun.
- kind: One of
   * "basics"  → single common word ("coffee", "yesterday", "hungry")
   * "phrase"  → 2-4 word collocation ("neural link", "grab a coffee")
   * "idiom"   → figurative expression ("break the ice", "hit the road")
- phonetic: IPA transcription (e.g. "/ˈkɒf.i/", "/ɡɒt.ə/"). If you're not
  confident, omit the field — empty string is fine, we'd rather show nothing
  than mislead a beginner.
- meaning_en: One-sentence plain-English definition at "${args.level}" level
  depth. Beginner = 5-10 words. Advanced = can include nuance, register.
- examples_en: 1-2 short example sentences showing the word in use. At least
  one example MUST come from the video dialog verbatim if possible. Keep
  each example under 12 words.

PICKING vocabulary (this is the most important step — don't dump the whole
dictionary):
- Only pick items a learner at "${args.level}" wouldn't already know.
- Prefer items that appear in the DIALOG over generic curriculum words.
- If the scene uses slang/contractions (gonna, wanna, gotta) at beginner
  level, include them as "phrase" kind — learners need to decode them.
- Idioms trump literal phrases when both are present.
- Do NOT include function words (the, of, and), TP names, or things any
  second-year student already knows unless the register is unusual.

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
      "title_en": "Should & Shouldn't",
      "summary_en": "Give polite advice with a modal verb.",
      "grammar_label": "modal",
      "blocks": [
        { "type": "paragraph", "text": "**Should** and **shouldn't** are the go-to modal verbs for giving advice in English." },
        { "type": "formula", "formula": "Subject + should/shouldn't + verb (base form)" },
        { "type": "video_quote", "english": "You shouldn't buy those cheap parts.", "speaker": "Hacker", "timestamp_sec": 10.8 },
        { "type": "examples_group", "items": [
          { "english": "You should back up your data every night." },
          { "english": "He shouldn't use his neural-link in the rain." }
        ]},
        { "type": "tip", "title": "Never add 'to'", "body": "Say 'You should go', not 'You should to go'." }
      ]
    }
  ],
  "speaking_prompts": [
    {"prompt_type": "repeat", "prompt_text": "Repeat: ...", "expected_text": "...", "context_hint": null},
    {"prompt_type": "repeat", "prompt_text": "Repeat: ...", "expected_text": "...", "context_hint": null},
    {"prompt_type": "produce", "prompt_text": "...", "expected_text": null, "context_hint": "..."}
  ],
  "vocabulary": [
    {
      "word": "neural link",
      "kind": "phrase",
      "phonetic": "/ˈnʊr.əl lɪŋk/",
      "meaning_en": "A cybernetic connection between a brain and a computer.",
      "examples_en": ["You gotta fix your neural link.", "My neural link is glitching."]
    }
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
    info_sections: EnglishInfoSectionForTranslation[];
    vocabulary: { word: string; meaning_en: string; examples_en: string[] }[];
  };
}): string {
  const localeList = args.locales.map((l) => `${l} (${LOCALE_NAMES[l]})`).join(", ");
  const expectedSegCount = args.transcript.segments.length;
  const expectedQuizCount = args.english.quizzes.length;
  const expectedSectionCount = args.english.info_sections.length;
  const expectedVocabCount = args.english.vocabulary.length;

  return `You are a professional translator for TikTalk, a language-learning app. This is PHASE 3 — translate English content into the following ${args.locales.length} target languages: ${localeList}.

CRITICAL RULES:
- Translations must be NATURAL and CONVERSATIONAL, not literal Google Translate style.
- Use correct honorifics / formality appropriate to the speaker roles (e.g., customer-to-staff in Japanese/Korean formal, friends in casual).
- Preserve meaning, tone, and any cultural nuances.
- The "${args.level}" level matters: explanations and bodies should match that depth in each language.
- Return EXACTLY ${expectedSegCount} subtitle segments per locale (same count as English).
- Return EXACTLY ${expectedQuizCount} quiz explanations per locale.
- Return EXACTLY ${expectedSectionCount} info sections per locale; each section's "blocks" array MUST have the same length and SAME TYPES in the same order as the English blocks.
- Return EXACTLY ${expectedVocabCount} vocabulary entries per locale (same order).

=== CONTEXT ===
Channel: ${args.channelName}
Level: ${args.level}
Speakers: ${args.speakerMapping.map((s) => `${s.id}=${s.role}`).join(", ") || "unknown"}

=== ENGLISH SUBTITLE SEGMENTS (to translate) ===
${JSON.stringify(args.transcript.segments)}

=== ENGLISH QUIZ EXPLANATIONS (to translate) ===
${args.english.quizzes.map((q, i) => `Quiz ${i + 1}: ${q.explanation_en}`).join("\n")}

=== ENGLISH INFO SECTIONS (to translate, structured blocks) ===
${JSON.stringify(args.english.info_sections, null, 2)}

=== ENGLISH VOCABULARY (to translate — keep the "word" itself in English, only translate meaning + examples) ===
${args.english.vocabulary.map((v, i) => `Vocab ${i + 1}: word="${v.word}"\n  meaning: ${v.meaning_en}\n  examples: ${v.examples_en.map((e) => `"${e}"`).join(" | ")}`).join("\n\n")}

=== INFO SECTION TRANSLATION RULES (per block type) ===

For each section, produce { title, summary, blocks }. The blocks array MUST
mirror the English blocks 1:1 — same length, same type at each index. For
each block, include ONLY the fields listed here:

- paragraph:   { type, text }
- heading:     { type, text }
- bullet_list: { type, items: [{text}] }  — same item count
- numbered_list: same as bullet_list
- table:       { type, headers: [...], rows: [[...]] }  — same dimensions
- divider:     { type }  — nothing to translate
- tip | warning | note:  { type, title?, body }
- video_quote: { type, translation }  — do NOT translate "english", "speaker", "timestamp_sec"
- example:     { type, translation, note? }  — do NOT translate "english"
- examples_group: { type, title?, items: [{translation, note?}] }  — english stays
- formula:     { type, explanation? }  — "formula" itself stays English (pattern is language-neutral)
- comparison:  { type, title?, comparison_rows: [{label, example_translation, nuance?}] }
               — "label" often the same across languages (e.g. "should" stays "should" in Turkish
               explanation). Translate when natural (e.g. "hasta" instead of "sick"). Always translate
               the English example into example_translation.
- common_mistake: { type, note? }  — "wrong" and "correct" MUST stay English (they're the teaching
                    point's English forms)
- phrase:      { type, meaning, usage? }  — "phrase" stays English

Unknown/new block types: keep { type, text } with a best-effort translation
of any English text you can infer.

=== TASK ===

For each of the ${args.locales.length} locales (${args.locales.join(", ")}), produce:
1) subtitles: array of ${expectedSegCount} segments. Keep start/end/speaker unchanged from English. Only translate "text".
2) quiz_explanations: array of ${expectedQuizCount} translated explanation strings (in order).
3) info_sections: array of ${expectedSectionCount} {title, summary, blocks} objects (in order).
4) vocabulary: array of ${expectedVocabCount} {meaning, examples[]} objects (in order, same item count as English). Keep the English "word" untouched — we translate only the meaning + examples.

=== OUTPUT FORMAT ===

Return raw JSON (no markdown):
{
  "translations": {
    "${args.locales[0]}": {
      "subtitles": [{"start": 1.64, "end": 3.34, "text": "...", "speaker": "Speaker 0"}],
      "quiz_explanations": ["...", "...", "..."],
      "info_sections": [
        {
          "title": "Should ve Shouldn't",
          "summary": "Modal fiille nazik tavsiye verme.",
          "blocks": [
            { "type": "paragraph", "text": "..." },
            { "type": "formula",   "explanation": "..." },
            { "type": "video_quote", "translation": "..." },
            { "type": "examples_group", "items": [{ "translation": "..." }, { "translation": "..." }] },
            { "type": "tip", "title": "...", "body": "..." }
          ]
        }
      ],
      "vocabulary": [{"meaning": "...", "examples": ["...", "..."]}]
    },
    "${args.locales[1]}": { ... },
    "${args.locales[2]}": { ... }
  }
}`;
}

// Shape passed into buildTranslationPrompt. Mirrors English info_sections
// but with _en suffix stripped — the prompt serializes this to JSON.
type EnglishInfoSectionForTranslation = {
  title: string;
  summary: string;
  blocks: Record<string, unknown>[];
};

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
    if (!sec.title_en || typeof sec.title_en !== "string") return "Info section missing title_en";
    if (!sec.summary_en || typeof sec.summary_en !== "string") return "Info section missing summary_en";
    if (!VALID_GRAMMAR_LABELS.includes(sec.grammar_label as string)) return `Invalid grammar_label: ${sec.grammar_label}`;
    if (!Array.isArray(sec.blocks) || sec.blocks.length === 0) return "Info section missing blocks";
    for (let bi = 0; bi < (sec.blocks as unknown[]).length; bi++) {
      const b = (sec.blocks as Record<string, unknown>[])[bi];
      if (!b || typeof b.type !== "string" || !VALID_BLOCK_TYPES.includes(b.type)) {
        return `Info section block[${bi}] has invalid type: ${b?.type}`;
      }
    }
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

  const vocab = result.vocabulary;
  if (!Array.isArray(vocab) || vocab.length < 3 || vocab.length > 6) {
    return `Expected 3-6 vocabulary items, got ${Array.isArray(vocab) ? vocab.length : 0}`;
  }
  for (const v of vocab as Record<string, unknown>[]) {
    if (!v.word || typeof v.word !== "string") return "Vocab item missing word";
    if (!VALID_VOCAB_KINDS.includes(v.kind as string)) return `Invalid vocab kind: ${v.kind}`;
    if (!v.meaning_en || typeof v.meaning_en !== "string") return "Vocab item missing meaning_en";
    if (!Array.isArray(v.examples_en) || v.examples_en.length === 0) return "Vocab item missing examples_en";
  }

  return null;
}

function validateTranslationBatch(
  batch: Record<string, unknown>,
  locales: string[],
  expectedSegCount: number,
  expectedQuizCount: number,
  expectedSectionCount: number,
  expectedVocabCount: number
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
    for (let si = 0; si < (secs as unknown[]).length; si++) {
      const s = (secs as Record<string, unknown>[])[si];
      if (!s.title || typeof s.title !== "string") return `${loc}: info section[${si}] missing title`;
      if (!s.summary || typeof s.summary !== "string") return `${loc}: info section[${si}] missing summary`;
      if (!Array.isArray(s.blocks)) return `${loc}: info section[${si}] missing blocks`;
      // block count must match the English shape so indexed zip works later.
      // The caller passes expectedBlockCounts so we can enforce this.
    }

    const vocab = entry.vocabulary;
    if (!Array.isArray(vocab) || vocab.length !== expectedVocabCount) {
      return `${loc}: expected ${expectedVocabCount} vocabulary entries, got ${Array.isArray(vocab) ? vocab.length : 0}`;
    }
    for (const v of vocab) {
      const o = v as Record<string, unknown>;
      if (typeof o.meaning !== "string" || !o.meaning) return `${loc}: vocab entry missing meaning`;
      if (!Array.isArray(o.examples)) return `${loc}: vocab entry missing examples`;
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
      summary_en: string;
      grammar_label: string;
      blocks: Record<string, unknown>[];
    }[];
    speaking_prompts: {
      prompt_type: string;
      prompt_text: string;
      expected_text: string | null;
      context_hint: string | null;
    }[];
    vocabulary: {
      word: string;
      kind: string;
      phonetic?: string;
      meaning_en: string;
      examples_en: string[];
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
      // Disable thinking entirely. Phase 2 is structured + mechanical —
      // the schema + block vocab do the "planning", no CoT needed. Every
      // thinking token is one less token for the JSON payload, and even
      // MINIMAL was eating enough on 3-flash-preview to trigger MAX_TOKENS
      // truncation on lessons with 4+ info sections + vocab + quizzes.
      thinkingBudget: 0,
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

  type TranslatedBlock = Record<string, unknown>;
  type TranslatedInfoSection = {
    title: string;
    summary: string;
    blocks: TranslatedBlock[];
  };
  type TranslationEntry = {
    subtitles: { start: number; end: number; text: string; speaker?: string }[];
    quiz_explanations: string[];
    info_sections: TranslatedInfoSection[];
    vocabulary: { meaning: string; examples: string[] }[];
  };
  type TranslationBatchResponse = {
    translations: Record<string, TranslationEntry>;
  };

  const expectedSegCount = transcript.segments?.length || 0;
  const expectedQuizCount = english.quizzes.length;
  const expectedSectionCount = english.info_sections.length;
  const expectedVocabCount = english.vocabulary.length;

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
          info_sections: english.info_sections.map((s) => ({
            title: s.title_en,
            summary: s.summary_en,
            blocks: s.blocks,
          })),
          vocabulary: english.vocabulary.map((v) => ({
            word: v.word,
            meaning_en: v.meaning_en,
            examples_en: v.examples_en,
          })),
        },
      }),
      temperature: 0.3,
      maxOutputTokens: 65536,
      schema: buildTranslationSchema(batchLocales, {
        subtitles: expectedSegCount,
        quizExplanations: expectedQuizCount,
        infoSections: expectedSectionCount,
        vocabulary: expectedVocabCount,
      }),
    });

    // Gemini still occasionally ignores minItems/maxItems on nested arrays
    // and returns one extra entry. Trim any over-count before validation so
    // a single-locale drift doesn't torpedo the whole batch.
    if (batchResult?.translations) {
      for (const loc of batchLocales) {
        const entry = batchResult.translations[loc];
        if (!entry) continue;
        if (Array.isArray(entry.subtitles) && entry.subtitles.length > expectedSegCount) {
          entry.subtitles.length = expectedSegCount;
        }
        if (Array.isArray(entry.quiz_explanations) && entry.quiz_explanations.length > expectedQuizCount) {
          entry.quiz_explanations.length = expectedQuizCount;
        }
        if (Array.isArray(entry.info_sections) && entry.info_sections.length > expectedSectionCount) {
          entry.info_sections.length = expectedSectionCount;
        }
        if (Array.isArray(entry.vocabulary) && entry.vocabulary.length > expectedVocabCount) {
          entry.vocabulary.length = expectedVocabCount;
        }
      }
    }

    const validationErr = validateTranslationBatch(
      batchResult as unknown as Record<string, unknown>,
      batchLocales,
      expectedSegCount,
      expectedQuizCount,
      expectedSectionCount,
      expectedVocabCount
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

  // Build a lang map from an English string + per-locale translations.
  // Helper used all over the block assembly below — we store every
  // translatable field as a {en, tr, ja, ...} lang map so the backend
  // LocalizeInPlace walker collapses it at read time.
  const buildLangMap = (enValue: string, pickFromTranslated: (tr: Record<string, unknown>) => unknown): Record<string, string> => {
    const out: Record<string, string> = { en: enValue };
    for (const loc of LOCALES) {
      const tr = allTranslations[loc].info_sections as Record<string, unknown>[] | undefined;
      // Placeholder — actual per-section lookup happens inline below.
      out[loc] = ""; // will be overwritten by caller
      void pickFromTranslated; void tr;
    }
    return out;
  };
  void buildLangMap; // kept for reference; assembly uses inline construction

  // Assemble localized blocks. Every English block produces one output
  // block where each translatable field is a {en, tr, ja, ...} lang map;
  // LocalizeInPlace handles the collapse on read.
  //
  // We walk the English block + same-indexed translated block (per locale)
  // and merge. Unknown fields pass through unchanged.
  const assembleBlock = (enBlock: Record<string, unknown>, translatedPerLoc: Record<string, Record<string, unknown> | undefined>): Record<string, unknown> => {
    const type = String(enBlock.type || "");
    const out: Record<string, unknown> = { type };

    // Generic helper: produces a lang map from field name `field` across
    // en + all locale translations. Returns undefined if none are strings.
    const langMap = (field: string): Record<string, string> | undefined => {
      const enVal = enBlock[field];
      if (typeof enVal !== "string" || enVal === "") return undefined;
      const map: Record<string, string> = { en: enVal };
      for (const loc of LOCALES) {
        const v = translatedPerLoc[loc]?.[field];
        map[loc] = typeof v === "string" ? v : "";
      }
      return map;
    };

    switch (type) {
      case "paragraph": {
        const t = langMap("text"); if (t) out.text = t;
        if (enBlock.fallback_text) out.fallbackText = enBlock.fallback_text;
        break;
      }
      case "heading": {
        const t = langMap("text"); if (t) out.text = t;
        if (typeof enBlock.level === "number") out.level = enBlock.level;
        break;
      }
      case "bullet_list":
      case "numbered_list": {
        const enItems = Array.isArray(enBlock.items) ? (enBlock.items as Record<string, unknown>[]) : [];
        out.items = enItems.map((enItem, idx) => {
          const enText = typeof enItem.text === "string" ? enItem.text : "";
          const text: Record<string, string> = { en: enText };
          for (const loc of LOCALES) {
            const trItems = translatedPerLoc[loc]?.items as Record<string, unknown>[] | undefined;
            const trItem = trItems?.[idx];
            const v = trItem?.text;
            text[loc] = typeof v === "string" ? v : "";
          }
          return { text };
        });
        break;
      }
      case "table": {
        // Headers + rows are native-only. Store each cell as a lang map.
        const enHeaders = Array.isArray(enBlock.headers) ? (enBlock.headers as string[]) : [];
        out.headers = enHeaders.map((enHdr, idx) => {
          const text: Record<string, string> = { en: enHdr };
          for (const loc of LOCALES) {
            const trHeaders = translatedPerLoc[loc]?.headers as string[] | undefined;
            text[loc] = typeof trHeaders?.[idx] === "string" ? trHeaders[idx] : "";
          }
          return { text };
        });
        const enRows = Array.isArray(enBlock.rows) ? (enBlock.rows as string[][]) : [];
        out.rows = enRows.map((enRow, ri) =>
          enRow.map((enCell, ci) => {
            const text: Record<string, string> = { en: enCell };
            for (const loc of LOCALES) {
              const trRows = translatedPerLoc[loc]?.rows as string[][] | undefined;
              text[loc] = typeof trRows?.[ri]?.[ci] === "string" ? trRows[ri][ci] : "";
            }
            return { text };
          })
        );
        break;
      }
      case "divider":
        break;
      case "tip":
      case "warning":
      case "note": {
        const t = langMap("title"); if (t) out.title = t;
        const b = langMap("body"); if (b) out.body = b;
        break;
      }
      case "video_quote": {
        if (typeof enBlock.english === "string") out.english = enBlock.english;
        if (typeof enBlock.speaker === "string") out.speaker = enBlock.speaker;
        if (typeof enBlock.timestamp_sec === "number") out.timestampSec = enBlock.timestamp_sec;
        const translations: Record<string, string> = {};
        for (const loc of LOCALES) {
          const v = translatedPerLoc[loc]?.translation;
          translations[loc] = typeof v === "string" ? v : "";
        }
        out.translations = translations;
        break;
      }
      case "example": {
        if (typeof enBlock.english === "string") out.english = enBlock.english;
        const translations: Record<string, string> = {};
        for (const loc of LOCALES) {
          const v = translatedPerLoc[loc]?.translation;
          translations[loc] = typeof v === "string" ? v : "";
        }
        out.translations = translations;
        const note = langMap("note"); if (note) out.note = note;
        break;
      }
      case "examples_group": {
        const title = langMap("title"); if (title) out.title = title;
        const enItems = Array.isArray(enBlock.items) ? (enBlock.items as Record<string, unknown>[]) : [];
        out.items = enItems.map((enItem, idx) => {
          const item: Record<string, unknown> = {};
          if (typeof enItem.english === "string") item.english = enItem.english;
          const translations: Record<string, string> = {};
          for (const loc of LOCALES) {
            const trItems = translatedPerLoc[loc]?.items as Record<string, unknown>[] | undefined;
            const v = trItems?.[idx]?.translation;
            translations[loc] = typeof v === "string" ? v : "";
          }
          item.translations = translations;
          if (typeof enItem.note === "string" && enItem.note) {
            const note: Record<string, string> = { en: enItem.note };
            for (const loc of LOCALES) {
              const trItems = translatedPerLoc[loc]?.items as Record<string, unknown>[] | undefined;
              const v = trItems?.[idx]?.note;
              note[loc] = typeof v === "string" ? v : "";
            }
            item.note = note;
          }
          return item;
        });
        break;
      }
      case "formula": {
        if (typeof enBlock.formula === "string") out.formula = enBlock.formula;
        const explanation = langMap("explanation"); if (explanation) out.explanation = explanation;
        break;
      }
      case "comparison": {
        const title = langMap("title"); if (title) out.title = title;
        const enRows = Array.isArray(enBlock.comparison_rows) ? (enBlock.comparison_rows as Record<string, unknown>[]) : [];
        out.rows = enRows.map((enRow, idx) => {
          const row: Record<string, unknown> = {};
          if (typeof enRow.label === "string") {
            const label: Record<string, string> = { en: enRow.label };
            for (const loc of LOCALES) {
              const trRows = translatedPerLoc[loc]?.comparison_rows as Record<string, unknown>[] | undefined;
              const v = trRows?.[idx]?.label;
              label[loc] = typeof v === "string" && v ? v : enRow.label as string; // labels often pass through
            }
            row.label = label;
          }
          if (typeof enRow.example === "string") row.example = enRow.example;
          const exampleTranslations: Record<string, string> = {};
          for (const loc of LOCALES) {
            const trRows = translatedPerLoc[loc]?.comparison_rows as Record<string, unknown>[] | undefined;
            const v = trRows?.[idx]?.example_translation;
            exampleTranslations[loc] = typeof v === "string" ? v : "";
          }
          row.exampleTranslations = exampleTranslations;
          if (typeof enRow.nuance === "string") {
            const nuance: Record<string, string> = { en: enRow.nuance };
            for (const loc of LOCALES) {
              const trRows = translatedPerLoc[loc]?.comparison_rows as Record<string, unknown>[] | undefined;
              const v = trRows?.[idx]?.nuance;
              nuance[loc] = typeof v === "string" ? v : "";
            }
            row.nuance = nuance;
          }
          return row;
        });
        break;
      }
      case "common_mistake": {
        if (typeof enBlock.wrong === "string") out.wrong = enBlock.wrong;
        if (typeof enBlock.correct === "string") out.correct = enBlock.correct;
        const note = langMap("note"); if (note) out.note = note;
        break;
      }
      case "phrase": {
        if (typeof enBlock.phrase === "string") out.phrase = enBlock.phrase;
        const meaning = langMap("meaning"); if (meaning) out.meaning = meaning;
        const usage = langMap("usage"); if (usage) out.usage = usage;
        break;
      }
      default:
        // Unknown type: keep the raw shape so iOS can render a text fallback.
        return enBlock;
    }
    return out;
  };

  const topicsJson = english.info_sections.map((sec, i) => {
    const title: Record<string, string> = { en: sec.title_en };
    const summary: Record<string, string> = { en: sec.summary_en };
    for (const loc of LOCALES) {
      const entry = allTranslations[loc].info_sections[i];
      title[loc] = entry?.title ?? "";
      summary[loc] = entry?.summary ?? "";
    }

    const enBlocks = Array.isArray(sec.blocks) ? sec.blocks : [];
    const blocksOut = enBlocks.map((enBlock, bi) => {
      const translatedPerLoc: Record<string, Record<string, unknown> | undefined> = {};
      for (const loc of LOCALES) {
        const trBlocks = allTranslations[loc].info_sections[i]?.blocks as Record<string, unknown>[] | undefined;
        translatedPerLoc[loc] = trBlocks?.[bi];
      }
      return assembleBlock(enBlock, translatedPerLoc);
    });

    return {
      id: `t-${i}`,
      kind: SECTION_KIND_MAP[sec.section_type] || sec.section_type,
      grammarLabel: sec.grammar_label,
      teachingPointId: sec.teaching_point_id || null,
      title,
      summary,
      blocks: blocksOut,
    };
  });

  const speakPromptsJson = english.speaking_prompts.map((sp, i) => ({
    id: `sp-${i}`,
    kind: sp.prompt_type,
    promptText: sp.prompt_text,
    expectedText: sp.expected_text,
    contextHint: sp.context_hint,
  }));

  // Vocabulary shape uses the plural "meanings" + "translations" keys so
  // backend's LocalizeInPlace collapses them at read time based on
  // Accept-Language (pluralToSingular: meanings→meaning, translations→translation).
  const vocabularyJson = english.vocabulary.map((v, i) => {
    const meanings: Record<string, string> = { en: v.meaning_en };
    for (const loc of LOCALES) {
      meanings[loc] = allTranslations[loc].vocabulary[i]?.meaning ?? "";
    }
    const examples = v.examples_en.map((ex, j) => {
      const translations: Record<string, string> = {};
      for (const loc of LOCALES) {
        translations[loc] = allTranslations[loc].vocabulary[i]?.examples?.[j] ?? "";
      }
      return { text: ex, translations };
    });
    return {
      id: `v-${i}`,
      word: v.word,
      kind: v.kind,
      phonetic: v.phonetic || "",
      meanings,
      examples,
    };
  });

  const infoJson = {
    topics: topicsJson,
    speakPrompts: speakPromptsJson,
    vocabulary: vocabularyJson,
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

"use client";

import { useState } from "react";

// ═══════════════════════════════════════════════════════════════
// PROMPT DEFINITIONS
// ═══════════════════════════════════════════════════════════════

type Variable = {
  key: string;
  source: string;
  description: string;
};

type PromptDef = {
  id: string;
  title: string;
  phase: string;
  route: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  thinkingLevel: string | null;
  template: string;
  variables: Variable[];
  outputSchema: string;
};

const PROMPTS: PromptDef[] = [
  // ── GENERATE ──────────────────────────────────────────────
  {
    id: "generate",
    title: "Seedance Prompt Üretimi",
    phase: "Phase 0",
    route: "/api/generate",
    model: "gemini-3-flash-preview",
    temperature: 1.2,
    maxOutputTokens: 65536,
    thinkingLevel: "HIGH",
    template: `You are a content planner for TikTalk, a social-media style language learning app that teaches English through 15-second AI-generated video scenes. Users scroll a TikTok-like feed and learn English passively/actively.

=== INPUT ===

CHANNEL: "{channel_name}"
CHANNEL DESCRIPTION: {channel_description}
TARGET LEVEL: {level}
LEVEL GUIDANCE: {level_guidance}
VIBES: {vibe_names}
VIBE STYLE HINTS: {vibe_hints}

AVAILABLE TEACHING POINTS for this level (format: [id] category: name — usage/5 videos):
{tp_list}

IMPORTANT: Prefer TPs with fewer existing videos (lower usage count). TPs with 0 videos must be prioritized over 3-4 count TPs. This ensures even coverage.

=== TASK ===

1) Pick 1-4 teaching points that naturally fit together in a single 15-second scene. They must all make sense in the same conversation. Don't force unrelated TPs together.

2) Write a Seedance video generation prompt for a cinematic 15-second scene.

HARD CONSTRAINTS for the scene:
- Exactly 2 speakers (no monologues, no crowds)
- Total dialogue: 25-40 English words (must fit 15 seconds of natural speech)
- Maximum 4 dialogue turns (2 lines per speaker)
- Real-world everyday scenario matching the channel + vibes
- Dialogue must naturally use the selected TPs — don't shoehorn
- Level-appropriate vocabulary (see LEVEL GUIDANCE above)

Seedance prompt should include:
- Scene setting (location, lighting, mood)
- Both characters with brief descriptions (who they are — e.g., "a tired barista", "a curious tourist")
- Camera direction (medium shot, close-up, etc.)
- Embedded dialogue with clear speaker labels:
  Character A: "line 1"
  Character B: "line 2"

3) Write a Turkish "reasoning" explaining why these specific TPs and this scene work together for this level.

=== EXAMPLE (for a coffee shop channel, beginner level, casual vibe) ===

{
  "selected_tp_ids": ["<uuid-1>", "<uuid-2>"],
  "seedance_prompt": "Medium shot inside a warm, sunlit coffee shop in the morning...",
  "reasoning": "Seçilen TP'ler temel sipariş kalıplarını öğretiyor..."
}

=== YOUR OUTPUT ===

Return ONLY raw JSON matching the schema. No markdown, no code blocks, no commentary.`,
    variables: [
      { key: "channel_name", source: "DB → channels.name", description: "Kanalın adı (ör: 'Coffee Shop Conversations')" },
      { key: "channel_description", source: "DB → channels.description", description: "Kanalın açıklaması, yoksa '(no description)'" },
      { key: "level", source: "UI seçimi", description: "Seviye: beginner / intermediate / advanced" },
      { key: "level_guidance", source: "Sabit map", description: "Seviyeye göre dil rehberi (A1-A2, B1-B2, C1-C2)" },
      { key: "vibe_names", source: "DB → vibes.name", description: "Seçili vibe isimleri virgülle birleştirilmiş" },
      { key: "vibe_hints", source: "DB → vibes.prompt_hint", description: "Vibe stil ipuçları, | ile ayrılmış" },
      { key: "tp_list", source: "DB → teaching_points + pool_item_tps COUNT", description: "Seviyeye uygun TP'ler: [uuid] category: name — usage_count/5 formatında, her biri yeni satırda" },
    ],
    outputSchema: `{
  "selected_tp_ids": ["uuid-1", "uuid-2"],
  "seedance_prompt": "Scene description + dialogue...",
  "reasoning": "Türkçe açıklama..."
}`,
  },

  // ── PHASE 1: MATCH ────────────────────────────────────────
  {
    id: "match",
    title: "Match Check + Speaker Mapping",
    phase: "Phase 1",
    route: "/api/content",
    model: "gemini-3-flash-preview",
    temperature: 0.2,
    maxOutputTokens: 8192,
    thinkingLevel: null,
    template: `You are a QA reviewer for TikTalk, a language-learning app. Your only job is STEP 1: decide if the spoken dialogue matches what the seedance prompt intended.

=== SEEDANCE PROMPT (what was intended) ===
{seedance_prompt}

=== WHISPER TRANSCRIPT (what was actually spoken) ===
{transcript_full_text}

=== TRANSCRIPT SEGMENTS ({segment_count} segments) ===
{transcript_segments_indexed}

Duration: {transcript_duration}s
Channel: {channel_name}
Level: {level}
Teaching points: {tp_names}

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
      - "name": The character name from the seedance prompt. If the prompt uses descriptions, use a short label like "Barista".
      - "role": The character's role in the scene.

   b) "corrected_speakers": An array with EXACTLY {segment_count} entries (one per transcript segment, in order).
      Each entry is the character NAME who actually spoke that segment.
      IMPORTANT: Whisper often assigns the same speaker label to both characters (e.g., all "Speaker 0").
      Analyze the DIALOGUE CONTENT to figure out who said what — compare with the seedance prompt.

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

If match is false, speaker_mapping and corrected_speakers can be empty. Be strict — only set match=true if the TPs are actually present in the dialogue.`,
    variables: [
      { key: "seedance_prompt", source: "DB → pool_items.seedance_prompt", description: "Phase 0'da üretilen seedance prompt'u" },
      { key: "transcript_full_text", source: "DB → pool_items.transcript.full_text", description: "Whisper'dan gelen tam transkript metni" },
      { key: "transcript_segments_indexed", source: "DB → pool_items.transcript.segments", description: "Her segment indexli: '[0] Speaker 0: \"Hello!\"' formatında" },
      { key: "segment_count", source: "Hesaplanan", description: "transcript.segments.length — toplam segment sayısı" },
      { key: "transcript_duration", source: "DB → pool_items.transcript.duration", description: "Video süresi (saniye)" },
      { key: "channel_name", source: "DB → channels.name", description: "Kanalın adı" },
      { key: "level", source: "DB → pool_items.level", description: "Pool item seviyesi" },
      { key: "tp_names", source: "DB → teaching_points (JOIN)", description: "TP'ler: 'category:name' formatında virgülle birleştirilmiş" },
    ],
    outputSchema: `{
  "match": true/false,
  "match_score": 0.0-1.0,
  "match_reason": "Türkçe açıklama",
  "speaker_mapping": {
    "speakers": [{"id": "Speaker 0", "name": "John", "role": "barista"}, ...]
  },
  "corrected_speakers": ["John", "Betty", "John", "Betty"]
}`,
  },

  // ── PHASE 2: ENGLISH ──────────────────────────────────────
  {
    id: "english",
    title: "English Content Üretimi",
    phase: "Phase 2",
    route: "/api/content",
    model: "gemini-3-flash-preview",
    temperature: 0.6,
    maxOutputTokens: 65536,
    thinkingLevel: "MEDIUM",
    template: `You are a content generator for TikTalk, a social-media style language learning app. This is PHASE 2 of 3 — you generate ALL English-language content for a single video. Translations are handled separately in phase 3, so DO NOT translate anything here. English only.

=== CONTEXT ===

CHANNEL: "{channel_name}"
CHANNEL DESCRIPTION: {channel_description}
LEVEL: {level}
VIBES: {vibe_names}

SEEDANCE PROMPT (what was filmed):
{seedance_prompt}

TEACHING POINTS in this video:
{tp_details}

WHISPER TRANSCRIPT:
{transcript_full_text}

SPEAKER ROLES (identified in phase 1):
{speaker_mapping}

=== TASK ===

A) METADATA:
- title: Short, catchy English title (5-8 words). Make it feed-friendly, hook-worthy.
- description: 1-2 sentences + 3-5 hashtags. Written for a TikTok-style feed.
- slug: URL-friendly (lowercase, hyphens). Descriptive and distinctive.
- keywords: 5-10 English learning keywords from the dialogue.

B) QUIZZES (exactly 3):
Difficulty MUST match the "{level}" level.
- beginner: Simple direct questions. Short options. Test basic comprehension.
- intermediate: Contextual distractors. Test grammar patterns.
- advanced: Inference questions. Subtle distinctions, idioms, tone.

Each quiz has:
- quiz_type: "comprehension" | "grammar" | "vocabulary" (prefer 3 different types)
- question: English
- options: Exactly 4 English choices
- correct_index: 0-3
- explanation_en: English explanation of WHY the correct answer is right.

C) INFO SECTIONS ({expected_section_count} required + 1 optional):
One "grammar" per TP + one "cultural" or "contextual_translation", optionally one "common_mistakes".
Depth must match the "{level}" level.

Each section has:
- section_type: "grammar" | "cultural" | "contextual_translation" | "extra_notes" | "common_mistakes"
- teaching_point_id: MUST be one of the TP UUIDs above for "grammar" sections. Null otherwise.
- title_en: Section title in English
- body_en: Rich markdown for mobile display (see format below).

GRAMMAR SECTION body format:
  **[Key term]** — one sentence explanation.
  **Pattern:** \`Subject + can + verb + object\`
  **From the video:**
  > *Speaker: "Exact quote"*
  **Examples:** (bullet list, 2-4 items)
  **Tip:** practical usage note.

COMMON_MISTAKES body format:
  ❌ **Wrong:** \`incorrect form\`
  ✅ **Correct:** \`correct form\`
  (2-3 pairs + **Why:** explanation)

CULTURAL body format:
  **[Insight]** — hook sentence.
  **In the video:** > *Speaker: "quote"*
  **What this means:** cultural context.
  **In practice:** when/where used.

RULES: Always use **bold** for labels, \`code\` for patterns, > blockquote for video refs, - lists for examples. Never plain paragraphs.

D) SPEAKING PROMPTS (exactly 3) matched to "{level}" level:
1. prompt_type "repeat": A sentence from the video + expected_text.
2. prompt_type "repeat": Another sentence + expected_text.
3. prompt_type "produce": User creates own sentence using video's patterns.

=== OUTPUT FORMAT ===

Return raw JSON (no markdown, no code blocks).`,
    variables: [
      { key: "channel_name", source: "DB → channels.name", description: "Kanalın adı" },
      { key: "channel_description", source: "DB → channels.description", description: "Kanalın açıklaması" },
      { key: "level", source: "DB → pool_items.level", description: "Pool item seviyesi" },
      { key: "vibe_names", source: "DB → vibes.name (JOIN)", description: "Seçili vibe isimleri virgülle birleştirilmiş" },
      { key: "seedance_prompt", source: "DB → pool_items.seedance_prompt", description: "Phase 0'da üretilen seedance prompt'u" },
      { key: "tp_details", source: "DB → teaching_points (JOIN)", description: "Her TP: [uuid] category: name — description formatında, satır satır" },
      { key: "transcript_full_text", source: "DB → pool_items.transcript.full_text", description: "Whisper'dan gelen tam transkript metni" },
      { key: "speaker_mapping", source: "Phase 1 çıktısı", description: "Phase 1'de belirlenen konuşmacı rolleri: 'Speaker 0 → barista' formatında" },
      { key: "expected_section_count", source: "Hesaplanan", description: "tp_count + 1 (her TP için 1 grammar + 1 cultural/contextual)" },
    ],
    outputSchema: `{
  "title": "...",
  "slug": "ordering-coffee-beginner",
  "description": "... #tag1 #tag2",
  "keywords": ["coffee", "order"],
  "quizzes": [{ quiz_type, question, options[4], correct_index, explanation_en }],
  "info_sections": [{ section_type, teaching_point_id, title_en, body_en }],
  "speaking_prompts": [{ prompt_type, prompt_text, expected_text, context_hint }]
}`,
  },

  // ── PHASE 3: TRANSLATION ─────────────────────────────────
  {
    id: "translation",
    title: "Çeviri (x4 batch paralel)",
    phase: "Phase 3",
    route: "/api/content",
    model: "gemini-3-flash-preview",
    temperature: 0.3,
    maxOutputTokens: 65536,
    thinkingLevel: null,
    template: `You are a professional translator for TikTalk, a language-learning app. This is PHASE 3 — translate English content into the following {batch_locale_count} target languages: {batch_locale_list}.

CRITICAL RULES:
- Translations must be NATURAL and CONVERSATIONAL, not literal Google Translate style.
- Use correct honorifics / formality appropriate to the speaker roles.
- Preserve meaning, tone, and any cultural nuances.
- The "{level}" level matters: explanations should match that depth in each language.
- Return EXACTLY {expected_seg_count} subtitle segments per locale (same count as English).
- Return EXACTLY {expected_quiz_count} quiz explanations per locale.
- Return EXACTLY {expected_section_count} info section entries per locale.

=== CONTEXT ===
Channel: {channel_name}
Level: {level}
Speakers: {speaker_roles}

=== ENGLISH SUBTITLE SEGMENTS (to translate) ===
{transcript_segments_json}

=== ENGLISH QUIZ EXPLANATIONS (to translate) ===
{quiz_explanations}

=== ENGLISH INFO SECTIONS (to translate) ===
{info_sections_english}

=== TASK ===

For each of the {batch_locale_count} locales ({batch_locales}), produce:
1) subtitles: array of {expected_seg_count} segments. Keep start/end/speaker unchanged. Only translate "text".
2) quiz_explanations: array of {expected_quiz_count} translated explanation strings (in order).
3) info_sections: array of {expected_section_count} {title, body} objects (in order). Body is markdown.

=== OUTPUT FORMAT ===

Return raw JSON (no markdown):
{
  "translations": {
    "locale_1": { subtitles, quiz_explanations, info_sections },
    "locale_2": { ... },
    "locale_3": { ... }
  }
}`,
    variables: [
      { key: "batch_locale_count", source: "Sabit: 3", description: "Her batch'te 3 dil" },
      { key: "batch_locale_list", source: "Sabit batch dizileri", description: "Batch dilleri: ör. 'tr (Turkish), pt-BR (Brazilian Portuguese), es (Spanish)'" },
      { key: "batch_locales", source: "Sabit batch dizileri", description: "Kısa format: 'tr, pt-BR, es'" },
      { key: "level", source: "DB → pool_items.level", description: "Pool item seviyesi" },
      { key: "channel_name", source: "DB → channels.name", description: "Kanalın adı" },
      { key: "speaker_roles", source: "Phase 1 çıktısı", description: "Konuşmacı rolleri: 'Speaker 0=barista, Speaker 1=customer'" },
      { key: "transcript_segments_json", source: "DB → pool_items.transcript.segments", description: "İngilizce altyazı segmentleri JSON array olarak" },
      { key: "quiz_explanations", source: "Phase 2 çıktısı", description: "İngilizce quiz açıklamaları: 'Quiz 1: ...' formatında satır satır" },
      { key: "info_sections_english", source: "Phase 2 çıktısı", description: "İngilizce info section'lar: title + body, satır satır" },
      { key: "expected_seg_count", source: "Hesaplanan", description: "transcript.segments.length — İngilizce segment sayısı" },
      { key: "expected_quiz_count", source: "Hesaplanan", description: "english.quizzes.length — Quiz sayısı (3)" },
      { key: "expected_section_count", source: "Hesaplanan", description: "english.info_sections.length — Info section sayısı" },
    ],
    outputSchema: `{
  "translations": {
    "tr": {
      "subtitles": [{ start, end, text, speaker }],
      "quiz_explanations": ["...", "...", "..."],
      "info_sections": [{ title, body }]
    },
    "pt-BR": { ... },
    "es": { ... }
  }
}`,
  },
];

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════

function highlightVars(text: string) {
  const parts = text.split(/(\{[a-z_]+\})/g);
  return parts.map((part, i) => {
    if (/^\{[a-z_]+\}$/.test(part)) {
      return (
        <span key={i} className="bg-amber-100 text-amber-800 px-1 rounded font-semibold text-sm">
          {part}
        </span>
      );
    }
    return part;
  });
}

function PromptCard({ prompt, isOpen, onToggle }: { prompt: PromptDef; isOpen: boolean; onToggle: () => void }) {
  const thinkingColor = prompt.thinkingLevel
    ? { HIGH: "bg-red-100 text-red-700", MEDIUM: "bg-orange-100 text-orange-700", LOW: "bg-yellow-100 text-yellow-700", MINIMAL: "bg-gray-100 text-gray-600" }[prompt.thinkingLevel] || "bg-gray-100 text-gray-600"
    : null;

  return (
    <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono bg-zinc-100 text-zinc-600 px-2 py-1 rounded">
            {prompt.phase}
          </span>
          <span className="font-semibold text-zinc-900">{prompt.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 font-mono">{prompt.route}</span>
          <svg
            className={`w-4 h-4 text-zinc-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-zinc-100">
          {/* Config bar */}
          <div className="px-5 py-3 bg-zinc-50 flex flex-wrap gap-3 text-xs">
            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-mono">{prompt.model}</span>
            <span className="bg-zinc-200 text-zinc-700 px-2 py-1 rounded">
              temp: {prompt.temperature}
            </span>
            <span className="bg-zinc-200 text-zinc-700 px-2 py-1 rounded">
              maxTokens: {prompt.maxOutputTokens.toLocaleString()}
            </span>
            {prompt.thinkingLevel && (
              <span className={`px-2 py-1 rounded font-medium ${thinkingColor}`}>
                thinking: {prompt.thinkingLevel}
              </span>
            )}
            {!prompt.thinkingLevel && (
              <span className="bg-zinc-100 text-zinc-400 px-2 py-1 rounded">thinking: OFF</span>
            )}
          </div>

          {/* Prompt template */}
          <div className="px-5 py-4">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Prompt Template</h4>
            <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-sm leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[500px] overflow-y-auto">
              {highlightVars(prompt.template)}
            </pre>
          </div>

          {/* Output schema */}
          <div className="px-5 py-4 border-t border-zinc-100">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Output Schema</h4>
            <pre className="bg-emerald-50 text-emerald-900 p-4 rounded-lg text-sm leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {prompt.outputSchema}
            </pre>
          </div>

          {/* Variables legend */}
          <div className="px-5 py-4 border-t border-zinc-100 bg-amber-50/50">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
              Dinamik Alanlar ({prompt.variables.length})
            </h4>
            <div className="space-y-2">
              {prompt.variables.map((v) => (
                <div key={v.key} className="flex items-start gap-3 text-sm">
                  <code className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-semibold shrink-0 text-xs">
                    {`{${v.key}}`}
                  </code>
                  <span className="text-zinc-400 shrink-0">—</span>
                  <div>
                    <span className="font-mono text-xs text-zinc-500">{v.source}</span>
                    <span className="text-zinc-400 mx-1.5">·</span>
                    <span className="text-zinc-700">{v.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PromptsPage() {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(["generate"]));

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setOpenIds(new Set(PROMPTS.map((p) => p.id)));
  const collapseAll = () => setOpenIds(new Set());

  const batches = [
    ["tr", "pt-BR", "es"],
    ["ja", "ko", "id"],
    ["ar", "de", "fr"],
    ["it", "ru", "pl"],
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Prompts</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Pipeline boyunca LLM&apos;e giden tum prompt&apos;lar — toplam {PROMPTS.length} prompt, 7 LLM cagrissi
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={expandAll} className="text-xs px-3 py-1.5 rounded border border-zinc-200 hover:bg-zinc-50 text-zinc-600">
            Hepsini Ac
          </button>
          <button onClick={collapseAll} className="text-xs px-3 py-1.5 rounded border border-zinc-200 hover:bg-zinc-50 text-zinc-600">
            Hepsini Kapat
          </button>
        </div>
      </div>

      {/* Pipeline overview */}
      <div className="mb-6 p-4 bg-zinc-50 rounded-lg border border-zinc-200">
        <h3 className="text-sm font-semibold text-zinc-700 mb-3">Pipeline Akisi</h3>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="bg-white border border-zinc-300 px-3 py-1.5 rounded font-medium">Phase 0: Generate</span>
          <span className="text-zinc-400">→</span>
          <span className="bg-white border border-zinc-300 px-3 py-1.5 rounded text-zinc-500">Seedance Video</span>
          <span className="text-zinc-400">→</span>
          <span className="bg-white border border-zinc-300 px-3 py-1.5 rounded text-zinc-500">Whisper STT</span>
          <span className="text-zinc-400">→</span>
          <span className="bg-white border border-zinc-300 px-3 py-1.5 rounded font-medium">Phase 1: Match</span>
          <span className="text-zinc-400">→</span>
          <span className="bg-white border border-zinc-300 px-3 py-1.5 rounded font-medium">Phase 2: English</span>
          <span className="text-zinc-400">→</span>
          <span className="bg-white border border-zinc-300 px-3 py-1.5 rounded font-medium">Phase 3: Translation (x4)</span>
          <span className="text-zinc-400">→</span>
          <span className="bg-white border border-zinc-300 px-3 py-1.5 rounded text-zinc-500">DB Insert</span>
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          <strong>Translation batches:</strong>{" "}
          {batches.map((b, i) => (
            <span key={i}>
              {i > 0 && " · "}
              <span className="font-mono">{b.join(", ")}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Prompt cards */}
      <div className="space-y-3">
        {PROMPTS.map((p) => (
          <PromptCard key={p.id} prompt={p} isOpen={openIds.has(p.id)} onToggle={() => toggle(p.id)} />
        ))}
      </div>
    </div>
  );
}

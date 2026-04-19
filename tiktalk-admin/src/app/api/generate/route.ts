import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";

// JSON schema forces Gemini to return exactly this shape
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    selected_tp_ids: {
      type: "array",
      items: { type: "string" },
    },
    seedance_prompt: { type: "string" },
    reasoning: { type: "string" },
  },
  required: ["selected_tp_ids", "seedance_prompt", "reasoning"],
};

export async function POST(req: NextRequest) {
  const {
    channelName,
    channelDescription,
    level,
    vibeNames,
    vibeHints,
    teachingPoints,
  } = await req.json();

  if (!channelName || !level || !Array.isArray(vibeNames) || !Array.isArray(teachingPoints)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Level-specific guidance — includes both grammar/vocab complexity AND
  // speech-pace hints. Beginner dialogs should be slower + more pauses so
  // subtitles are readable on a 15s TikTok-style card; advanced can run at
  // normal conversational speed. Keep word counts calibrated to be
  // comfortable at the stated pace, not cramming.
  const levelGuidance: Record<string, string> = {
    beginner:
      "Use very simple grammar, basic vocabulary (A1-A2), short sentences. Pick TPs that focus on foundational concepts. Keep the dialog sparse and slow: clear enunciation, natural half-beat pauses between lines, characters are relaxed.",
    intermediate:
      "Use moderate complexity (B1-B2), common idiomatic expressions allowed. Pick TPs that build on basics. Dialog flows at a natural conversational pace with a small pause only where it fits the scene (e.g. a surprise, a sip of coffee).",
    advanced:
      "Use nuanced language (C1-C2), idioms, phrasal verbs, subtle distinctions. Pick TPs that challenge fluency. Dialog runs at normal everyday speed — the kind of back-and-forth native speakers have without waiting for each other.",
  };

  // Calibrated word budgets per level. THESE ARE TIGHT ON PURPOSE — 15 sec
  // is very short and the video is for LEARNERS, not fluent viewers. Err on
  // the side of "short and memorable" over "naturalistic but crammed". A
  // beginner subtitle of 5 words + a 1-sec pause is vastly more useful than
  // a 7-word line that flies past. Do NOT pad to hit the upper bound.
  const wordBudget: Record<string, string> = {
    beginner:
      "12-18 English words TOTAL (across the whole scene), max 4 turns (2 lines per speaker). Each line 3-5 words. Example: 'Can I have a coffee?' / 'Sure, what size?' / 'Small, please.' / 'Three dollars.' = 14 words.",
    intermediate:
      "18-26 English words TOTAL, max 4 turns (2 lines per speaker). Each line 4-7 words.",
    advanced:
      "26-36 English words TOTAL, max 4 turns (2 lines per speaker). Each line 6-10 words.",
  };

  const prompt = `You are a content planner for TikTalk, a social-media style language learning app that teaches English through 15-second AI-generated video scenes. Users scroll a TikTok-like feed and learn English passively/actively.

=== INPUT ===

CHANNEL: "${channelName}"
CHANNEL DESCRIPTION: ${channelDescription || "(no description)"}
TARGET LEVEL: ${level}
LEVEL GUIDANCE: ${levelGuidance[level] || levelGuidance.beginner}
VIBES: ${vibeNames.join(", ")}
VIBE STYLE HINTS: ${(vibeHints || []).filter(Boolean).join(" | ") || "(none)"}

AVAILABLE TEACHING POINTS for this level (format: [id] category: name — usage/5 videos):
${teachingPoints
  .map(
    (tp: { id: string; name: string; category: string; level: string; usage_count: number }) =>
      `- [${tp.id}] ${tp.category}: ${tp.name} — ${tp.usage_count}/5 videos`
  )
  .join("\n")}

IMPORTANT: Prefer TPs with fewer existing videos (lower usage count). TPs with 0 videos must be prioritized over 3-4 count TPs. This ensures even coverage.

=== TASK ===

1) Pick 1-4 teaching points that naturally fit together in a single 15-second scene. They must all make sense in the same conversation. Don't force unrelated TPs together.

2) Write a Seedance video generation prompt for a cinematic 15-second scene.

HARD CONSTRAINTS for the scene:
- Exactly 2 speakers (no monologues, no crowds)
- Dialog length for "${level}": ${wordBudget[level] || wordBudget.beginner}
- Real-world everyday scenario matching the channel + vibes
- Dialog must naturally use the selected TPs — don't shoehorn, don't pad
- Level-appropriate vocabulary (see LEVEL GUIDANCE above)
- Every line must be comfortably readable as a subtitle in the time it takes
  the actor to say it. If the subtitle would need to rush past, shorten the
  line. "Fewer, clearer" beats "more, crammed" for a learner app.

Seedance prompt should include:
- Scene setting (location, lighting, mood)
- Both characters with brief descriptions (who they are — e.g., "a tired barista", "a curious tourist")
- Camera direction (medium shot, close-up, etc.)
- **Speech pace directive** — embed one of these phrases into the prompt so
  Seedance generates voice-over at the right speed:
   * beginner     → "The characters speak clearly and slowly, with a natural half-beat pause between each line."
   * intermediate → "The characters speak at a normal conversational pace, fluid but not rushed."
   * advanced     → "The characters speak at a natural everyday pace — quick, overlapping rhythm typical of native speakers."
- Embedded dialog with clear speaker labels:
  Character A: "line 1"
  Character B: "line 2"

3) Write a Turkish "reasoning" explaining why these specific TPs and this scene work together for this level.

=== EXAMPLE (for a coffee shop channel, beginner level, casual vibe) ===

{
  "selected_tp_ids": ["<uuid-1>", "<uuid-2>"],
  "seedance_prompt": "Medium shot inside a warm, sunlit coffee shop in the morning. A cheerful young woman barista with an apron stands behind the counter. A tired male customer in a hoodie approaches. Natural lighting, cozy atmosphere. The characters speak clearly and slowly, with a natural half-beat pause between each line.\\n\\nBarista: \\"What can I get you?\\"\\nCustomer: \\"Can I have a coffee?\\"\\nBarista: \\"Sure. Anything else?\\"\\nCustomer: \\"No thanks.\\"",
  "reasoning": "Seçilen TP'ler temel sipariş kalıplarını öğretiyor: 'Can I have...' isteme kalıbı ve 'anything else' açık uçlu sorusu. Sahne kahveci senaryosu, beginner seviyesi için ideal — diyalog toplam 15 kelime (beginner bütçesi 12-18), her satır 3-5 kelime, karakterler yavaş tonda konuştuğu için 15 saniyeye rahat sığıyor ve altyazı akmadan okunabiliyor."
}

=== YOUR OUTPUT ===

Return ONLY raw JSON matching the schema. No markdown, no code blocks, no commentary.`;

  try {
    const { data: parsed, usage } = await callGemini<{
      selected_tp_ids: string[];
      seedance_prompt: string;
      reasoning: string;
    }>({
      prompt,
      temperature: 1.2,
      maxOutputTokens: 65536,
      schema: RESPONSE_SCHEMA,
      thinkingLevel: "HIGH",
    });

    // Validate TP ids are in the allowed list
    const validTpIds = new Set(teachingPoints.map((tp: { id: string }) => tp.id));
    const selected = Array.isArray(parsed.selected_tp_ids)
      ? parsed.selected_tp_ids.filter((id: string) => validTpIds.has(id))
      : [];

    if (selected.length === 0) {
      return NextResponse.json(
        { error: "Gemini returned no valid teaching point IDs" },
        { status: 500 }
      );
    }

    parsed.selected_tp_ids = selected;

    return NextResponse.json({ ...parsed, usage });
  } catch (err) {
    return NextResponse.json(
      { error: `Gemini API error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

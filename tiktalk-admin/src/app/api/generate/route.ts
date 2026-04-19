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

  const levelGuidance: Record<string, string> = {
    beginner: "Use very simple grammar, basic vocabulary (A1-A2), short sentences. Pick TPs that focus on foundational concepts.",
    intermediate: "Use moderate complexity (B1-B2), common idiomatic expressions allowed. Pick TPs that build on basics.",
    advanced: "Use nuanced language (C1-C2), idioms, phrasal verbs, subtle distinctions. Pick TPs that challenge fluency.",
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
  "seedance_prompt": "Medium shot inside a warm, sunlit coffee shop in the morning. A cheerful young woman barista with an apron stands behind the counter. A tired male customer in a hoodie approaches. Natural lighting, cozy atmosphere.\\n\\nBarista: \\"Good morning! What can I get you?\\"\\nCustomer: \\"Can I have a large coffee, please?\\"\\nBarista: \\"Sure, anything else?\\"\\nCustomer: \\"No thanks, that's all.\\"",
  "reasoning": "Seçilen TP'ler temel sipariş kalıplarını öğretiyor: 'Can I have...' isteme kalıbı ve 'anything else' açık uçlu sorusu. Sahne kahveci senaryosu, beginner seviyesi için ideal çünkü kelime basit ve kalıplar günlük hayatta sık kullanılıyor."
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

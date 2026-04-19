import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// Admin viewer: read a single lesson row + decompose its jsonb into the
// shape the existing pool-manager UI expects (subtitles[], quizzes[],
// infoSections[], speakingPrompts[], keywords[]). The new schema stores
// everything inline on `lessons`, so this route just unpacks the jsonb.
//
// Param name kept as `videoId` for compatibility with pool-manager's
// existing fetch URL — the value passed in is now a lesson UUID.

type SubtitleRow = {
  id: string;
  start: number;
  end: number;
  speaker?: string;
  text: string;
  translations?: Record<string, string>;
};
type QuestionRow = {
  id: string;
  kind: string;
  purpose: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanations: Record<string, string>;
};
type TopicRow = {
  id: string;
  kind: string;
  teachingPointId: string | null;
  title: Record<string, string>;
  body: Record<string, string>;
};
type SpeakPromptRow = {
  id: string;
  kind: string;
  promptText: string;
  expectedText: string | null;
  contextHint: string | null;
};

export async function GET(req: NextRequest) {
  const lessonId = req.nextUrl.searchParams.get("videoId");
  if (!lessonId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }

  const lessonRes = await query(
    `SELECT id, title, description, level, duration_sec, match_score,
            subtitles, questions, info, subject_tags
     FROM lessons WHERE id = $1`,
    [lessonId]
  );

  if (lessonRes.rows.length === 0) {
    return NextResponse.json({ error: "lesson not found" }, { status: 404 });
  }

  const row = lessonRes.rows[0];
  const subtitles: SubtitleRow[] = row.subtitles || [];
  const questions: QuestionRow[] = row.questions || [];
  const info = row.info || {};
  const topics: TopicRow[] = info.topics || [];
  const speakPrompts: SpeakPromptRow[] = info.speakPrompts || [];

  // Subtitles per locale: split the multilang storage shape back into
  // per-locale arrays the existing UI tabs through.
  const localeSet = new Set<string>(["en"]);
  for (const s of subtitles) {
    for (const k of Object.keys(s.translations || {})) localeSet.add(k);
  }
  const subtitlesByLocale = [...localeSet].map((locale) => ({
    locale,
    is_target_language: locale === "en",
    segments: subtitles.map((s) => ({
      start: s.start,
      end: s.end,
      speaker: s.speaker,
      text: locale === "en" ? s.text : s.translations?.[locale] ?? "",
    })),
  }));

  // Quizzes: backend stores combined explanations map; UI expects them as JSON.
  const quizzes = questions.map((q, i) => ({
    quiz_order: i + 1,
    quiz_type: q.purpose,
    quiz_kind: q.kind,
    question: q.text,
    options: q.options,
    correct_index: q.correctIndex,
    explanations: q.explanations,
  }));

  // info topics → infoSections shape (one section per topic, locales array).
  const tpIds = topics.map((t) => t.teachingPointId).filter(Boolean) as string[];
  const tpNameMap: Record<string, string> = {};
  if (tpIds.length > 0) {
    const tpRes = await query(
      `SELECT id, name FROM teaching_points WHERE id = ANY($1::uuid[])`,
      [tpIds]
    );
    for (const r of tpRes.rows as { id: string; name: string }[]) {
      tpNameMap[r.id] = r.name;
    }
  }

  const infoLocaleSet = new Set<string>(["en"]);
  for (const t of topics) {
    for (const k of Object.keys(t.title || {})) infoLocaleSet.add(k);
    for (const k of Object.keys(t.body || {})) infoLocaleSet.add(k);
  }
  const infoSections = topics.map((t, i) => ({
    id: t.id,
    section_type: t.kind,
    section_order: i + 1,
    teaching_point_id: t.teachingPointId,
    tp_name: t.teachingPointId ? tpNameMap[t.teachingPointId] || null : null,
    locales: [...infoLocaleSet].map((locale) => ({
      locale,
      title: t.title?.[locale] ?? "",
      body: t.body?.[locale] ?? "",
    })),
  }));

  const speakingPrompts = speakPrompts.map((sp, i) => ({
    prompt_order: i + 1,
    prompt_type: sp.kind,
    prompt_text: sp.promptText,
    expected_text: sp.expectedText,
    context_hint: sp.contextHint,
  }));

  return NextResponse.json({
    video: {
      id: row.id,
      title: row.title,
      description: row.description,
      slug: "",
      level: row.level,
      duration_sec: row.duration_sec,
      transcript_match_score: row.match_score,
    },
    subtitles: subtitlesByLocale,
    quizzes,
    infoSections,
    speakingPrompts,
    keywords: row.subject_tags || [],
  });
}

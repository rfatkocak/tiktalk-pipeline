import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }

  const [video, subtitles, quizzes, infoSections, speakingPrompts, keywords] = await Promise.all([
    query(`SELECT id, title, description, slug, level, duration_sec, transcript_match_score FROM videos WHERE id = $1`, [videoId]),
    query(`SELECT locale, is_target_language, segments FROM subtitles WHERE video_id = $1 ORDER BY locale`, [videoId]),
    query(`SELECT quiz_order, quiz_type, question, options, correct_index, explanations FROM quizzes WHERE video_id = $1 ORDER BY quiz_order`, [videoId]),
    query(`
      SELECT s.id, s.section_type, s.section_order, s.teaching_point_id, tp.name as tp_name,
        json_agg(json_build_object('locale', sl.locale, 'title', sl.title, 'body', sl.body) ORDER BY sl.locale) as locales
      FROM info_sections s
      LEFT JOIN teaching_points tp ON tp.id = s.teaching_point_id
      LEFT JOIN info_section_locales sl ON sl.info_section_id = s.id
      WHERE s.video_id = $1
      GROUP BY s.id, s.section_type, s.section_order, s.teaching_point_id, tp.name
      ORDER BY s.section_order
    `, [videoId]),
    query(`SELECT prompt_order, prompt_type, prompt_text, expected_text, context_hint FROM speaking_prompts WHERE video_id = $1 ORDER BY prompt_order`, [videoId]),
    query(`SELECT keyword FROM video_keywords WHERE video_id = $1 ORDER BY keyword`, [videoId]),
  ]);

  return NextResponse.json({
    video: video.rows[0] || null,
    subtitles: subtitles.rows,
    quizzes: quizzes.rows,
    infoSections: infoSections.rows,
    speakingPrompts: speakingPrompts.rows,
    keywords: keywords.rows.map((r: { keyword: string }) => r.keyword),
  });
}

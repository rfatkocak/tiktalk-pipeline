# TikTalk Admin — Project Context

TikTalk is a language learning app that teaches English through 15-second AI-generated video scenes.
This repo is the admin panel (Next.js 16) that orchestrates the entire content production pipeline.

## Tech Stack

- **Frontend**: Next.js 16.2.3, React 19, TypeScript, Tailwind CSS 4
- **Database**: PostgreSQL 16 in Docker on Hetzner VPS
- **CDN**: Bunny CDN (storage + pull zone)
- **AI**: Google Gemini 2.5 Pro (content gen), OpenAI Whisper gpt-4o-transcribe-diarize (transcription)
- **Video Gen**: Seedance (Dreamina/CapCut) via Playwright automation — separate project

## Infrastructure

```
PostgreSQL: 91.98.46.133:35432  db=tiktalk  user=tiktalk
Bunny CDN:  storage zone = tiktalk-storage-zone
            pull zone    = https://tiktalk-cdn.b-cdn.net/
Admin:      http://localhost:3000
```

Environment variables in `.env.local`: DATABASE_URL, BUNNY_STORAGE_ZONE, BUNNY_STORAGE_KEY, BUNNY_STORAGE_HOST, GEMINI_API_KEY, OPENAI_API_KEY

## Monorepo Layout

Both projects live as sibling folders inside `tiktalk-pipeline/`:

### 1. tiktalk-admin (this folder) — `tiktalk-pipeline/tiktalk-admin/`
Admin panel + API routes. Manages the full pipeline.

### 2. seedance-automation — `tiktalk-pipeline/seedance-automation/` (sibling)
Playwright-based video generation via Dreamina (CapCut AI).
Key files:
- `automation.js` — Browser automation core (launchBrowser, generateVideo, isLoggedIn, etc.)
- `seedance-runner.js` — CLI runner that takes pool_item_ids, reads prompts from DB, generates videos, saves to `downloads/`
- `seed-tp.js` — Teaching points seeder (231 TPs)
- `schema.sql` — Full DB schema
- `tiktalk.md` — Product documentation

Downloaded videos go to: `../seedance-automation/downloads/` (sibling folder).

---

## Content Production Pipeline

The entire flow is automated from the admin UI. One click on "Start Seedance" runs everything:

```
1. PROMPT GENERATION (Gemini)
   UI: Select channel + level + vibes → "Generate with AI"
   API: POST /api/generate
   Gemini selects 1-4 teaching points + writes seedance video prompt
   User reviews and saves → pool_item created (status: pending)

2. VIDEO GENERATION (Seedance/Dreamina)
   UI: "Start Seedance" button (single or multi-select)
   API: POST /api/seedance → spawns seedance-runner.js as detached process
   Playwright opens Dreamina, enters prompt, waits ~5min for video
   Saves MP4 to downloads/, updates pool_items.video_file
   UI polls GET /api/pool-status every 5s until video_file appears

3. WHISPER TRANSCRIPTION (auto-triggered)
   API: POST /api/whisper
   Reads video file, sends to OpenAI gpt-4o-transcribe-diarize
   Returns diarized segments with timestamps + speaker labels
   Saves transcript JSONB to pool_items.transcript

4. CONTENT GENERATION (auto-triggered, Gemini)
   API: POST /api/content
   Sends transcript + seedance_prompt + TPs + vibes + level to Gemini 2.5 Pro
   Step 1: Match check (transcript vs intended prompt, score 0-1, threshold 0.5)
   Step 2: If match, generates ALL content:
     - Video metadata (title, description, slug, keywords)
     - Subtitle translations for 12 locales
     - 3 quizzes (comprehension/grammar/vocabulary) with explanations in 12 locales
     - Info sections per teaching point + 1 cultural section, all in 13 locales
     - 3 speaking prompts (2x repeat, 1x produce) — difficulty matches level
   Inserts into: videos, transcripts, subtitles, quizzes, info_sections,
     info_section_locales, speaking_prompts, video_keywords,
     video_teaching_points, video_vibes
   Links pool_item.video_id

5. CDN UPLOAD (auto-triggered)
   API: POST /api/upload-cdn
   ffmpeg extracts thumbnail at 1s mark
   Uploads video + thumbnail to Bunny CDN
   Updates videos.video_url and videos.thumbnail_url

6. PUBLISHING
   UI: Toggle button on pool item → published/archived
   Server action: toggleVideoStatus() — sets status + published_at
```

Steps 2-5 chain automatically after "Start Seedance". UI shows live progress:
`Seedance çalışıyor → Whisper çalışıyor → İçerik üretiliyor → CDN'e yükleniyor → Tamamlandı`

---

## File Structure

```
src/
├── app/
│   ├── layout.tsx              — Root layout with Sidebar
│   ├── page.tsx                — Dashboard (stats cards)
│   ├── globals.css             — Tailwind styles
│   │
│   ├── channels/
│   │   ├── page.tsx            — Server: fetch channels
│   │   ├── channel-list.tsx    — Client: CRUD channels + avatar upload
│   │   └── actions.ts          — Server actions: create/update/delete channel
│   │
│   ├── vibes/
│   │   ├── page.tsx            — Server: fetch vibes
│   │   ├── vibe-list.tsx       — Client: CRUD vibes
│   │   └── actions.ts          — Server actions: create/delete vibe
│   │
│   ├── pool/
│   │   ├── page.tsx            — Server: fetch pool items + channels + vibes + TPs + usage counts
│   │   ├── pool-manager.tsx    — Client: Main pipeline UI (create, generate, expand, tabs, status toggle)
│   │   └── actions.ts          — Server actions: createPoolItem, deletePoolItem, toggleVideoStatus
│   │
│   └── api/
│       ├── generate/route.ts       — Gemini: select TPs + create seedance prompt
│       ├── seedance/route.ts       — Spawn seedance-runner.js background process
│       ├── pool-status/route.ts    — GET: poll pool item state (for auto-pipeline)
│       ├── whisper/route.ts        — OpenAI Whisper transcription
│       ├── content/route.ts        — Gemini: full content generation (biggest endpoint)
│       ├── upload-cdn/route.ts     — ffmpeg thumbnail + Bunny CDN upload
│       ├── pipeline/route.ts       — Chain: whisper → content → CDN (single call)
│       ├── video-content/route.ts  — GET: fetch all video content for display
│       ├── video/[filename]/route.ts — Serve local video files
│       └── upload/route.ts         — General file upload to Bunny CDN
│
├── components/
│   └── sidebar.tsx             — Navigation sidebar
│
└── lib/
    ├── db.ts                   — pg Pool + query() helper
    └── bunny.ts                — uploadToBunny() / deleteFromBunny()
```

---

## Database Schema (17 tables)

### Enums
- `level_enum`: beginner, intermediate, advanced
- `tp_category`: grammar, phrase, idiom, proverb, basics
- `video_status_enum`: generating, review, published, archived
- `pool_item_status`: pending, processing, completed, failed, cancelled
- `quiz_type_enum`: comprehension, grammar, vocabulary
- `info_section_type_enum`: grammar, cultural, contextual_translation, extra_notes
- `speaking_prompt_type_enum`: repeat, produce
- `collection_status_enum`: draft, published, archived

### Core Tables
- **channels** (id, slug, name, description, avatar_url, created_at)
- **vibes** (id, slug, name, prompt_hint, created_at)
- **teaching_points** (id, category, subcategory, name, level, description, target_language, created_at) — 231 records

### Pool (Pipeline Orchestration)
- **pool_items** (id, channel_id, level, status, video_id, notes, seedance_prompt, script, video_file, transcript, created_at)
- **pool_item_vibes** (pool_item_id, vibe_id)
- **pool_item_tps** (pool_item_id, teaching_point_id)

### Video Content
- **videos** (id, channel_id, slug, target_language, level, title, description, duration_sec, video_url, thumbnail_url, status, original_script, seedance_prompt, transcript_match_score, sort_order, is_featured, created_at, published_at)
- **transcripts** (id, video_id, language, segments, full_text)
- **subtitles** (id, video_id, locale, is_target_language, segments) — 13 per video (en + 12 locales)
- **quizzes** (id, video_id, quiz_order, quiz_type, question, options, correct_index, explanations) — 3 per video
- **info_sections** (id, video_id, section_type, teaching_point_id, section_order)
- **info_section_locales** (id, info_section_id, locale, title, body) — 13 locales per section
- **speaking_prompts** (id, video_id, prompt_order, prompt_type, prompt_text, expected_text, context_hint) — 3 per video
- **video_teaching_points** (video_id, teaching_point_id)
- **video_vibes** (video_id, vibe_id)
- **video_keywords** (video_id, keyword)

### Discover (not yet implemented in UI)
- **collections** (id, slug, title, description, cover_url, total_sequences, free_sequences, estimated_minutes, status, created_at)
- **collection_videos** (collection_id, video_id, sequence_order)

---

## Supported Locales (12 + English)

Target language is always English. Translations generated for:
`tr, pt-BR, es, ja, ko, id, ar, de, fr, it, ru, pl`

Labels: Turkish, Brazilian Portuguese, Spanish, Japanese, Korean, Indonesian, Arabic (MSA), German, French, Italian, Russian, Polish

---

## Pool UI Features

- **Create**: Select channel + level + vibes → "Generate with AI" → review prompt/TPs → "Save to Pool"
- **List**: Expandable cards with summary row (status badge, level, channel, vibes, TPs, progress dots)
- **Progress dots**: Prompt → Video → Transcript → Content (green = done)
- **Expand**: 2-column detail (video player, reasoning, transcript, seedance prompt, action buttons)
- **Content tabs**: 13 locale tabs showing subtitles, quizzes with explanations, info sections per language
- **Status toggle**: Published/Archived button per video
- **Multi-select**: Checkbox + batch "Start Seedance" for multiple items
- **Auto-pipeline**: After seedance, auto-runs whisper → content → CDN with live status text

---

## Key Design Decisions

- TP selection limited to max 5 videos per TP per level (enforced in UI, guided in Gemini prompt)
- Content generation uses single massive Gemini call (maxOutputTokens: 65536) to generate everything at once
- Transcript match score threshold: 0.5 — below this, pool item is auto-cancelled
- Quiz/info/speaking prompt difficulty is calibrated to the video's level (beginner/intermediate/advanced)
- Videos served locally during dev via /api/video/[filename], production uses Bunny CDN URLs
- Seedance runner is a detached child process — survives even if admin server restarts
- Gemini endpoint: aiplatform.googleapis.com (Vertex AI key, NOT generativelanguage.googleapis.com)
- Whisper model: gpt-4o-transcribe-diarize with response_format: diarized_json (NOT verbose_json)
- Product vision: social media + language learning hybrid — users scroll short videos like TikTok and learn English passively/actively

---

## Content Endpoint Safety (/api/content)

The content generation endpoint has multiple layers of protection:

- **Duplicate guard**: Checks video_id before running — prevents double content generation
- **UUID input validation**: poolItemId must be valid UUID format
- **Gemini timeout**: 90s AbortController timeout on fetch
- **Truncation check**: finishReason === "MAX_TOKENS" is rejected
- **Response validation** (validateResult):
  - All 13 locales present in subtitles and info sections
  - Subtitle segment count matches original transcript segment count
  - Each subtitle segment has start/end/text fields
  - quiz_type must be valid enum (comprehension/grammar/vocabulary)
  - section_type must be valid enum (grammar/cultural/contextual_translation/extra_notes)
  - correct_index must be 0-3
  - Info section title/body cannot be empty strings
  - teaching_point_id must reference a real TP from the pool item
  - Speaking prompts: 1+2 must be "repeat" with expected_text, 3 must be "produce"
- **Slug sanitization**: Turkish chars converted, special chars stripped, fallback if empty
- **Slug uniqueness**: Checked inside transaction, appends timestamp suffix if duplicate
- **Order normalization**: quiz_order/section_order/prompt_order forced to sequential 1,2,3
- **Keyword deduplication**: Case-insensitive dedup prevents PK violation
- **DB transaction**: All inserts in BEGIN/COMMIT — rollback on any failure
- **Rollback safety**: ROLLBACK wrapped in try/catch for dead connections
- **Failure recovery**: Pool item set to "failed" status on DB error (preserves original notes)
- **Cancel preserves notes**: Match failure appends cancel reason to existing notes instead of overwriting

-- TikTalk Database Schema
-- v1.0 — April 2026

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- ENUMS
-- ==========================================
CREATE TYPE tp_category AS ENUM ('grammar', 'phrase', 'idiom', 'proverb', 'basics');
CREATE TYPE level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE video_status_enum AS ENUM ('generating', 'review', 'published', 'archived');
CREATE TYPE quiz_type_enum AS ENUM ('comprehension', 'grammar', 'vocabulary');
CREATE TYPE info_section_type_enum AS ENUM ('grammar', 'cultural', 'contextual_translation', 'extra_notes');
CREATE TYPE speaking_prompt_type_enum AS ENUM ('repeat', 'produce');
CREATE TYPE collection_status_enum AS ENUM ('draft', 'published', 'archived');

-- ==========================================
-- 3.1 CORE TABLES
-- ==========================================

CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    avatar_url VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vibes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    prompt_hint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teaching_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category tp_category NOT NULL,
    subcategory VARCHAR,
    name VARCHAR NOT NULL,
    level level_enum NOT NULL,
    description TEXT,
    target_language VARCHAR(5) NOT NULL DEFAULT 'en',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id UUID REFERENCES channels(id),
    slug VARCHAR NOT NULL UNIQUE,
    target_language VARCHAR(5) NOT NULL DEFAULT 'en',
    level level_enum NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    duration_sec SMALLINT,
    video_url VARCHAR,
    thumbnail_url VARCHAR,
    status video_status_enum NOT NULL DEFAULT 'generating',
    original_script JSONB,
    seedance_prompt TEXT,
    transcript_match_score DECIMAL(3,2),
    sort_order INT DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

-- ==========================================
-- 3.2 JUNCTION TABLES
-- ==========================================

CREATE TABLE channel_vibes (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    vibe_id UUID NOT NULL REFERENCES vibes(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, vibe_id)
);

CREATE TABLE video_teaching_points (
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    teaching_point_id UUID NOT NULL REFERENCES teaching_points(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, teaching_point_id)
);

CREATE TABLE video_vibes (
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    vibe_id UUID NOT NULL REFERENCES vibes(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, vibe_id)
);

-- ==========================================
-- 3.3 CONTENT TABLES
-- ==========================================

CREATE TABLE transcripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
    language VARCHAR(5) NOT NULL DEFAULT 'en',
    segments JSONB NOT NULL,
    full_text TEXT NOT NULL
);

CREATE TABLE subtitles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    locale VARCHAR(5) NOT NULL,
    is_target_language BOOLEAN NOT NULL DEFAULT FALSE,
    segments JSONB NOT NULL,
    UNIQUE (video_id, locale)
);

-- ==========================================
-- 3.4 PRACTICE TABLES
-- ==========================================

CREATE TABLE quizzes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    quiz_order SMALLINT NOT NULL,
    quiz_type quiz_type_enum NOT NULL,
    question TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_index SMALLINT NOT NULL,
    explanations JSONB NOT NULL,
    UNIQUE (video_id, quiz_order)
);

CREATE TABLE info_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    section_type info_section_type_enum NOT NULL,
    teaching_point_id UUID REFERENCES teaching_points(id),
    section_order SMALLINT NOT NULL
);

CREATE TABLE info_section_locales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    info_section_id UUID NOT NULL REFERENCES info_sections(id) ON DELETE CASCADE,
    locale VARCHAR(5) NOT NULL,
    title VARCHAR NOT NULL,
    body TEXT NOT NULL,
    UNIQUE (info_section_id, locale)
);

CREATE TABLE speaking_prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    prompt_order SMALLINT NOT NULL,
    prompt_type speaking_prompt_type_enum NOT NULL,
    prompt_text TEXT NOT NULL,
    expected_text TEXT,
    context_hint TEXT
);

-- ==========================================
-- 3.5 DISCOVER TABLES
-- ==========================================

CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR NOT NULL UNIQUE,
    title VARCHAR NOT NULL,
    description TEXT,
    cover_url VARCHAR,
    total_sequences SMALLINT NOT NULL DEFAULT 0,
    free_sequences SMALLINT NOT NULL DEFAULT 1,
    estimated_minutes SMALLINT,
    status collection_status_enum NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE collection_videos (
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    sequence_order SMALLINT NOT NULL,
    PRIMARY KEY (collection_id, video_id)
);

-- ==========================================
-- 3.6 SEARCH TABLE
-- ==========================================

CREATE TABLE video_keywords (
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    keyword VARCHAR NOT NULL,
    PRIMARY KEY (video_id, keyword)
);

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_level ON videos(level);
CREATE INDEX idx_videos_channel ON videos(channel_id);
CREATE INDEX idx_videos_target_language ON videos(target_language);

CREATE INDEX idx_tp_category ON teaching_points(category);
CREATE INDEX idx_tp_level ON teaching_points(level);
CREATE INDEX idx_tp_target_language ON teaching_points(target_language);

CREATE INDEX idx_subtitles_video_locale ON subtitles(video_id, locale);

CREATE INDEX idx_transcripts_fulltext ON transcripts USING GIN(to_tsvector('english', full_text));

CREATE INDEX idx_keywords_keyword ON video_keywords(keyword);

CREATE INDEX idx_quizzes_video ON quizzes(video_id);
CREATE INDEX idx_speaking_video ON speaking_prompts(video_id);
CREATE INDEX idx_info_sections_video ON info_sections(video_id);

CREATE INDEX idx_collection_videos_order ON collection_videos(collection_id, sequence_order);

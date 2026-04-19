# TikTalk — Product & Database Documentation
**v1.0 — April 2026**

*Learn languages through real conversations*

---

## 1. Product Overview

TikTalk is a mobile-first language learning application that teaches English through AI-generated short video scenes. Unlike traditional language apps that rely on flashcards and gamified drills, TikTalk immerses users in real-life scenarios — ordering coffee, checking into a hotel, asking for directions — through 15-second cinematic videos with contextual learning layers.

The core insight: people don't learn languages by memorizing rules. They learn by experiencing them in context. TikTalk brings that context to the user's phone in a format they already love — short-form video.

### 1.1 Core Experience

**Feed (Home):** TikTok-style vertical scroll. Users swipe through 15-second AI-generated video scenes with dual-language subtitles. Each video is a self-contained micro-lesson set in a real-world scenario.

**Practice:** Swipe left or tap the Practice button to access three tabs — Quiz (3 contextual questions), Info (grammar notes, cultural context, dialogue breakdown), and Speaking (repeat sentences and produce your own).

**Discover:** Curated learning journeys. Sequential video playlists like "Café Survival Guide" that take users from greeting to payment in 6-8 scenes. Each scene has a different visual style but follows a coherent learning path. Mandatory flow: video → quiz overlay → speaking → info → next sequence.

**Search:** Find videos by keyword, category, situation, or vibe. Search works in the target language (English).

**Channels:** Curated content collections with a social media feel — HORRORLiFE, Daily English, Anime World. Each channel groups videos by vibe/atmosphere. Users tap a channel from a video to see more like it.

### 1.2 Key Differentiators

**Context-first learning:** Every grammar point, phrase, and vocabulary word is taught within a real scenario, not in isolation. The info section explains not just what a phrase means but when and why to use it.

**Visual variety (Vibes):** Videos are tagged with vibes — realistic, anime, cyberpunk, noir, cozy, horror, romantic, etc. The same "ordering coffee" lesson can be set in a Parisian café, a cyberpunk bar, or an anime world. Feed algorithm learns which vibes a user prefers.

**Speaking practice:** Users repeat sentences from the video and produce their own, evaluated by Apple Speech Recognition and LLM. Premium feature with 1 free daily attempt.

**1 video → 12 markets:** Each video is produced once in English. Subtitles, quiz explanations, and info sections are localized into 12 languages via LLM, serving global markets with minimal incremental cost.

### 1.3 Localization (12 Languages)

MVP teaches English only. UI and learning content (subtitles, quiz explanations, info sections) is localized for 12 native languages via LLM:

| # | Language | Locale | Market | Rationale |
|---|----------|--------|--------|-----------|
| 1 | Turkish | tr | Turkey | Home market, 85M population |
| 2 | Portuguese | pt-BR | Brazil | 220M population, Duolingo 3rd largest market |
| 3 | Spanish | es | Latin America + Spain | 500M+ potential users |
| 4 | Japanese | ja | Japan | Highest app store ARPU globally |
| 5 | Korean | ko | South Korea | High spending culture, K-pop drives English interest |
| 6 | Indonesian | id | Indonesia | 270M population, highest Duolingo downloads in Asia |
| 7 | Arabic (MSA) | ar | Saudi Arabia + Gulf | High spending power, Vision 2030 English push |
| 8 | German | de | Germany | Largest European economy, corporate demand |
| 9 | French | fr | France + Africa | France + francophone Africa |
| 10 | Italian | it | Italy | Fast-growing language learning market |
| 11 | Russian | ru | Russia | 150M population, low English proficiency = high demand |
| 12 | Polish | pl | Poland | 38M population, EU country, good iOS spending |

### 1.4 Monetization

- **Free tier:** 10 video views + 3 practice sessions per day (A/B testable). Discover: first sequence only.
- **Weekly:** $3.99 (no trial — intentionally priced to push users toward monthly).
- **Monthly:** $9.99 (3-day free trial, primary conversion target).
- **Yearly:** $49.99 (3-day free trial, best value — $4.17/month).
- **Speaking:** Premium-only, 1 free daily attempt for free users.

### 1.5 Teaching Framework

231+ teaching points organized into 5 categories across 3 levels:

**Categories:** Grammar Structures, Everyday Phrases, Idioms & Expressions, Proverbs & Sayings, Basics & Building Blocks.

**Levels:** Beginner, Intermediate, Advanced.

Each video covers up to 4 teaching points. All TPs in a video are equal (no primary/secondary hierarchy). Coverage is tracked to ensure every TP appears in sufficient videos.

### 1.6 Tech Stack

- **Video generation:** Seedance 2.0 via Dreamina (15-second clips with scripted dialogue).
- **Transcript:** OpenAI Whisper (speech-to-text with timestamps).
- **Content generation:** Claude/GPT for scripts, quizzes, info sections, and translations.
- **Video hosting:** BunnyCDN Stream (storage $0.005/GB, delivery $0.01/GB, transcoding free).
- **Backend + DB:** PostgreSQL on Hetzner VPS (same server, zero network latency).
- **Mobile:** iOS-first, SwiftUI native.

---

## 2. Video Production Pipeline

Each video goes through an 8-step automated production process:

1. **Input:** Level + Teaching Points (max 4) + Vibes are selected from the master lists.
2. **AI → Script:** AI generates the scenario/situation, dialogue script, and Seedance video prompt.
3. **Seedance:** 15-second video is generated from the prompt with scripted dialogue.
4. **Whisper:** Transcript is extracted with timestamps (segments with speaker labels).
5. **QA Check:** Whisper transcript is compared against original script. If transcript_match_score is below threshold, video is regenerated.
6. **AI → Content:** Using the verified Whisper transcript, AI generates all content: subtitle translations (12 locales), quiz questions + locale-based explanations, info sections (12 locales), speaking prompts, keywords, and search metadata.
7. **Storage:** Video → BunnyCDN. All structured data → PostgreSQL.
8. **Publish:** Status set to 'published', published_at timestamp recorded. Video appears in feed.

---

## 3. Database Model

17 tables organized into 6 groups. PostgreSQL on Hetzner VPS, co-located with backend.

---

### 3.1 Core Tables

#### channels
Curated vibe collections with social media feel. Each channel groups videos by atmosphere.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| slug | varchar | Unique, URL-friendly (e.g., "horrorlife") |
| name | varchar | Display name (e.g., "HORRORLiFE") |
| description | text | Channel description |
| avatar_url | varchar | Profile image URL |
| cover_url | varchar | Cover image URL |
| created_at | timestamptz | Creation timestamp |

#### vibes
Free-form atmosphere tags. Growing library — new vibe = new row, no schema change.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| slug | varchar | Unique identifier (e.g., "anime") |
| name | varchar | Display name (e.g., "Anime") |
| prompt_hint | text | Style instruction appended to Seedance prompts |
| created_at | timestamptz | Creation timestamp |

#### teaching_points
231+ language items. Adding a new target language = adding new TPs for that language.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| category | enum | grammar \| phrase \| idiom \| proverb \| basics |
| subcategory | varchar | Sub-group (e.g., Tenses, Modals, Greetings) |
| name | varchar | TP name (e.g., "would like + noun") |
| level | enum | beginner \| intermediate \| advanced |
| description | text | Brief explanation |
| target_language | varchar(5) | Language this TP belongs to (e.g., "en") |
| created_at | timestamptz | Creation timestamp |

#### videos
Core content unit. 15-second AI-generated scene hosted on BunnyCDN. Title and description in the video's own language.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| channel_id | uuid | FK → channels |
| slug | varchar | Unique, URL-friendly identifier |
| target_language | varchar(5) | Video's language (e.g., "en") |
| level | enum | beginner \| intermediate \| advanced |
| content_type | enum | dialogue \| monologue \| cultural_snippet |
| title | varchar | Video title (in video's language) |
| description | text | Video description (in video's language) |
| category | enum | travel \| food \| work \| social \| emergency \| shopping \| health \| education |
| situation | varchar | Situation tag (e.g., "at a café") |
| duration_sec | smallint | Video duration in seconds (max 15) |
| video_url | varchar | BunnyCDN stream URL |
| thumbnail_url | varchar | BunnyCDN thumbnail URL |
| status | enum | generating \| review \| published \| archived |
| original_script | jsonb | AI-written dialogue [{speaker, line}] |
| seedance_prompt | text | Full Seedance video generation prompt |
| transcript_match_score | decimal(3,2) | Whisper vs script similarity (0.00–1.00) |
| sort_order | int | Feed sort priority |
| is_featured | boolean | Featured content flag (default false) |
| created_at | timestamptz | Creation timestamp |
| published_at | timestamptz | Set when status → published (nullable) |

---

### 3.2 Junction Tables

#### channel_vibes
Channel ↔ Vibe M:N. Which vibes a channel represents.

| Field | Type | Description |
|-------|------|-------------|
| channel_id | uuid | FK → channels |
| vibe_id | uuid | FK → vibes |
| | | Composite PK: (channel_id, vibe_id) |

#### video_teaching_points
Video ↔ TP M:N. Max 4 TPs per video (app-level constraint).

| Field | Type | Description |
|-------|------|-------------|
| video_id | uuid | FK → videos |
| teaching_point_id | uuid | FK → teaching_points |
| | | Composite PK: (video_id, teaching_point_id) |

#### video_vibes
Video ↔ Vibe M:N. No limit on vibes per video.

| Field | Type | Description |
|-------|------|-------------|
| video_id | uuid | FK → videos |
| vibe_id | uuid | FK → vibes |
| | | Composite PK: (video_id, vibe_id) |

---

### 3.3 Content Tables
*Returned with the feed request. Subtitles are needed for video playback.*

#### transcripts
Whisper output — source of truth for all subtitles and content. 1:1 with video. Not exposed to users directly.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| video_id | uuid | FK → videos (unique) |
| language | varchar(5) | Transcript language (= video's language) |
| segments | jsonb | Timestamped speech [{start_ms, end_ms, speaker, text}] |
| full_text | text | Concatenated text — GIN indexed for full-text search |

#### subtitles
Locale-based subtitles. Target language from Whisper, translations by LLM. Feed returns target + user's native.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| video_id | uuid | FK → videos |
| locale | varchar(5) | Subtitle language (e.g., "tr") |
| is_target_language | boolean | true = video's own language subtitle |
| segments | jsonb | Timestamped subtitles [{start_ms, end_ms, text, speaker}] |
| | | UNIQUE: (video_id, locale) |

---

### 3.4 Practice Tables
*Lazy-loaded when user enters practice. Only the requested locale is fetched (~5-10ms response).*

#### quizzes
3 questions per video. Question + options in video's language. Explanation is locale-based JSONB — backend extracts requested locale with `explanations->>'tr'`.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| video_id | uuid | FK → videos |
| quiz_order | smallint | Question order (1, 2, 3) |
| quiz_type | enum | comprehension \| grammar \| vocabulary |
| question | text | Question text (in video's language) |
| options | jsonb | Answer choices ["A","B","C","D"] |
| correct_index | smallint | Correct answer index (0-3) |
| explanations | jsonb | Locale-based explanations {"tr":"...","en":"..."} |
| | | UNIQUE: (video_id, quiz_order) |

#### info_sections
Info card framework — type, order, optional TP link. Content is in the locale table.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| video_id | uuid | FK → videos |
| section_type | enum | grammar \| cultural \| contextual_translation \| extra_notes |
| teaching_point_id | uuid \| null | FK → teaching_points (linked for grammar type, null for others) |
| section_order | smallint | Display order |

#### info_section_locales
Localized info card content. Body can be large (markdown). Separate table because only 1 locale is needed per request.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| info_section_id | uuid | FK → info_sections |
| locale | varchar(5) | Language code (e.g., "tr") |
| title | varchar | Card title |
| body | text | Card content (markdown supported) |
| | | UNIQUE: (info_section_id, locale) |

#### speaking_prompts
Speaking tab. Repeat = say the given sentence. Produce = create your own (LLM evaluates). Premium-only, 1 free daily attempt.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| video_id | uuid | FK → videos |
| prompt_order | smallint | Order (1, 2, 3...) |
| prompt_type | enum | repeat \| produce |
| prompt_text | text | Repeat: sentence to say. Produce: task description. |
| expected_text | text \| null | Repeat: expected match. Produce: null (LLM evaluates). |
| context_hint | text \| null | Produce: context sent to LLM for evaluation. |

---

### 3.5 Discover Tables

#### collections
Curated learning journeys. Level-independent, sequential. First sequence free, rest premium. Mandatory flow: video → quiz → speaking → info → next.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| slug | varchar | Unique identifier (e.g., "cafe-survival-guide") |
| title | varchar | Story title (e.g., "Café Survival Guide") |
| description | text | Story description |
| cover_url | varchar | Cover image URL |
| total_sequences | smallint | Total number of sequences |
| free_sequences | smallint | Free sequence count (default 1) |
| estimated_minutes | smallint | Estimated completion time in minutes |
| status | enum | draft \| published \| archived |
| created_at | timestamptz | Creation timestamp |

#### collection_videos
Collection ↔ Video with ordering. Same video can appear in both feed and Discover.

| Field | Type | Description |
|-------|------|-------------|
| collection_id | uuid | FK → collections |
| video_id | uuid | FK → videos |
| sequence_order | smallint | Sequence position (1, 2, 3...) |
| | | Composite PK: (collection_id, video_id) |

---

### 3.6 Search Table

#### video_keywords
Curated keyword index. AI-selected learning-relevant words (not all transcript words). Search operates in target language only.

| Field | Type | Description |
|-------|------|-------------|
| video_id | uuid | FK → videos |
| keyword | varchar | Keyword in target language (lowercase, e.g., "coffee") |
| | | Composite PK: (video_id, keyword). INDEX on keyword for fast lookup. |

---

## 4. Summary

| Group | Tables | Purpose | Loading |
|-------|--------|---------|---------|
| Core | channels, vibes, teaching_points, videos | Base definitions | Feed + Practice |
| Junction | channel_vibes, video_teaching_points, video_vibes | M:N relations | Internal joins |
| Content | transcripts, subtitles | Video content layer | Feed (with video) |
| Practice | quizzes, info_sections, info_section_locales, speaking_prompts | Learning content | Lazy (on demand) |
| Discover | collections, collection_videos | Curated journeys | Discover tab |
| Search | video_keywords | Keyword index | Search results |

**17 tables • 6 groups • PostgreSQL @ Hetzner • BunnyCDN Stream • iOS-first (SwiftUI)**

---

## 5. Teaching Points — Full List (English)

231 teaching points across 5 categories and 3 levels. Each TP can appear in multiple videos (up to 4 TPs per video). This list serves as the content production matrix — videos are generated to cover these TPs.

---

### 5.1 Grammar Structures

#### Tenses

**Beginner:**
1. Present simple (I go, she goes)
2. Present continuous (I'm going)
3. Past simple — regular (I walked)
4. Past simple — irregular (I went, I saw)
5. Past simple of 'be' (was/were)
6. Future with 'will' (I will go)
7. Future with 'going to' (I'm going to eat)

**Intermediate:**
8. Present perfect (I have been)
9. Present perfect continuous (I've been waiting)
10. Past continuous (I was walking when...)
11. Past perfect (I had already left)
12. Future continuous (I'll be waiting)
13. Present simple vs continuous difference
14. Past simple vs present perfect difference

**Advanced:**
15. Past perfect continuous (I had been working)
16. Future perfect (I will have finished)
17. Future perfect continuous
18. Mixed tenses in narrative
19. Tense shifting in reported speech

#### Modals

**Beginner:**
20. can / can't (ability)
21. would like (polite request)
22. Let's... (suggestion)

**Intermediate:**
23. should / shouldn't (advice)
24. must / have to (obligation)
25. might / may / could (possibility)
26. could / would (polite requests)
27. don't have to vs mustn't (no obligation vs prohibition)
28. be able to (ability — all tenses)

**Advanced:**
29. must / can't have + past participle (past deduction)
30. should have / could have (regret)
31. would rather / had better
32. need + gerund (it needs fixing)
33. dare (modal usage)

#### Questions & Negatives

**Beginner:**
34. Yes/No questions (Do you...? Is she...?)
35. WH questions (What, Where, When, Who, Why, How)
36. Negative sentences (don't, doesn't, isn't)

**Intermediate:**
37. Subject questions (Who called you?)
38. Tag questions (It's nice, isn't it?)
39. Indirect questions (Do you know where...?)

**Advanced:**
40. Negative questions (Don't you think...?)
41. Rhetorical questions
42. Echo questions (You did what?)

#### Clauses & Sentence Structure

**Beginner:**
43. because + reason (I stayed because...)
44. and / but / or (basic connectors)
45. There is / There are
46. Imperative (Sit down! Don't touch!)

**Intermediate:**
47. Relative clauses — who, which, that, where
48. Zero conditional (If you heat ice, it melts)
49. First conditional (If it rains, I'll stay)
50. Second conditional (If I were rich, I would...)
51. Reported speech — basic (He said that...)
52. Time clauses — when, while, before, after, until

**Advanced:**
53. Third conditional (If I had known...)
54. Mixed conditionals
55. Reduced relative clauses
56. Cleft sentences (It was John who...)
57. Inversion (Never have I seen...)
58. Reported speech — advanced (questions, requests, commands)
59. Passive voice — all forms
60. Causative (have/get something done)

#### Verb Patterns

**Beginner:**
61. like / love / hate + -ing
62. want + to + verb

**Intermediate:**
63. Gerund vs infinitive (stop doing vs stop to do)
64. Verb + -ing (enjoy, avoid, finish...)
65. Verb + to (decide, want, hope...)
66. Phrasal verbs — common (look up, turn off, give up...)
67. Used to / be used to / get used to

**Advanced:**
68. Complex phrasal verbs (come up with, look forward to...)
69. Verb + object + infinitive (I want you to...)
70. Subjunctive mood (I suggest he go...)

#### Articles, Pronouns & Determiners

**Beginner:**
71. a / an / the — basics
72. this / that / these / those
73. I / you / he / she / it / we / they
74. my / your / his / her / our / their
75. some / any

**Intermediate:**
76. Zero article (no article)
77. someone / anyone / no one / everyone
78. Reflexive pronouns (myself, yourself...)
79. each / every / all / both / neither / either
80. much / many / a lot of / a few / a little

**Advanced:**
81. Advanced article usage (the + adjective, abstract nouns)
82. whatever / whoever / whichever

#### Adjectives & Adverbs

**Beginner:**
83. Basic adjectives (big, small, happy, sad...)
84. Adverbs of frequency (always, usually, never...)
85. very / really / too

**Intermediate:**
86. Comparatives & superlatives (-er/-est, more/most)
87. as...as (equality comparison)
88. Adjective order
89. Adverbs of manner (quickly, carefully...)
90. -ing vs -ed adjectives (boring vs bored)

**Advanced:**
91. Compound adjectives (well-known, open-minded)
92. Extreme/non-gradable adjectives (absolutely fantastic)
93. Fronting adverbials for emphasis

#### Prepositions

**Beginner:**
94. Prepositions of place (in, on, at, under, next to...)
95. Prepositions of time (in, on, at, before, after...)

**Intermediate:**
96. Prepositions of movement (through, across, along...)
97. Dependent prepositions (interested in, good at...)
98. Prepositions with verbs (look at, listen to...)

**Advanced:**
99. Complex prepositional phrases (in terms of, by means of...)
100. Prepositions in formal vs informal register

---

### 5.2 Everyday Phrases

#### Greetings & Farewells

**Beginner:**
101. Hi / Hello / Hey / Good morning
102. How are you? / I'm fine, thanks
103. Nice to meet you
104. Goodbye / See you later / Bye

**Intermediate:**
105. What's up? / How's it going?
106. Long time no see!
107. It was nice meeting you
108. Take care / Catch you later

**Advanced:**
109. How have you been keeping?
110. I'll let you go (polite exit)
111. Let's not be strangers

#### Requests & Politeness

**Beginner:**
112. Can I have...? / I'd like...
113. Please / Thank you / You're welcome
114. Excuse me / Sorry

**Intermediate:**
115. Could you...? / Would you mind...?
116. Do you happen to know...?
117. I was wondering if...
118. That would be great / I really appreciate it

**Advanced:**
119. I don't suppose you could...?
120. Would it be possible to...?
121. I hate to bother you, but...
122. By any chance, do you...?

#### Reactions & Responses

**Beginner:**
123. Really? / Wow! / Oh no!
124. That's great! / That's nice!
125. I don't know / I'm not sure
126. Me too / Me neither

**Intermediate:**
127. No way! / You're kidding!
128. That makes sense
129. I see what you mean
130. Fair enough / Good point
131. I totally agree / I'm not so sure about that

**Advanced:**
132. That's a stretch / That's debatable
133. I couldn't agree more
134. That's beside the point
135. You have a point there

#### Transitions & Connectors

**Beginner:**
136. and / but / so / because
137. also / too

**Intermediate:**
138. By the way / Actually / To be honest
139. On the other hand / However
140. For example / Such as
141. First / Then / Finally
142. Anyway / In any case

**Advanced:**
143. Having said that / That being said
144. As a matter of fact
145. Not to mention / Let alone
146. In hindsight / In retrospect

#### Opinions & Feelings

**Beginner:**
147. I like / I don't like
148. I think... / I feel...
149. I'm happy / sad / tired / hungry

**Intermediate:**
150. In my opinion / Personally / If you ask me
151. I'm a big fan of... / I'm not keen on...
152. It depends on...
153. I'm looking forward to...

**Advanced:**
154. I'm inclined to think...
155. My take on this is...
156. I'm torn between...
157. I can't help but feel...

---

### 5.3 Idioms & Expressions

#### Common Idioms

**Intermediate:**
158. Break the ice
159. Piece of cake
160. Hit the road
161. Under the weather
162. A blessing in disguise
163. Better late than never
164. Call it a day
165. Get out of hand
166. Keep an eye on
167. On the same page
168. The ball is in your court
169. Once in a blue moon

**Advanced:**
170. Burn the midnight oil
171. Cut to the chase
172. Devil's advocate
173. Elephant in the room
174. Jump on the bandwagon
175. Read between the lines
176. The last straw
177. A penny for your thoughts
178. Bite the bullet
179. Go the extra mile
180. Miss the boat
181. Pull someone's leg

#### Phrasal Expressions

**Intermediate:**
182. Kind of / Sort of
183. A big deal / No big deal
184. End up + -ing
185. Turn out (to be)
186. Come across (as)

**Advanced:**
187. At the end of the day
188. For what it's worth
189. To say the least
190. Out of the blue
191. In the long run

---

### 5.4 Proverbs & Sayings

#### Life & Wisdom

**Intermediate:**
192. Actions speak louder than words
193. Practice makes perfect
194. When in Rome, do as the Romans do
195. Don't judge a book by its cover
196. Every cloud has a silver lining

**Advanced:**
197. The pen is mightier than the sword
198. A bird in the hand is worth two in the bush
199. You can't have your cake and eat it too
200. The road to hell is paved with good intentions
201. People who live in glass houses shouldn't throw stones

---

### 5.5 Basics & Building Blocks

#### Core Vocabulary

**Beginner:**
202. Numbers (1-100, ordinals)
203. Colors
204. Days of the week
205. Months & seasons
206. Family members
207. Common objects (table, chair, phone...)
208. Body parts
209. Food & drinks — basics
210. Clothing
211. Weather words

**Intermediate:**
212. Professions & jobs
213. Emotions & personality traits
214. Health & body — detailed
215. Travel vocabulary
216. Technology vocabulary
217. Money & shopping

**Advanced:**
218. Academic & formal vocabulary
219. Business terminology
220. Legal & medical basics
221. Nuanced emotion words (anxious vs nervous vs worried)

#### Pronunciation & Sound

**Beginner:**
222. Alphabet & letter sounds
223. Common word stress patterns
224. Numbers pronunciation (13 vs 30, 14 vs 40...)

**Intermediate:**
225. Sentence stress & rhythm
226. Connected speech (gonna, wanna, lemme)
227. Silent letters (knife, write, hour...)
228. Minimal pairs (ship/sheep, bed/bad...)

**Advanced:**
229. Intonation patterns (questions, lists, sarcasm)
230. Weak forms & schwa sound
231. Regional accent awareness (American vs British vs Australian)

---

### 5.6 Teaching Points Summary

| Category | Beginner | Intermediate | Advanced | Total |
|----------|----------|--------------|----------|-------|
| Grammar Structures | 29 | 40 | 30 | 99 |
| Everyday Phrases | 16 | 22 | 19 | 57 |
| Idioms & Expressions | 0 | 17 | 17 | 34 |
| Proverbs & Sayings | 0 | 5 | 5 | 10 |
| Basics & Building Blocks | 13 | 10 | 8 | 31 |
| **Total** | **58** | **94** | **79** | **231** |
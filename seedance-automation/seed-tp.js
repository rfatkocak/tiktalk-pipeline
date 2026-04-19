const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

// Pick DATABASE_URL from tiktalk-admin/.env.local so we never hardcode creds.
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', 'tiktalk-admin', '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing — set it in tiktalk-admin/.env.local.');
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

const TPS = [
  // ==========================================
  // 5.1 GRAMMAR STRUCTURES
  // ==========================================

  // Tenses
  { cat: 'grammar', sub: 'Tenses', lvl: 'beginner', name: 'Present simple (I go, she goes)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'beginner', name: 'Present continuous (I\'m going)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'beginner', name: 'Past simple — regular (I walked)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'beginner', name: 'Past simple — irregular (I went, I saw)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'beginner', name: 'Past simple of \'be\' (was/were)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'beginner', name: 'Future with \'will\' (I will go)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'beginner', name: 'Future with \'going to\' (I\'m going to eat)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'intermediate', name: 'Present perfect (I have been)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'intermediate', name: 'Present perfect continuous (I\'ve been waiting)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'intermediate', name: 'Past continuous (I was walking when...)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'intermediate', name: 'Past perfect (I had already left)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'intermediate', name: 'Future continuous (I\'ll be waiting)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'intermediate', name: 'Present simple vs continuous difference' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'intermediate', name: 'Past simple vs present perfect difference' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'advanced', name: 'Past perfect continuous (I had been working)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'advanced', name: 'Future perfect (I will have finished)' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'advanced', name: 'Future perfect continuous' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'advanced', name: 'Mixed tenses in narrative' },
  { cat: 'grammar', sub: 'Tenses', lvl: 'advanced', name: 'Tense shifting in reported speech' },

  // Modals
  { cat: 'grammar', sub: 'Modals', lvl: 'beginner', name: 'can / can\'t (ability)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'beginner', name: 'would like (polite request)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'beginner', name: 'Let\'s... (suggestion)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'intermediate', name: 'should / shouldn\'t (advice)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'intermediate', name: 'must / have to (obligation)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'intermediate', name: 'might / may / could (possibility)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'intermediate', name: 'could / would (polite requests)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'intermediate', name: 'don\'t have to vs mustn\'t (no obligation vs prohibition)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'intermediate', name: 'be able to (ability — all tenses)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'advanced', name: 'must / can\'t have + past participle (past deduction)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'advanced', name: 'should have / could have (regret)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'advanced', name: 'would rather / had better' },
  { cat: 'grammar', sub: 'Modals', lvl: 'advanced', name: 'need + gerund (it needs fixing)' },
  { cat: 'grammar', sub: 'Modals', lvl: 'advanced', name: 'dare (modal usage)' },

  // Questions & Negatives
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'beginner', name: 'Yes/No questions (Do you...? Is she...?)' },
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'beginner', name: 'WH questions (What, Where, When, Who, Why, How)' },
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'beginner', name: 'Negative sentences (don\'t, doesn\'t, isn\'t)' },
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'intermediate', name: 'Subject questions (Who called you?)' },
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'intermediate', name: 'Tag questions (It\'s nice, isn\'t it?)' },
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'intermediate', name: 'Indirect questions (Do you know where...?)' },
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'advanced', name: 'Negative questions (Don\'t you think...?)' },
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'advanced', name: 'Rhetorical questions' },
  { cat: 'grammar', sub: 'Questions & Negatives', lvl: 'advanced', name: 'Echo questions (You did what?)' },

  // Clauses & Sentence Structure
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'beginner', name: 'because + reason (I stayed because...)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'beginner', name: 'and / but / or (basic connectors)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'beginner', name: 'There is / There are' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'beginner', name: 'Imperative (Sit down! Don\'t touch!)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'intermediate', name: 'Relative clauses — who, which, that, where' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'intermediate', name: 'Zero conditional (If you heat ice, it melts)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'intermediate', name: 'First conditional (If it rains, I\'ll stay)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'intermediate', name: 'Second conditional (If I were rich, I would...)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'intermediate', name: 'Reported speech — basic (He said that...)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'intermediate', name: 'Time clauses — when, while, before, after, until' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'advanced', name: 'Third conditional (If I had known...)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'advanced', name: 'Mixed conditionals' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'advanced', name: 'Reduced relative clauses' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'advanced', name: 'Cleft sentences (It was John who...)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'advanced', name: 'Inversion (Never have I seen...)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'advanced', name: 'Reported speech — advanced (questions, requests, commands)' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'advanced', name: 'Passive voice — all forms' },
  { cat: 'grammar', sub: 'Clauses & Sentence Structure', lvl: 'advanced', name: 'Causative (have/get something done)' },

  // Verb Patterns
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'beginner', name: 'like / love / hate + -ing' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'beginner', name: 'want + to + verb' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'intermediate', name: 'Gerund vs infinitive (stop doing vs stop to do)' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'intermediate', name: 'Verb + -ing (enjoy, avoid, finish...)' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'intermediate', name: 'Verb + to (decide, want, hope...)' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'intermediate', name: 'Phrasal verbs — common (look up, turn off, give up...)' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'intermediate', name: 'Used to / be used to / get used to' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'advanced', name: 'Complex phrasal verbs (come up with, look forward to...)' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'advanced', name: 'Verb + object + infinitive (I want you to...)' },
  { cat: 'grammar', sub: 'Verb Patterns', lvl: 'advanced', name: 'Subjunctive mood (I suggest he go...)' },

  // Articles, Pronouns & Determiners
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'beginner', name: 'a / an / the — basics' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'beginner', name: 'this / that / these / those' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'beginner', name: 'I / you / he / she / it / we / they' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'beginner', name: 'my / your / his / her / our / their' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'beginner', name: 'some / any' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'intermediate', name: 'Zero article (no article)' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'intermediate', name: 'someone / anyone / no one / everyone' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'intermediate', name: 'Reflexive pronouns (myself, yourself...)' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'intermediate', name: 'each / every / all / both / neither / either' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'intermediate', name: 'much / many / a lot of / a few / a little' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'advanced', name: 'Advanced article usage (the + adjective, abstract nouns)' },
  { cat: 'grammar', sub: 'Articles, Pronouns & Determiners', lvl: 'advanced', name: 'whatever / whoever / whichever' },

  // Adjectives & Adverbs
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'beginner', name: 'Basic adjectives (big, small, happy, sad...)' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'beginner', name: 'Adverbs of frequency (always, usually, never...)' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'beginner', name: 'very / really / too' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'intermediate', name: 'Comparatives & superlatives (-er/-est, more/most)' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'intermediate', name: 'as...as (equality comparison)' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'intermediate', name: 'Adjective order' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'intermediate', name: 'Adverbs of manner (quickly, carefully...)' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'intermediate', name: '-ing vs -ed adjectives (boring vs bored)' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'advanced', name: 'Compound adjectives (well-known, open-minded)' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'advanced', name: 'Extreme/non-gradable adjectives (absolutely fantastic)' },
  { cat: 'grammar', sub: 'Adjectives & Adverbs', lvl: 'advanced', name: 'Fronting adverbials for emphasis' },

  // Prepositions
  { cat: 'grammar', sub: 'Prepositions', lvl: 'beginner', name: 'Prepositions of place (in, on, at, under, next to...)' },
  { cat: 'grammar', sub: 'Prepositions', lvl: 'beginner', name: 'Prepositions of time (in, on, at, before, after...)' },
  { cat: 'grammar', sub: 'Prepositions', lvl: 'intermediate', name: 'Prepositions of movement (through, across, along...)' },
  { cat: 'grammar', sub: 'Prepositions', lvl: 'intermediate', name: 'Dependent prepositions (interested in, good at...)' },
  { cat: 'grammar', sub: 'Prepositions', lvl: 'intermediate', name: 'Prepositions with verbs (look at, listen to...)' },
  { cat: 'grammar', sub: 'Prepositions', lvl: 'advanced', name: 'Complex prepositional phrases (in terms of, by means of...)' },
  { cat: 'grammar', sub: 'Prepositions', lvl: 'advanced', name: 'Prepositions in formal vs informal register' },

  // ==========================================
  // 5.2 EVERYDAY PHRASES
  // ==========================================

  // Greetings & Farewells
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'beginner', name: 'Hi / Hello / Hey / Good morning' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'beginner', name: 'How are you? / I\'m fine, thanks' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'beginner', name: 'Nice to meet you' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'beginner', name: 'Goodbye / See you later / Bye' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'intermediate', name: 'What\'s up? / How\'s it going?' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'intermediate', name: 'Long time no see!' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'intermediate', name: 'It was nice meeting you' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'intermediate', name: 'Take care / Catch you later' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'advanced', name: 'How have you been keeping?' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'advanced', name: 'I\'ll let you go (polite exit)' },
  { cat: 'phrase', sub: 'Greetings & Farewells', lvl: 'advanced', name: 'Let\'s not be strangers' },

  // Requests & Politeness
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'beginner', name: 'Can I have...? / I\'d like...' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'beginner', name: 'Please / Thank you / You\'re welcome' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'beginner', name: 'Excuse me / Sorry' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'intermediate', name: 'Could you...? / Would you mind...?' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'intermediate', name: 'Do you happen to know...?' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'intermediate', name: 'I was wondering if...' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'intermediate', name: 'That would be great / I really appreciate it' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'advanced', name: 'I don\'t suppose you could...?' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'advanced', name: 'Would it be possible to...?' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'advanced', name: 'I hate to bother you, but...' },
  { cat: 'phrase', sub: 'Requests & Politeness', lvl: 'advanced', name: 'By any chance, do you...?' },

  // Reactions & Responses
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'beginner', name: 'Really? / Wow! / Oh no!' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'beginner', name: 'That\'s great! / That\'s nice!' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'beginner', name: 'I don\'t know / I\'m not sure' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'beginner', name: 'Me too / Me neither' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'intermediate', name: 'No way! / You\'re kidding!' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'intermediate', name: 'That makes sense' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'intermediate', name: 'I see what you mean' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'intermediate', name: 'Fair enough / Good point' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'intermediate', name: 'I totally agree / I\'m not so sure about that' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'advanced', name: 'That\'s a stretch / That\'s debatable' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'advanced', name: 'I couldn\'t agree more' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'advanced', name: 'That\'s beside the point' },
  { cat: 'phrase', sub: 'Reactions & Responses', lvl: 'advanced', name: 'You have a point there' },

  // Transitions & Connectors
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'beginner', name: 'and / but / so / because' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'beginner', name: 'also / too' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'intermediate', name: 'By the way / Actually / To be honest' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'intermediate', name: 'On the other hand / However' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'intermediate', name: 'For example / Such as' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'intermediate', name: 'First / Then / Finally' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'intermediate', name: 'Anyway / In any case' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'advanced', name: 'Having said that / That being said' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'advanced', name: 'As a matter of fact' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'advanced', name: 'Not to mention / Let alone' },
  { cat: 'phrase', sub: 'Transitions & Connectors', lvl: 'advanced', name: 'In hindsight / In retrospect' },

  // Opinions & Feelings
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'beginner', name: 'I like / I don\'t like' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'beginner', name: 'I think... / I feel...' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'beginner', name: 'I\'m happy / sad / tired / hungry' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'intermediate', name: 'In my opinion / Personally / If you ask me' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'intermediate', name: 'I\'m a big fan of... / I\'m not keen on...' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'intermediate', name: 'It depends on...' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'intermediate', name: 'I\'m looking forward to...' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'advanced', name: 'I\'m inclined to think...' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'advanced', name: 'My take on this is...' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'advanced', name: 'I\'m torn between...' },
  { cat: 'phrase', sub: 'Opinions & Feelings', lvl: 'advanced', name: 'I can\'t help but feel...' },

  // ==========================================
  // 5.3 IDIOMS & EXPRESSIONS
  // ==========================================

  // Common Idioms
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Break the ice' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Piece of cake' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Hit the road' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Under the weather' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'A blessing in disguise' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Better late than never' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Call it a day' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Get out of hand' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Keep an eye on' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'On the same page' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'The ball is in your court' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'intermediate', name: 'Once in a blue moon' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Burn the midnight oil' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Cut to the chase' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Devil\'s advocate' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Elephant in the room' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Jump on the bandwagon' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Read between the lines' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'The last straw' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'A penny for your thoughts' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Bite the bullet' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Go the extra mile' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Miss the boat' },
  { cat: 'idiom', sub: 'Common Idioms', lvl: 'advanced', name: 'Pull someone\'s leg' },

  // Phrasal Expressions
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'intermediate', name: 'Kind of / Sort of' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'intermediate', name: 'A big deal / No big deal' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'intermediate', name: 'End up + -ing' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'intermediate', name: 'Turn out (to be)' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'intermediate', name: 'Come across (as)' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'advanced', name: 'At the end of the day' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'advanced', name: 'For what it\'s worth' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'advanced', name: 'To say the least' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'advanced', name: 'Out of the blue' },
  { cat: 'idiom', sub: 'Phrasal Expressions', lvl: 'advanced', name: 'In the long run' },

  // ==========================================
  // 5.4 PROVERBS & SAYINGS
  // ==========================================

  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'intermediate', name: 'Actions speak louder than words' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'intermediate', name: 'Practice makes perfect' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'intermediate', name: 'When in Rome, do as the Romans do' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'intermediate', name: 'Don\'t judge a book by its cover' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'intermediate', name: 'Every cloud has a silver lining' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'advanced', name: 'The pen is mightier than the sword' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'advanced', name: 'A bird in the hand is worth two in the bush' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'advanced', name: 'You can\'t have your cake and eat it too' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'advanced', name: 'The road to hell is paved with good intentions' },
  { cat: 'proverb', sub: 'Life & Wisdom', lvl: 'advanced', name: 'People who live in glass houses shouldn\'t throw stones' },

  // ==========================================
  // 5.5 BASICS & BUILDING BLOCKS
  // ==========================================

  // Core Vocabulary
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Numbers (1-100, ordinals)' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Colors' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Days of the week' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Months & seasons' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Family members' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Common objects (table, chair, phone...)' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Body parts' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Food & drinks — basics' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Clothing' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'beginner', name: 'Weather words' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'intermediate', name: 'Professions & jobs' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'intermediate', name: 'Emotions & personality traits' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'intermediate', name: 'Health & body — detailed' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'intermediate', name: 'Travel vocabulary' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'intermediate', name: 'Technology vocabulary' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'intermediate', name: 'Money & shopping' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'advanced', name: 'Academic & formal vocabulary' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'advanced', name: 'Business terminology' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'advanced', name: 'Legal & medical basics' },
  { cat: 'basics', sub: 'Core Vocabulary', lvl: 'advanced', name: 'Nuanced emotion words (anxious vs nervous vs worried)' },

  // Pronunciation & Sound
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'beginner', name: 'Alphabet & letter sounds' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'beginner', name: 'Common word stress patterns' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'beginner', name: 'Numbers pronunciation (13 vs 30, 14 vs 40...)' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'intermediate', name: 'Sentence stress & rhythm' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'intermediate', name: 'Connected speech (gonna, wanna, lemme)' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'intermediate', name: 'Silent letters (knife, write, hour...)' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'intermediate', name: 'Minimal pairs (ship/sheep, bed/bad...)' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'advanced', name: 'Intonation patterns (questions, lists, sarcasm)' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'advanced', name: 'Weak forms & schwa sound' },
  { cat: 'basics', sub: 'Pronunciation & Sound', lvl: 'advanced', name: 'Regional accent awareness (American vs British vs Australian)' },
];

async function seed() {
  await client.connect();
  console.log(`Seeding ${TPS.length} teaching points...`);

  const query = `
    INSERT INTO teaching_points (category, subcategory, name, level, target_language)
    VALUES ($1, $2, $3, $4, 'en')
  `;

  let count = 0;
  for (const tp of TPS) {
    await client.query(query, [tp.cat, tp.sub, tp.name, tp.lvl]);
    count++;
  }

  console.log(`Done! ${count} teaching points inserted.`);

  // Verify counts
  const res = await client.query(`
    SELECT category, level, COUNT(*) as cnt
    FROM teaching_points
    GROUP BY category, level
    ORDER BY category, level
  `);
  console.log('\nSummary:');
  console.table(res.rows);

  const total = await client.query('SELECT COUNT(*) FROM teaching_points');
  console.log(`Total: ${total.rows[0].count}`);

  await client.end();
}

seed().catch(err => { console.error(err); process.exit(1); });

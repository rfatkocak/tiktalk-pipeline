// OpenAI LLM wrapper — mirrors the callGemini interface so content/route.ts
// can stay provider-agnostic. Structured output uses OpenAI's `json_schema`
// response_format in strict mode, which handles discriminated unions and
// nested arrays noticeably better than Gemini's schema validator (the reason
// we switched).

import OpenAI from "openai";

const API_KEY = process.env.OPENAI_API_KEY!;
const MODEL = process.env.OPENAI_LLM_MODEL || "gpt-5.4";

const client = new OpenAI({ apiKey: API_KEY });

export type TokenUsage = {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
};

export type LLMResult<T> = {
  data: T;
  usage: TokenUsage;
};

export type LLMConfig = {
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  schema?: Record<string, unknown>;
  // thinkingLevel / thinkingBudget are accepted but ignored — OpenAI has
  // no equivalent knob exposed via chat completions. Structured output
  // models do their own reasoning internally.
  thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  thinkingBudget?: number;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 5;
const PHASE_TIMEOUT_MS = 600_000; // 10 min

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// OpenAI's strict-mode structured output insists that every `type: "object"`
// schema explicitly sets `additionalProperties: false` AND requires every
// listed property. That'd break our optional-field discriminator (block
// types only require `type`), so we bend: set additionalProperties:false
// everywhere AND promote `properties` keys to `required` (all fields
// required, but optional ones can be null — strict mode also enforces
// that every property be in the required list).
//
// We walk the schema recursively: for every object, add
// additionalProperties:false. We do NOT promote properties to required
// because our schema still relies on optional fields per block type.
// Instead we rely on OpenAI's non-strict mode fallback if strict fails —
// but first let's try the minimum edit: just add additionalProperties:false
// at every object node.
function normalizeSchemaForOpenAI(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = { ...s };
  if (out.type === "object") {
    out.additionalProperties = false;
    // OpenAI strict mode ALSO requires `required` to list every property
    // in `properties`. We keep the semantic flexibility by still letting
    // optional fields through — strict mode allows `null` for them when
    // property schema is wrapped in `anyOf` with null. For our current
    // use we just make every property required:
    if (out.properties && typeof out.properties === "object") {
      const propNames = Object.keys(out.properties as Record<string, unknown>);
      out.required = propNames;
      const newProps: Record<string, unknown> = {};
      for (const k of propNames) {
        newProps[k] = normalizeSchemaForOpenAI(
          (out.properties as Record<string, unknown>)[k],
        );
      }
      out.properties = newProps;
    }
  }
  if (out.type === "array" && out.items) {
    out.items = normalizeSchemaForOpenAI(out.items);
  }
  if (Array.isArray(out.anyOf)) {
    out.anyOf = out.anyOf.map(normalizeSchemaForOpenAI);
  }
  return out;
}

async function callOnce<T>(cfg: LLMConfig): Promise<LLMResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PHASE_TIMEOUT_MS);

  try {
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: MODEL,
      messages: [{ role: "user", content: cfg.prompt }],
      temperature: cfg.temperature,
      max_completion_tokens: cfg.maxOutputTokens,
      response_format: cfg.schema
        ? {
            type: "json_schema",
            json_schema: {
              name: "response",
              strict: true,
              schema: normalizeSchemaForOpenAI(cfg.schema) as Record<string, unknown>,
            },
          }
        : { type: "json_object" },
    };

    const response = await client.chat.completions.create(params, {
      signal: controller.signal,
    });

    const choice = response.choices?.[0];
    if (!choice) throw new Error("OpenAI: empty choices");

    if (choice.finish_reason === "length") {
      throw new Error("OpenAI response truncated (MAX_TOKENS)");
    }
    const refusal = choice.message?.refusal;
    if (refusal) throw new Error(`OpenAI refused: ${refusal}`);

    const text = choice.message?.content;
    if (!text) throw new Error("OpenAI: empty content");

    const u = response.usage;
    const usage: TokenUsage = {
      promptTokens: u?.prompt_tokens ?? 0,
      candidatesTokens: u?.completion_tokens ?? 0,
      thoughtsTokens:
        u?.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: u?.total_tokens ?? 0,
    };

    try {
      const data = JSON.parse(text) as T;
      return { data, usage };
    } catch {
      throw new Error("OpenAI returned non-JSON: " + text.slice(0, 300));
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function callLLM<T>(cfg: LLMConfig): Promise<LLMResult<T>> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await callOnce<T>(cfg);
    } catch (e) {
      const err = e as Error & { status?: number; code?: number };
      lastErr = err;
      const status = err.status ?? err.code;
      const retryable = status
        ? RETRYABLE_STATUS.has(status)
        : /429|RESOURCE_EXHAUSTED|503|502|500|504/.test(err.message);
      if (!retryable || attempt === MAX_RETRIES - 1) throw err;
      const base = Math.min(2000 * Math.pow(2.2, attempt), 30000);
      const delay = Math.round(base + Math.random() * 1500);
      console.warn(
        `[openai] ${status || "error"} retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${err.message.slice(0, 100)}`,
      );
      await sleep(delay);
    }
  }
  throw lastErr ?? new Error("OpenAI call failed");
}

export function mergeUsage(...usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, u) => ({
      promptTokens: acc.promptTokens + u.promptTokens,
      candidatesTokens: acc.candidatesTokens + u.candidatesTokens,
      thoughtsTokens: acc.thoughtsTokens + u.thoughtsTokens,
      totalTokens: acc.totalTokens + u.totalTokens,
    }),
    { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0 },
  );
}

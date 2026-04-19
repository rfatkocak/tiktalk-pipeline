import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY!;
const MODEL = "gemini-2.5-flash";

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type TokenUsage = {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
};

export type GeminiResult<T> = {
  data: T;
  usage: TokenUsage;
};

export type GeminiConfig = {
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  schema?: Record<string, unknown>;
  thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
};

// ═══════════════════════════════════════════════════════════════
// RETRY CONFIG
// ═══════════════════════════════════════════════════════════════

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 5;
const PHASE_TIMEOUT_MS = 600_000; // 10 min

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════
// CORE CALL
// ═══════════════════════════════════════════════════════════════

async function callGeminiOnce<T>(cfg: GeminiConfig): Promise<GeminiResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PHASE_TIMEOUT_MS);

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: cfg.prompt }] }],
      config: {
        temperature: cfg.temperature,
        maxOutputTokens: cfg.maxOutputTokens,
        responseMimeType: "application/json",
        ...(cfg.schema ? { responseJsonSchema: cfg.schema } : {}),
        ...(cfg.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: cfg.thinkingLevel as ThinkingLevel } }
          : {}),
        abortSignal: controller.signal,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty Gemini response");

    // Check for truncation via finish reason
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      throw new Error("Gemini response truncated (MAX_TOKENS)");
    }

    // Extract usage
    const um = response.usageMetadata;
    const usage: TokenUsage = {
      promptTokens: um?.promptTokenCount ?? 0,
      candidatesTokens: um?.candidatesTokenCount ?? 0,
      thoughtsTokens: um?.thoughtsTokenCount ?? 0,
      totalTokens: um?.totalTokenCount ?? 0,
    };

    // Parse JSON
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try {
      const data = JSON.parse(cleaned) as T;
      return { data, usage };
    } catch {
      throw new Error("Failed to parse Gemini JSON: " + cleaned.slice(0, 300));
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════════
// RETRY WRAPPER
// ═══════════════════════════════════════════════════════════════

export async function callGemini<T>(cfg: GeminiConfig): Promise<GeminiResult<T>> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await callGeminiOnce<T>(cfg);
    } catch (e) {
      const err = e as Error & { status?: number; code?: number };
      lastErr = err;

      // SDK may put status in different places — check message too
      const status = err.status ?? err.code;
      const retryable = status
        ? RETRYABLE_STATUS.has(status)
        : /429|RESOURCE_EXHAUSTED|503|502|500|504/.test(err.message);

      if (!retryable || attempt === MAX_RETRIES - 1) throw err;

      const base = Math.min(2000 * Math.pow(2.2, attempt), 30000);
      const delay = Math.round(base + Math.random() * 1500);
      console.warn(
        `[gemini] ${status || "error"} retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${err.message.slice(0, 100)}`
      );
      await sleep(delay);
    }
  }
  throw lastErr ?? new Error("Gemini call failed");
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/** Merge multiple TokenUsage objects into a single cumulative one */
export function mergeUsage(...usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, u) => ({
      promptTokens: acc.promptTokens + u.promptTokens,
      candidatesTokens: acc.candidatesTokens + u.candidatesTokens,
      thoughtsTokens: acc.thoughtsTokens + u.thoughtsTokens,
      totalTokens: acc.totalTokens + u.totalTokens,
    }),
    { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0 }
  );
}

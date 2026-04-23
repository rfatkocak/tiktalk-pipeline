// Shim — we migrated off Gemini for content generation because its JSON
// schema validator kept choking on the discriminated-union block schema.
// Existing code still imports `callGemini`; this file re-exports the
// OpenAI implementation under the old name so call sites don't need to
// change. Rename the import path at leisure.

export {
  callLLM as callGemini,
  mergeUsage,
  type TokenUsage,
  type LLMConfig as GeminiConfig,
  type LLMResult as GeminiResult,
} from "./openai-llm";

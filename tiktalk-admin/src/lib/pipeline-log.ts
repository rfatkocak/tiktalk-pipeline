import { query } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error";
export type LogPhase = "generate" | "seedance" | "whisper" | "content" | "cdn" | "upload-cdn" | "pipeline";

let initPromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS pipeline_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pool_item_id UUID REFERENCES pool_items(id) ON DELETE CASCADE,
        phase TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_pipeline_logs_pool_item ON pipeline_logs(pool_item_id, created_at DESC)`
    );
  })().catch((err) => {
    // If init fails, reset so next call can retry
    initPromise = null;
    throw err;
  });
  return initPromise;
}

/**
 * Log a pipeline event to the DB. Never throws — logging must not break the pipeline.
 * Also writes to console for immediate visibility.
 */
export async function logPipeline(
  poolItemId: string | null,
  phase: LogPhase,
  level: LogLevel,
  message: string,
  metadata?: unknown
): Promise<void> {
  // Console first (always works)
  const prefix = `[${phase}/${level}]${poolItemId ? ` ${poolItemId.slice(0, 8)}` : ""}`;
  if (level === "error") {
    console.error(prefix, message, metadata ?? "");
  } else if (level === "warn") {
    console.warn(prefix, message, metadata ?? "");
  } else {
    console.log(prefix, message);
  }

  // DB best-effort
  try {
    await ensureTable();
    await query(
      `INSERT INTO pipeline_logs (pool_item_id, phase, level, message, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        poolItemId,
        phase,
        level,
        message.slice(0, 5000),
        metadata ? JSON.stringify(metadata).slice(0, 10000) : null,
      ]
    );
  } catch (err) {
    console.error("pipeline_log insert failed:", (err as Error).message);
  }
}

/**
 * Wrap an async operation with error logging. Rethrows the error after logging.
 */
export async function withLog<T>(
  poolItemId: string | null,
  phase: LogPhase,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    await logPipeline(poolItemId, phase, "info", `${label} started`);
    const result = await fn();
    await logPipeline(poolItemId, phase, "info", `${label} finished`, {
      duration_ms: Date.now() - start,
    });
    return result;
  } catch (err) {
    await logPipeline(poolItemId, phase, "error", `${label} failed: ${(err as Error).message}`, {
      duration_ms: Date.now() - start,
      stack: (err as Error).stack?.slice(0, 1000),
    });
    throw err;
  }
}

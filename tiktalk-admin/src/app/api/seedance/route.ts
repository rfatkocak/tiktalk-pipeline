import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const RUNNER_DIR = path.join(process.cwd(), "..", "seedance-automation");
const RUNNER_SCRIPT = path.join(RUNNER_DIR, "seedance-runner.js");
const LOG_DIR = path.join(RUNNER_DIR, "logs");

export async function POST(req: NextRequest) {
  const { poolItemIds } = await req.json();

  if (!poolItemIds || poolItemIds.length === 0) {
    return NextResponse.json({ error: "No pool item IDs provided" }, { status: 400 });
  }

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  // One log file per run, timestamped
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(LOG_DIR, `seedance-${timestamp}.log`);
  const logFd = fs.openSync(logPath, "a");

  // Header line
  fs.writeSync(
    logFd,
    `=== seedance-runner started ${new Date().toISOString()} ===\npoolItemIds: ${poolItemIds.join(", ")}\n\n`
  );

  // Spawn the runner as a detached background process, piping stdout/stderr to log file
  const child = spawn("node", [RUNNER_SCRIPT, ...poolItemIds], {
    cwd: RUNNER_DIR,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();

  return NextResponse.json({
    message: `Seedance runner started for ${poolItemIds.length} item(s)`,
    pid: child.pid,
    logFile: path.basename(logPath),
  });
}

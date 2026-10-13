import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseDataDirEnvValue, resolveProdDataDir } from "@bb/config/runtime";
import { z } from "zod";

export const CLI_ERROR_LOG_FILE_NAME = "cli-errors.jsonl";
const CLI_ERROR_LOG_MAX_BYTES = 2 * 1024 * 1024;
const CLI_ERROR_LOG_DISABLE_VALUES = new Set(["0", "false", "off"]);

const cliErrorLogEntrySchema = z.object({
  at: z.string(),
  cliVersion: z.string(),
  code: z.string(),
  command: z.string(),
  exitCode: z.number(),
  threadId: z.string().nullable(),
  token: z.string().nullable(),
});

export type CliErrorLogEntry = z.infer<typeof cliErrorLogEntrySchema>;

export interface CliErrorLogLocation {
  dataDir: string;
}

export function resolveCliErrorLogLocation(
  env: NodeJS.ProcessEnv = process.env,
): CliErrorLogLocation {
  const homeDir = homedir();
  const configured = env.BB_DATA_DIR;
  return {
    dataDir: resolve(
      configured === undefined || configured.trim().length === 0
        ? resolveProdDataDir({ homeDir })
        : parseDataDirEnvValue({ homeDir, rawDataDir: configured }),
    ),
  };
}

export function formatCliErrorLogPath(location: CliErrorLogLocation): string {
  return join(location.dataDir, "logs", CLI_ERROR_LOG_FILE_NAME);
}

export function isCliErrorLogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.BB_CLI_ERROR_LOG;
  if (raw === undefined) return true;
  return !CLI_ERROR_LOG_DISABLE_VALUES.has(raw.trim().toLowerCase());
}

export function appendCliErrorLogEntry(
  entry: CliErrorLogEntry,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isCliErrorLogEnabled(env)) return;
  try {
    const location = resolveCliErrorLogLocation(env);
    const logPath = formatCliErrorLogPath(location);
    mkdirSync(join(location.dataDir, "logs"), { recursive: true });
    rotateIfOversized(logPath);
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  } catch {}
}

function rotateIfOversized(logPath: string): void {
  let size: number;
  try {
    size = statSync(logPath).size;
  } catch {
    return;
  }
  if (size < CLI_ERROR_LOG_MAX_BYTES) return;
  renameSync(logPath, `${logPath}.1`);
}

export function readCliErrorLogEntries(
  location: CliErrorLogLocation,
): CliErrorLogEntry[] {
  const logPath = formatCliErrorLogPath(location);
  const entries: CliErrorLogEntry[] = [];
  for (const path of [`${logPath}.1`, logPath]) {
    let contents: string;
    try {
      contents = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split("\n")) {
      if (line.trim().length === 0) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = cliErrorLogEntrySchema.safeParse(raw);
      if (parsed.success) entries.push(parsed.data);
    }
  }
  return entries;
}

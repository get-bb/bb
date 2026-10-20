import { fstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import type { Logger } from "pino";
import { loadLoggerConfig } from "@bb/config/logger";

export type { Logger };

const ROTATED_LOG_FILE_COUNT = 5;

interface CreateLoggerOptions {
  component: string;
  base?: Record<string, unknown>;
  dataDir?: string;
}

function sanitizeComponentName(component: string): string {
  const trimmed = component.trim();
  if (!trimmed) {
    throw new Error("Logger component is required");
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/gu, "-");
}

function stdoutIsPlainFile(): boolean {
  try {
    return fstatSync(1).isFile();
  } catch {
    return false;
  }
}

function pruneRotatedLogFiles(logDir: string, component: string): void {
  const prefix = `${component}.`;
  const rotatedFiles = readdirSync(logDir)
    .filter(
      (entry) =>
        entry.startsWith(prefix) &&
        /^\d+\.log$/u.test(entry.slice(prefix.length)),
    )
    .map((entry) => {
      const path = join(logDir, entry);
      return { mtimeMs: statSync(path).mtimeMs, path };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const { path } of rotatedFiles.slice(ROTATED_LOG_FILE_COUNT)) {
    rmSync(path, { force: true });
  }
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const component = sanitizeComponentName(options.component);
  const loggerConfig = loadLoggerConfig({ dataDir: options.dataDir });
  const dataDir = loggerConfig.BB_DATA_DIR;
  const logDir = join(dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  pruneRotatedLogFiles(logDir, component);
  const loggerOptions = {
    level: loggerConfig.BB_LOG_LEVEL,
    base: {
      component,
      ...(options.base ?? {}),
    },
    serializers: {
      err: pino.stdSerializers.errWithCause,
      error: pino.stdSerializers.errWithCause,
    },
  } satisfies pino.LoggerOptions;

  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino-roll",
      options: {
        file: join(logDir, `${component}.log`),
        frequency: "daily",
        limit: { count: ROTATED_LOG_FILE_COUNT },
        size: "10m",
      },
      level: loggerConfig.BB_LOG_LEVEL,
    },
  ];

  if (!process.env.VITEST && !stdoutIsPlainFile()) {
    targets.push({
      target: "pino-pretty",
      options: {
        ignore: "pid,hostname,component",
        messageFormat: "[{component}] {msg}",
        singleLine: true,
        translateTime: "SYS:HH:MM:ss",
      },
      level: loggerConfig.BB_LOG_LEVEL,
    });
  }

  const transport = pino.transport({ targets });

  return pino(loggerOptions, transport);
}

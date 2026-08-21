import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import type { Logger } from "pino";
import { loadLoggerConfig } from "@bb/config/logger";

export type { Logger };

type LoggerTransportMode = "stream" | "worker";

interface CreateLoggerOptions {
  component: string;
  base?: Record<string, unknown>;
  dataDir?: string;
  transportMode?: LoggerTransportMode;
}

function sanitizeComponentName(component: string): string {
  const trimmed = component.trim();
  if (!trimmed) {
    throw new Error("Logger component is required");
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/gu, "-");
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const component = sanitizeComponentName(options.component);
  const loggerConfig = loadLoggerConfig({ dataDir: options.dataDir });
  const dataDir = loggerConfig.BB_DATA_DIR;
  const logDir = join(dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
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
  const transportMode = options.transportMode ?? "worker";

  if (transportMode === "stream") {
    // Sandboxed single-file bundles cannot resolve pino worker transports
    // from disk, so use a direct file destination instead.
    const destination = pino.destination(join(logDir, `${component}.log`));
    return pino(loggerOptions, destination);
  }

  // Every worker-mode logger writes to two places: structured JSON to a
  // rolling file (for grep/jq/log aggregation), and human-readable output
  // to stdout (for `pnpm start`/`pnpm dev`, where the parent script
  // forwards the child's stdout into the interactive terminal).
  // `colorize` is left unset so pino-pretty auto-detects via
  // `tty.isatty(1)` — TTYs get ANSI colors, pipes/files/journald stay clean.
  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino-roll",
      options: {
        file: join(logDir, `${component}.log`),
        frequency: "daily",
        limit: { count: 5 },
        size: "10m",
      },
      level: loggerConfig.BB_LOG_LEVEL,
    },
  ];

  // pino-pretty streams to stdout from a worker thread, so vitest's
  // `silent` setting (which patches console.* in the main thread) can't
  // suppress it. Skip it under vitest to keep large-payload tests from
  // flooding the reporter.
  if (!process.env.VITEST) {
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

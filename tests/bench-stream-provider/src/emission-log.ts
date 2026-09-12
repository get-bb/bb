import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BENCH_STREAM_LOG_DIR_ENV } from "./vocabulary.js";

type EmissionLogEntry =
  | {
      event: "start";
      t: number;
      doc: string;
      docChars: number;
      chunk: number;
      interval: number;
    }
  | { event: "delta"; t: number; chars: number }
  | { event: "complete"; t: number };

export interface EmissionLog {
  append(entry: EmissionLogEntry): void;
}

export function openEmissionLog(threadId: string): EmissionLog | null {
  const dir = process.env[BENCH_STREAM_LOG_DIR_ENV];
  if (dir === undefined || dir.length === 0) {
    return null;
  }
  const path = join(dir, `${encodeURIComponent(threadId)}.jsonl`);
  let state: "unopened" | "open" | "failed" = "unopened";
  return {
    append(entry) {
      if (state === "failed") {
        return;
      }
      try {
        if (state === "unopened") {
          mkdirSync(dir, { recursive: true });
          state = "open";
        }
        appendFileSync(path, `${JSON.stringify(entry)}\n`);
      } catch (error) {
        state = "failed";
        process.stderr.write(
          `bench stream provider: stopped writing the emission log ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    },
  };
}

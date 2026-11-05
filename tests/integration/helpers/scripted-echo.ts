import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const SCRIPTED_ECHO_RECORD_PATH_ENV = "SCRIPTED_ECHO_RECORD_PATH";

const recordedRequestSchema = z.object({
  method: z.string(),
  params: z.record(z.string(), z.unknown()).nullable(),
});
export type ScriptedEchoRecordedRequest = z.infer<typeof recordedRequestSchema>;

export interface ScriptedEchoRecord {
  read(): Promise<ScriptedEchoRecordedRequest[]>;
  dispose(): Promise<void>;
}

export async function recordScriptedEchoRequests(): Promise<ScriptedEchoRecord> {
  const dir = await mkdtemp(path.join(tmpdir(), "bb-scripted-echo-record-"));
  const recordPath = path.join(dir, "requests.jsonl");
  const previous = process.env[SCRIPTED_ECHO_RECORD_PATH_ENV];
  process.env[SCRIPTED_ECHO_RECORD_PATH_ENV] = recordPath;
  return {
    async read() {
      let raw: string;
      try {
        raw = await readFile(recordPath, "utf8");
      } catch {
        return [];
      }
      return raw
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => recordedRequestSchema.parse(JSON.parse(line)));
    },
    async dispose() {
      if (previous === undefined) {
        delete process.env[SCRIPTED_ECHO_RECORD_PATH_ENV];
      } else {
        process.env[SCRIPTED_ECHO_RECORD_PATH_ENV] = previous;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const sessionConstructionParamsSchema = z
  .object({
    threadId: z.string(),
    dynamicTools: z
      .array(z.object({ name: z.string() }).passthrough())
      .default([]),
    options: z
      .object({ instructions: z.string().optional() })
      .passthrough()
      .default({}),
  })
  .passthrough();

export function findSessionConstruction(
  requests: readonly ScriptedEchoRecordedRequest[],
  threadId: string,
):
  | {
      method: string;
      dynamicToolNames: string[];
      instructions: string | undefined;
    }
  | undefined {
  for (const request of requests) {
    if (
      request.method !== "thread/start" &&
      request.method !== "thread/resume"
    ) {
      continue;
    }
    const parsed = sessionConstructionParamsSchema.safeParse(request.params);
    if (!parsed.success || parsed.data.threadId !== threadId) {
      continue;
    }
    return {
      method: request.method,
      dynamicToolNames: parsed.data.dynamicTools
        .map((tool) => tool.name)
        .sort(),
      instructions: parsed.data.options.instructions,
    };
  }
  return undefined;
}

const SCRIPTED_ECHO_PROCESS_LOG_PATH_ENV = "SCRIPTED_ECHO_PROCESS_LOG_PATH";

export interface ScriptedEchoProcessLog {
  backgroundTaskOwnerPid(threadId: string): Promise<number | null>;
  dispose(): Promise<void>;
}

export async function recordScriptedEchoProcesses(): Promise<ScriptedEchoProcessLog> {
  const dir = await mkdtemp(path.join(tmpdir(), "bb-scripted-echo-process-"));
  const logPath = path.join(dir, "process.log");
  const previous = process.env[SCRIPTED_ECHO_PROCESS_LOG_PATH_ENV];
  process.env[SCRIPTED_ECHO_PROCESS_LOG_PATH_ENV] = logPath;
  return {
    async backgroundTaskOwnerPid(threadId) {
      let raw: string;
      try {
        raw = await readFile(logPath, "utf8");
      } catch {
        return null;
      }
      const owner = raw
        .split("\n")
        .map((line) => /^bg_task\/open:(\d+):(.+)$/u.exec(line))
        .find((match) => match?.[2] === threadId);
      return owner?.[1] === undefined ? null : Number(owner[1]);
    },
    async dispose() {
      if (previous === undefined) {
        delete process.env[SCRIPTED_ECHO_PROCESS_LOG_PATH_ENV];
      } else {
        process.env[SCRIPTED_ECHO_PROCESS_LOG_PATH_ENV] = previous;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

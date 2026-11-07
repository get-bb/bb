import {
  forkSession,
  type SessionKey,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { createWriteStream } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import { z } from "zod";

const transcriptEntrySchema = z.looseObject({ type: z.string() });
const TRANSCRIPT_READ_CHUNK_BYTES = 1024 * 1024;
const FORK_WORKER_TASK = "bb-claude-session-fork";
const forkWorkerTaskSchema = z.object({
  task: z.literal(FORK_WORKER_TASK),
  configDirectory: z.string(),
  sourceSessionId: z.string(),
  upToMessageId: z.string().optional(),
});

type ClaudeSessionFork = {
  configDirectory: string;
  sourceSessionId: string;
  upToMessageId: string | undefined;
};

export function claudeConfigDirectory(
  env: NodeJS.ProcessEnv,
  cwd: string,
): string {
  return resolve(cwd, env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
}

export function forkClaudeSession(args: ClaudeSessionFork): Promise<string> {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { task: FORK_WORKER_TASK, ...args },
    stdout: true,
  });
  worker.stdout.pipe(process.stderr, { end: false });
  return new Promise((resolve, reject) => {
    let forkedSessionId: string | undefined;
    worker.once("message", (message: unknown) => {
      if (typeof message === "string") {
        forkedSessionId = message;
      }
    });
    worker.once("error", (error) => {
      reject(
        isWorkerOutOfMemory(error)
          ? new Error(
              `Claude session ${args.sourceSessionId} is too large to fork: forking it ran out of memory`,
            )
          : error,
      );
    });
    worker.once("exit", () => {
      if (forkedSessionId === undefined) {
        reject(
          new Error(
            `Claude session fork worker exited before forking ${args.sourceSessionId}`,
          ),
        );
      } else {
        resolve(forkedSessionId);
      }
    });
  });
}

function isWorkerOutOfMemory(error: Error): boolean {
  return "code" in error && error.code === "ERR_WORKER_OUT_OF_MEMORY";
}

async function forkInThisThread(args: ClaudeSessionFork): Promise<string> {
  const result = await forkSession(args.sourceSessionId, {
    sessionStore: createProjectTranscriptStore(args.configDirectory),
    ...(args.upToMessageId !== undefined
      ? { upToMessageId: args.upToMessageId }
      : {}),
  });
  return result.sessionId;
}

function createProjectTranscriptStore(configDirectory: string): SessionStore {
  const projectsDirectory = join(configDirectory, "projects");
  let sourceProjectDirectory: string | undefined;
  return {
    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
      if (key.subpath !== undefined) {
        return null;
      }
      const found = await findTranscript(projectsDirectory, key.sessionId);
      if (found === null) {
        return null;
      }
      sourceProjectDirectory = found.projectDirectory;
      return found.entries;
    },
    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
      if (sourceProjectDirectory === undefined) {
        throw new Error(
          `Cannot write Claude session ${key.sessionId} before loading its source transcript`,
        );
      }
      await pipeline(
        serializeTranscript(entries),
        createWriteStream(
          join(sourceProjectDirectory, `${key.sessionId}.jsonl`),
          { mode: 0o600, flags: "wx" },
        ),
      );
    },
  };
}

function* serializeTranscript(entries: SessionStoreEntry[]): Generator<string> {
  for (const entry of entries) {
    yield `${JSON.stringify(entry)}\n`;
  }
}

async function findTranscript(
  projectsDirectory: string,
  sessionId: string,
): Promise<{ projectDirectory: string; entries: SessionStoreEntry[] } | null> {
  let projectDirectories: string[];
  try {
    projectDirectories = (
      await readdir(projectsDirectory, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(projectsDirectory, entry.name));
  } catch {
    return null;
  }
  for (const projectDirectory of projectDirectories) {
    let transcript: FileHandle;
    try {
      transcript = await open(join(projectDirectory, `${sessionId}.jsonl`));
    } catch {
      continue;
    }
    try {
      const entries = await parseTranscript(
        transcript.readLines({ highWaterMark: TRANSCRIPT_READ_CHUNK_BYTES }),
      );
      if (entries.length > 0) {
        return { projectDirectory, entries };
      }
    } finally {
      await transcript.close();
    }
  }
  return null;
}

async function parseTranscript(
  lines: AsyncIterable<string>,
): Promise<SessionStoreEntry[]> {
  const entries: SessionStoreEntry[] = [];
  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = transcriptEntrySchema.safeParse(value);
    if (parsed.success) {
      entries.push(parsed.data);
    }
  }
  return entries;
}

if (!isMainThread) {
  const task = forkWorkerTaskSchema.safeParse(workerData);
  if (task.success) {
    void forkInThisThread({
      configDirectory: task.data.configDirectory,
      sourceSessionId: task.data.sourceSessionId,
      upToMessageId: task.data.upToMessageId,
    }).then((sessionId) => {
      parentPort?.postMessage(sessionId);
    });
  }
}

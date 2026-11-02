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
import { z } from "zod";

const transcriptEntrySchema = z.looseObject({ type: z.string() });
const TRANSCRIPT_READ_CHUNK_BYTES = 1024 * 1024;

export function claudeConfigDirectory(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR
    ? resolve(env.CLAUDE_CONFIG_DIR)
    : join(homedir(), ".claude");
}

export async function forkClaudeSession(args: {
  configDirectory: string;
  sourceSessionId: string;
  upToMessageId: string | undefined;
}): Promise<string> {
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

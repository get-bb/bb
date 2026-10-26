import {
  forkSession,
  type SessionKey,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const transcriptEntrySchema = z.looseObject({ type: z.string() });

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
      return parseTranscript(found.contents);
    },
    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
      if (sourceProjectDirectory === undefined) {
        throw new Error(
          `Cannot write Claude session ${key.sessionId} before loading its source transcript`,
        );
      }
      await writeFile(
        join(sourceProjectDirectory, `${key.sessionId}.jsonl`),
        entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
        { mode: 0o600, flag: "wx" },
      );
    },
  };
}

async function findTranscript(
  projectsDirectory: string,
  sessionId: string,
): Promise<{ projectDirectory: string; contents: string } | null> {
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
    let contents: string;
    try {
      contents = await readFile(
        join(projectDirectory, `${sessionId}.jsonl`),
        "utf8",
      );
    } catch {
      continue;
    }
    if (contents.length > 0) {
      return { projectDirectory, contents };
    }
  }
  return null;
}

function parseTranscript(contents: string): SessionStoreEntry[] {
  const entries: SessionStoreEntry[] = [];
  for (const line of contents.split("\n")) {
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

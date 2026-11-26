import { open, readdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const transcriptEntrySchema = z.looseObject({
  type: z.string(),
  replMode: z.boolean().optional(),
});
const CONVERSATION_ENTRY_TYPES = new Set(["user", "assistant"]);

export async function readClaudeSessionCodeMode(args: {
  configDirectory: string;
  sessionId: string;
}): Promise<boolean> {
  const projectsDirectory = join(args.configDirectory, "projects");
  let projectDirectories: string[];
  try {
    projectDirectories = (
      await readdir(projectsDirectory, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(projectsDirectory, entry.name));
  } catch {
    return false;
  }
  for (const projectDirectory of projectDirectories) {
    let transcript: FileHandle;
    try {
      transcript = await open(
        join(projectDirectory, `${args.sessionId}.jsonl`),
      );
    } catch {
      continue;
    }
    try {
      return await readCodeModeMarker(transcript);
    } finally {
      await transcript.close();
    }
  }
  return false;
}

async function readCodeModeMarker(transcript: FileHandle): Promise<boolean> {
  for await (const line of transcript.readLines()) {
    if (line.trim().length === 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = transcriptEntrySchema.safeParse(value);
    if (!entry.success) {
      continue;
    }
    if (entry.data.type === "repl-mode") {
      return entry.data.replMode === true;
    }
    if (CONVERSATION_ENTRY_TYPES.has(entry.data.type)) {
      return false;
    }
  }
  return false;
}

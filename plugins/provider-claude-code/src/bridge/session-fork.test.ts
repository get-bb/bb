import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forkClaudeSession } from "./session-fork.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: () => Promise.reject(new RangeError("Invalid string length")),
  writeFile: () => Promise.reject(new RangeError("Invalid string length")),
}));

describe("forkClaudeSession", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("forks a transcript that Node cannot read or write as one string", async () => {
    const configDirectory = mkdtempSync(join(tmpdir(), "bb-claude-fork-"));
    tempDirs.push(configDirectory);
    const transcriptDir = join(configDirectory, "projects", "-tmp-worktree");
    mkdirSync(transcriptDir, { recursive: true });
    const sourceSessionId = randomUUID();
    const messageIds = [randomUUID(), randomUUID(), randomUUID()];
    writeFileSync(
      join(transcriptDir, `${sourceSessionId}.jsonl`),
      [
        { role: "user", text: "first question" },
        { role: "assistant", text: "first answer" },
        { role: "user", text: "discarded follow-up" },
      ]
        .map((message, index) =>
          JSON.stringify({
            type: message.role,
            uuid: messageIds[index],
            parentUuid: index === 0 ? null : messageIds[index - 1],
            sessionId: sourceSessionId,
            cwd: "/tmp/worktree",
            isSidechain: false,
            timestamp: `2026-10-31T00:00:0${index}.000Z`,
            message: { role: message.role, content: message.text },
          }),
        )
        .join("\n") + "\n",
    );

    const checkpointSessionId = await forkClaudeSession({
      configDirectory,
      sourceSessionId,
      upToMessageId: messageIds[1],
    });
    const fullSessionId = await forkClaudeSession({
      configDirectory,
      sourceSessionId,
      upToMessageId: undefined,
    });

    const checkpoint = readFileSync(
      join(transcriptDir, `${checkpointSessionId}.jsonl`),
      "utf8",
    );
    expect(checkpoint).toContain("first answer");
    expect(checkpoint).not.toContain("discarded follow-up");
    const full = readFileSync(
      join(transcriptDir, `${fullSessionId}.jsonl`),
      "utf8",
    );
    expect(full).toContain("discarded follow-up");
  });
});

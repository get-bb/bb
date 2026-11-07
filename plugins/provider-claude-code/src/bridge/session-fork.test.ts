import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { claudeConfigDirectory, forkClaudeSession } from "./session-fork.js";

const execFileAsync = promisify(execFile);

describe("forkClaudeSession", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createConfigDirectory(): {
    configDirectory: string;
    transcriptDir: string;
  } {
    const configDirectory = mkdtempSync(join(tmpdir(), "bb-claude-fork-"));
    tempDirs.push(configDirectory);
    const transcriptDir = join(configDirectory, "projects", "-tmp-worktree");
    mkdirSync(transcriptDir, { recursive: true });
    return { configDirectory, transcriptDir };
  }

  it("rejects with the SDK's error when the source session does not exist", async () => {
    const { configDirectory } = createConfigDirectory();
    const sourceSessionId = randomUUID();

    await expect(
      forkClaudeSession({
        configDirectory,
        sourceSessionId,
        upToMessageId: undefined,
      }),
    ).rejects.toThrow(`Session ${sourceSessionId} not found`);
  });

  it("fails a fork that runs out of memory without stopping the calling thread", async () => {
    const { configDirectory, transcriptDir } = createConfigDirectory();
    const sourceSessionId = randomUUID();
    const toolOutput = "x".repeat(64 * 1024);
    const descriptor = openSync(
      join(transcriptDir, `${sourceSessionId}.jsonl`),
      "w",
    );
    let parentUuid: string | null = null;
    for (let bytes = 0; bytes < 128 * 1024 * 1024; ) {
      const uuid = randomUUID();
      const line = `${JSON.stringify({
        type: "user",
        uuid,
        parentUuid,
        sessionId: sourceSessionId,
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: uuid, content: toolOutput },
          ],
        },
      })}\n`;
      writeSync(descriptor, line);
      bytes += line.length;
      parentUuid = uuid;
    }
    closeSync(descriptor);
    const sessionForkModule = new URL("./session-fork.ts", import.meta.url);

    const callerScript = join(configDirectory, "fork-caller.mjs");
    writeFileSync(
      callerScript,
      `import { forkClaudeSession } from ${JSON.stringify(sessionForkModule.href)};
const callerState = Array.from({ length: 1000 }, (_, index) => index);
try {
  await forkClaudeSession(${JSON.stringify({ configDirectory, sourceSessionId })});
  console.log("forked");
} catch (error) {
  console.log(error.message);
}
console.log("caller still running with " + callerState.length + " entries");
`,
    );

    const { stdout } = await execFileAsync(process.execPath, [
      "--max-old-space-size=32",
      "--no-warnings",
      callerScript,
    ]);

    expect(stdout).toBe(
      `Claude session ${sourceSessionId} is too large to fork: forking it ran out of memory\ncaller still running with 1000 entries\n`,
    );
  }, 30_000);
});

describe("claudeConfigDirectory", () => {
  const cwd = resolve("/workspace");

  it("resolves a relative CLAUDE_CONFIG_DIR against the session's cwd", () => {
    expect(claudeConfigDirectory({ CLAUDE_CONFIG_DIR: "profile" }, cwd)).toBe(
      join(cwd, "profile"),
    );
  });

  it("uses ~/.claude when CLAUDE_CONFIG_DIR is unset or empty", () => {
    expect(claudeConfigDirectory({}, cwd)).toBe(join(homedir(), ".claude"));
    expect(claudeConfigDirectory({ CLAUDE_CONFIG_DIR: "" }, cwd)).toBe(
      join(homedir(), ".claude"),
    );
  });
});

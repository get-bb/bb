import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveClaudeCodeExecutable } from "../session-options.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeWinBin(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-claude-win-"));
  tempDirs.push(dir);
  return dir;
}

function writeWinFile(dir: string, name: string, content = "@echo off"): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, content);
  try {
    chmodSync(filePath, 0o755);
  } catch {}
  return filePath;
}

describe("resolveClaudeCodeExecutable win32", () => {
  it("prefers a .cmd shim over an extensionless shim on win32", () => {
    const binDir = makeWinBin();
    writeWinFile(binDir, "claude", "#!/bin/sh\nexit 0\n");
    const cmdPath = writeWinFile(binDir, "claude.cmd");
    const resolved = resolveClaudeCodeExecutable({
      env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD;.PS1" },
      platform: "win32",
    });
    expect(resolved?.toLowerCase()).toBe(cmdPath.toLowerCase());
  });

  it("keeps posix order untouched when a .cmd sibling exists", () => {
    const binDir = makeWinBin();
    const shimPath = writeWinFile(binDir, "claude", "#!/bin/sh\nexit 0\n");
    writeWinFile(binDir, "claude.cmd");
    const resolved = resolveClaudeCodeExecutable({
      env: { PATH: binDir },
      platform: "linux",
    });
    expect(resolved).toBe(shimPath);
  });

  it("resolves an explicit extensionless path to its .cmd sibling on win32", () => {
    const binDir = makeWinBin();
    const shimPath = writeWinFile(binDir, "claude", "#!/bin/sh\nexit 0\n");
    const cmdPath = writeWinFile(binDir, "claude.cmd");
    const resolved = resolveClaudeCodeExecutable({
      env: { BB_CLAUDE_CODE_EXECUTABLE: shimPath },
      platform: "win32",
    });
    expect(resolved?.toLowerCase()).toBe(cmdPath.toLowerCase());
  });

  it("uses PATHEXT order across PATH entries on win32", () => {
    const firstDir = makeWinBin();
    const secondDir = makeWinBin();
    writeWinFile(firstDir, "claude", "#!/bin/sh\nexit 0\n");
    const cmdPath = writeWinFile(secondDir, "claude.cmd");
    const resolved = resolveClaudeCodeExecutable({
      env: {
        PATH: [firstDir, secondDir].join(delimiter),
        PATHEXT: ".COM;.EXE;.BAT;.CMD;.PS1",
      },
      platform: "win32",
    });
    expect(resolved?.toLowerCase()).toBe(cmdPath.toLowerCase());
  });
});

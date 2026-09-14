import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWindowsTerminalShell } from "./terminal-windows-shell.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

describe("resolveWindowsTerminalShell", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "PATH",
      "Path",
      "ProgramFiles",
      "SystemRoot",
      "LOCALAPPDATA",
    ]) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  async function makeShellDir(
    prefix: string,
    fileName: string,
  ): Promise<string> {
    const directory = await makeTempDir(prefix);
    const shellPath = path.join(directory, fileName);
    await fs.writeFile(shellPath, "");
    await fs.chmod(shellPath, 0o755);
    return directory;
  }

  it("prefers pwsh.exe over powershell.exe regardless of PATH order", async () => {
    const powershellDir = await makeShellDir(
      "bb-terminal-resolver-ps-",
      "powershell.exe",
    );
    const pwshDir = await makeShellDir(
      "bb-terminal-resolver-pwsh-",
      "pwsh.exe",
    );
    process.env.PATH = [powershellDir, pwshDir].join(";");
    process.env.ProgramFiles = await makeTempDir("bb-terminal-resolver-pf-");
    process.env.SystemRoot = await makeTempDir("bb-terminal-resolver-sr-");
    process.env.LOCALAPPDATA = await makeTempDir("bb-terminal-resolver-la-");

    await expect(resolveWindowsTerminalShell()).resolves.toBe(
      path.join(pwshDir, "pwsh.exe"),
    );

    process.env.PATH = [pwshDir, powershellDir].join(";");
    await expect(resolveWindowsTerminalShell()).resolves.toBe(
      path.join(pwshDir, "pwsh.exe"),
    );
  });

  it("prefers a standard-location pwsh over a PATH powershell", async () => {
    const powershellDir = await makeShellDir(
      "bb-terminal-resolver-ps2-",
      "powershell.exe",
    );
    const programFiles = await makeTempDir("bb-terminal-resolver-pf3-");
    const pwshDir = path.join(programFiles, "PowerShell", "7");
    await fs.mkdir(pwshDir, { recursive: true });
    const pwshPath = path.join(pwshDir, "pwsh.exe");
    await fs.writeFile(pwshPath, "");
    await fs.chmod(pwshPath, 0o755);

    process.env.PATH = powershellDir;
    process.env.ProgramFiles = programFiles;
    process.env.SystemRoot = await makeTempDir("bb-terminal-resolver-sr3-");
    process.env.LOCALAPPDATA = await makeTempDir("bb-terminal-resolver-la3-");

    await expect(resolveWindowsTerminalShell()).resolves.toBe(pwshPath);
  });

  it("falls back to Windows PowerShell under SystemRoot when PATH has neither shell", async () => {
    const emptyPath = await makeTempDir("bb-terminal-resolver-empty-");
    const systemRoot = await makeTempDir("bb-terminal-resolver-root-");
    const windowsPowerShellDir = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
    );
    await fs.mkdir(windowsPowerShellDir, { recursive: true });
    const powershellPath = path.join(windowsPowerShellDir, "powershell.exe");
    await fs.writeFile(powershellPath, "");
    await fs.chmod(powershellPath, 0o755);

    process.env.PATH = emptyPath;
    process.env.ProgramFiles = await makeTempDir("bb-terminal-resolver-pf2-");
    process.env.SystemRoot = systemRoot;
    process.env.LOCALAPPDATA = await makeTempDir("bb-terminal-resolver-la2-");

    await expect(resolveWindowsTerminalShell()).resolves.toBe(powershellPath);
  });

  it("fails with one clear message when neither PowerShell exists", async () => {
    const emptyPath = await makeTempDir("bb-terminal-resolver-none-path-");
    const emptyRoot = await makeTempDir("bb-terminal-resolver-none-root-");
    process.env.PATH = emptyPath;
    process.env.ProgramFiles = await makeTempDir(
      "bb-terminal-resolver-none-pf-",
    );
    process.env.SystemRoot = emptyRoot;
    process.env.LOCALAPPDATA = await makeTempDir(
      "bb-terminal-resolver-none-la-",
    );

    await expect(resolveWindowsTerminalShell()).rejects.toThrow(
      "No PowerShell was found on this machine. Install PowerShell 7 (pwsh) or use the built-in Windows PowerShell.",
    );
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listWindowsTerminalShells,
  resolveWindowsTerminalShell,
  terminalShellFamily,
  windowsTerminalSpawnArgs,
} from "./terminal-windows-shell.js";

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
      "ProgramFiles(x86)",
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

  async function makeExecutableFile(
    directory: string,
    fileName: string,
  ): Promise<string> {
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, fileName);
    await fs.writeFile(filePath, "");
    await fs.chmod(filePath, 0o755);
    return filePath;
  }

  async function makeShellDir(
    prefix: string,
    fileName: string,
  ): Promise<string> {
    const directory = await makeTempDir(prefix);
    await makeExecutableFile(directory, fileName);
    return directory;
  }

  async function setEmptyInstallLocations(): Promise<void> {
    process.env.ProgramFiles = await makeTempDir("bb-terminal-resolver-pf-");
    process.env["ProgramFiles(x86)"] = await makeTempDir(
      "bb-terminal-resolver-pfx86-",
    );
    process.env.SystemRoot = await makeTempDir("bb-terminal-resolver-sr-");
    process.env.LOCALAPPDATA = await makeTempDir("bb-terminal-resolver-la-");
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
    await setEmptyInstallLocations();

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
    const pwshPath = await makeExecutableFile(
      path.join(programFiles, "PowerShell", "7"),
      "pwsh.exe",
    );

    process.env.PATH = powershellDir;
    await setEmptyInstallLocations();
    process.env.ProgramFiles = programFiles;

    await expect(resolveWindowsTerminalShell()).resolves.toBe(pwshPath);
  });

  it("falls back to Windows PowerShell under SystemRoot when PATH has neither shell", async () => {
    const emptyPath = await makeTempDir("bb-terminal-resolver-empty-");
    const systemRoot = await makeTempDir("bb-terminal-resolver-root-");
    const powershellPath = await makeExecutableFile(
      path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
      "powershell.exe",
    );

    process.env.PATH = emptyPath;
    await setEmptyInstallLocations();
    process.env.SystemRoot = systemRoot;

    await expect(resolveWindowsTerminalShell()).resolves.toBe(powershellPath);
  });

  it("fails with one clear message when no shell exists", async () => {
    process.env.PATH = await makeTempDir("bb-terminal-resolver-none-path-");
    await setEmptyInstallLocations();

    await expect(resolveWindowsTerminalShell()).rejects.toThrow(
      "No shell was found on this machine. Install PowerShell 7 (pwsh), Windows PowerShell, or Git for Windows.",
    );
  });

  it("lists every detected shell with the default first", async () => {
    const pwshDir = await makeShellDir(
      "bb-terminal-resolver-list-pwsh-",
      "pwsh.exe",
    );
    const powershellDir = await makeShellDir(
      "bb-terminal-resolver-list-ps-",
      "powershell.exe",
    );
    const programFiles = await makeTempDir("bb-terminal-resolver-list-pf-");
    const gitBashPath = await makeExecutableFile(
      path.join(programFiles, "Git", "bin"),
      "bash.exe",
    );

    process.env.PATH = [pwshDir, powershellDir].join(";");
    await setEmptyInstallLocations();
    process.env.ProgramFiles = programFiles;

    await expect(listWindowsTerminalShells()).resolves.toEqual([
      {
        id: "pwsh",
        isDefault: true,
        label: "PowerShell 7",
        path: path.join(pwshDir, "pwsh.exe"),
      },
      {
        id: "powershell",
        isDefault: false,
        label: "Windows PowerShell",
        path: path.join(powershellDir, "powershell.exe"),
      },
      {
        id: "git-bash",
        isDefault: false,
        label: "Git Bash",
        path: gitBashPath,
      },
    ]);
  });

  it("finds Git Bash beside a git.exe on PATH", async () => {
    const gitInstall = await makeTempDir("bb-terminal-resolver-git-");
    await makeExecutableFile(path.join(gitInstall, "cmd"), "git.exe");
    const gitBashPath = await makeExecutableFile(
      path.join(gitInstall, "bin"),
      "bash.exe",
    );

    process.env.PATH = path.join(gitInstall, "cmd");
    await setEmptyInstallLocations();

    await expect(resolveWindowsTerminalShell("git-bash")).resolves.toBe(
      gitBashPath,
    );
  });

  it("uses Git Bash as the default when it is the only shell", async () => {
    const programFiles = await makeTempDir("bb-terminal-resolver-only-pf-");
    const gitBashPath = await makeExecutableFile(
      path.join(programFiles, "Git", "bin"),
      "bash.exe",
    );

    process.env.PATH = await makeTempDir("bb-terminal-resolver-only-path-");
    await setEmptyInstallLocations();
    process.env.ProgramFiles = programFiles;

    await expect(listWindowsTerminalShells()).resolves.toEqual([
      {
        id: "git-bash",
        isDefault: true,
        label: "Git Bash",
        path: gitBashPath,
      },
    ]);
  });

  it("falls back to the default shell for an unknown shell id", async () => {
    const pwshDir = await makeShellDir(
      "bb-terminal-resolver-fallback-",
      "pwsh.exe",
    );
    process.env.PATH = pwshDir;
    await setEmptyInstallLocations();

    await expect(resolveWindowsTerminalShell("nope")).resolves.toBe(
      path.join(pwshDir, "pwsh.exe"),
    );
    await expect(resolveWindowsTerminalShell("__automatic__")).resolves.toBe(
      path.join(pwshDir, "pwsh.exe"),
    );
  });
});

describe("terminalShellFamily", () => {
  it("classifies PowerShell shells apart from posix shells", () => {
    expect(
      terminalShellFamily("C:\\Program Files\\PowerShell\\7\\pwsh.exe"),
    ).toBe("powershell");
    expect(
      terminalShellFamily(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ),
    ).toBe("powershell");
    expect(terminalShellFamily("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(
      "posix",
    );
    expect(terminalShellFamily("/bin/zsh")).toBe("posix");
  });
});

describe("windowsTerminalSpawnArgs", () => {
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";

  it("starts Git Bash like its own launcher and leaves commands to posix args", () => {
    expect(windowsTerminalSpawnArgs({ mode: "shell" }, gitBash)).toEqual([
      "--login",
      "-i",
    ]);
    expect(
      windowsTerminalSpawnArgs({ mode: "command", command: "ls" }, gitBash),
    ).toBeNull();
  });

  it("ignores non-bash posix shells so the generic args apply", () => {
    expect(windowsTerminalSpawnArgs({ mode: "shell" }, "/bin/zsh")).toBeNull();
  });

  it("uses PowerShell arguments for PowerShell shells", () => {
    expect(windowsTerminalSpawnArgs({ mode: "shell" }, "C:\\pwsh.exe")).toEqual(
      ["-NoLogo"],
    );
    expect(
      windowsTerminalSpawnArgs(
        { mode: "command", command: "Write-Output hi" },
        "C:\\pwsh.exe",
      ),
    ).toEqual(["-NoLogo", "-Command", "Write-Output hi"]);
  });
});

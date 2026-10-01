import { describe, expect, it } from "vitest";
import {
  resolveWindowsTerminalShell,
  terminalShellArgs,
  terminalShellKind,
  terminalShellTitle,
} from "./terminal-shell.js";

const POWERSHELL_7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const WINDOWS_POWERSHELL =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

describe("terminal shell policy", () => {
  it("classifies shells by program name", () => {
    expect(terminalShellKind("/bin/zsh")).toBe("posix");
    expect(terminalShellKind("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(
      "posix",
    );
    expect(terminalShellKind(POWERSHELL_7)).toBe("powershell");
    expect(terminalShellKind(WINDOWS_POWERSHELL)).toBe("powershell");
    expect(terminalShellKind("C:\\Windows\\System32\\CMD.EXE")).toBe("cmd");
  });

  it("passes a command in each shell's own syntax", () => {
    const start = { mode: "command", command: "pnpm dev" } as const;
    expect(terminalShellArgs({ shell: "/bin/zsh", start })).toEqual([
      "-lc",
      "pnpm dev",
    ]);
    expect(terminalShellArgs({ shell: POWERSHELL_7, start })).toEqual([
      "-NoLogo",
      "-Command",
      "pnpm dev",
    ]);
    expect(
      terminalShellArgs({ shell: "C:\\Windows\\System32\\cmd.exe", start }),
    ).toEqual(["/d", "/s", "/c", "pnpm dev"]);
  });

  it("starts an interactive shell without a command", () => {
    const start = { mode: "shell" } as const;
    expect(terminalShellArgs({ shell: "/bin/zsh", start })).toEqual([]);
    expect(terminalShellArgs({ shell: WINDOWS_POWERSHELL, start })).toEqual([
      "-NoLogo",
    ]);
  });

  it("titles a terminal after the shell program", () => {
    expect(terminalShellTitle("/bin/zsh")).toBe("zsh");
    expect(terminalShellTitle(POWERSHELL_7)).toBe("pwsh");
    expect(terminalShellTitle("")).toBe("Terminal");
  });

  it("prefers PowerShell 7 on PATH, then Windows PowerShell, then ComSpec", async () => {
    const env = {
      Path: "C:\\tools;C:\\Program Files\\PowerShell\\7",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    };
    const existing = (paths: string[]) => async (filePath: string) =>
      paths.includes(filePath);

    expect(
      await resolveWindowsTerminalShell({
        env,
        fileExists: existing([POWERSHELL_7, WINDOWS_POWERSHELL]),
      }),
    ).toBe(POWERSHELL_7);
    expect(
      await resolveWindowsTerminalShell({
        env,
        fileExists: existing([WINDOWS_POWERSHELL]),
      }),
    ).toBe(WINDOWS_POWERSHELL);
    expect(
      await resolveWindowsTerminalShell({ env, fileExists: existing([]) }),
    ).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(
      await resolveWindowsTerminalShell({ env: {}, fileExists: existing([]) }),
    ).toBe("cmd.exe");
  });
});

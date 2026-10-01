import path from "node:path";

export type TerminalShellKind = "posix" | "powershell" | "cmd";

export type TerminalShellStart =
  | { mode: "shell" }
  | { mode: "command"; command: string };

interface ResolveWindowsTerminalShellArgs {
  env: NodeJS.ProcessEnv;
  fileExists: (filePath: string) => Promise<boolean>;
}

const WINDOWS_POWERSHELL_RELATIVE_PATH = path.win32.join(
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

function shellProgramName(shell: string): string {
  const basename = shell.includes("\\")
    ? path.win32.basename(shell)
    : path.posix.basename(shell);
  return basename.toLowerCase().replace(/\.exe$/u, "");
}

export function terminalShellKind(shell: string): TerminalShellKind {
  const programName = shellProgramName(shell);
  if (programName === "pwsh" || programName === "powershell") {
    return "powershell";
  }
  if (programName === "cmd") {
    return "cmd";
  }
  return "posix";
}

export function terminalShellArgs(args: {
  shell: string;
  start: TerminalShellStart;
}): string[] {
  const kind = terminalShellKind(args.shell);
  if (args.start.mode === "shell") {
    return kind === "powershell" ? ["-NoLogo"] : [];
  }
  switch (kind) {
    case "powershell":
      return ["-NoLogo", "-Command", args.start.command];
    case "cmd":
      return ["/d", "/s", "/c", args.start.command];
    case "posix":
      return ["-lc", args.start.command];
  }
}

export function terminalShellTitle(shell: string): string {
  const basename = shell.includes("\\")
    ? path.win32.basename(shell)
    : path.posix.basename(shell);
  return basename.replace(/\.exe$/iu, "") || "Terminal";
}

export async function resolveWindowsTerminalShell(
  args: ResolveWindowsTerminalShellArgs,
): Promise<string> {
  const searchPath = args.env.PATH ?? args.env.Path ?? "";
  for (const directory of searchPath.split(path.win32.delimiter)) {
    if (directory.length === 0) {
      continue;
    }
    const candidate = path.win32.join(directory, "pwsh.exe");
    if (await args.fileExists(candidate)) {
      return candidate;
    }
  }
  const systemRoot = args.env.SystemRoot ?? args.env.SYSTEMROOT;
  if (systemRoot !== undefined && systemRoot.length > 0) {
    const windowsPowerShell = path.win32.join(
      systemRoot,
      WINDOWS_POWERSHELL_RELATIVE_PATH,
    );
    if (await args.fileExists(windowsPowerShell)) {
      return windowsPowerShell;
    }
  }
  const commandInterpreter = args.env.ComSpec ?? args.env.COMSPEC;
  return commandInterpreter !== undefined && commandInterpreter.length > 0
    ? commandInterpreter
    : "cmd.exe";
}

import path from "node:path";

export interface SkillScriptInvocation {
  args: string[];
  command: string;
  text: string;
}

export interface ResolveSkillScriptInvocationOptions {
  nodeExePath?: string;
  platform?: NodeJS.Platform;
  scriptArgs?: readonly string[];
  shExePath?: string | null;
}

const WINDOWS_POWERSHELL_ARGS: readonly string[] = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
];

function invocationForExtension(args: {
  extension: string;
  nodeExePath: string | undefined;
  scriptArgs: readonly string[];
  scriptPath: string;
  shExePath: string | null | undefined;
}): SkillScriptInvocation | null {
  switch (args.extension) {
    case ".bat":
    case ".cmd":
      return {
        command: "cmd.exe",
        args: ["/d", "/c", args.scriptPath, ...args.scriptArgs],
        text: `cmd.exe /d /c ${path.win32.basename(args.scriptPath)}`,
      };
    case ".ps1":
      return {
        command: "powershell.exe",
        args: [
          ...WINDOWS_POWERSHELL_ARGS,
          args.scriptPath,
          ...args.scriptArgs,
        ],
        text: `powershell.exe -File ${path.win32.basename(args.scriptPath)}`,
      };
    case ".cjs":
    case ".js":
    case ".mjs":
      return {
        command: args.nodeExePath ?? process.execPath,
        args: [args.scriptPath, ...args.scriptArgs],
        text: `node ${path.win32.basename(args.scriptPath)}`,
      };
    case ".sh":
      if (args.shExePath === undefined || args.shExePath === null) {
        return null;
      }
      return {
        command: args.shExePath,
        args: [args.scriptPath, ...args.scriptArgs],
        text: `sh.exe ${path.win32.basename(args.scriptPath)}`,
      };
    default:
      return null;
  }
}

function extensionForPlatform(
  scriptPath: string,
  platform: NodeJS.Platform,
): string {
  return (
    platform === "win32"
      ? path.win32.extname(scriptPath)
      : path.extname(scriptPath)
  ).toLowerCase();
}

export function resolveSkillScriptInvocation(
  scriptPath: string,
  options: ResolveSkillScriptInvocationOptions = {},
): SkillScriptInvocation {
  const platform = options.platform ?? process.platform;
  const scriptArgs = options.scriptArgs ?? [];
  if (platform !== "win32") {
    return {
      command: scriptPath,
      args: [...scriptArgs],
      text: scriptPath,
    };
  }
  const extension = extensionForPlatform(scriptPath, platform);
  const invocation = invocationForExtension({
    extension,
    nodeExePath: options.nodeExePath,
    scriptArgs,
    scriptPath,
    shExePath: options.shExePath,
  });
  if (invocation !== null) {
    return invocation;
  }
  if (extension === ".sh") {
    throw new Error(
      `Skill script "${scriptPath}" needs a POSIX shell on Windows but no sh.exe path was provided (install Git for Windows and pass its sh.exe path)`,
    );
  }
  throw new Error(
    `Skill script "${scriptPath}" has no Windows launch mapping (extension "${extension}"): run it through an explicit interpreter (cmd.exe, powershell.exe, node, or Git sh.exe) instead of executing it directly`,
  );
}

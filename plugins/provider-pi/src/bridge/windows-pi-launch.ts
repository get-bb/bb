import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { whichCommandSync } from "which-command";
import { z } from "zod";

const piPackageSchema = z.object({
  bin: z.union([z.string().min(1), z.object({ pi: z.string().min(1) })]),
});

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isNpmNodeShim(contents: string, target: string): boolean {
  const normalized = contents.replace(/\r\n/g, "\n");
  const modern = [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\' +
      target +
      '" %*',
    "",
  ].join("\n");
  const legacy = [
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe"  "%~dp0\\' + target + '" %*',
    ") ELSE (",
    "  @SETLOCAL",
    "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
    '  node  "%~dp0\\' + target + '" %*',
    ")",
    "",
  ].join("\n");
  return normalized === modern || normalized === legacy;
}

export function resolvePiNpmShim(
  executablePath: string,
  nodeExecutable: string,
): { command: string; args: string[] } | null {
  if (path.basename(executablePath).toLowerCase() !== "pi.cmd") return null;
  const prefix = path.dirname(executablePath);
  const packageRoot =
    path.basename(prefix).toLowerCase() === ".bin" &&
    path.basename(path.dirname(prefix)).toLowerCase() === "node_modules"
      ? path.dirname(prefix)
      : path.join(prefix, "node_modules");
  const packagePath = path.join(
    packageRoot,
    "@earendil-works",
    "pi-coding-agent",
  );
  try {
    const packageDir = realpathSync(packagePath);
    const pkg = piPackageSchema.parse(
      JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")),
    );
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.pi;
    const lexicalCli = path.resolve(packagePath, bin);
    const cli = realpathSync(path.resolve(packageDir, bin));
    const relative = path.relative(packageDir, cli);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !isFile(cli)
    )
      return null;
    const target = path.relative(prefix, lexicalCli).split(path.sep).join("\\");
    if (!isNpmNodeShim(readFileSync(executablePath, "utf8"), target)) {
      return null;
    }
    const siblingNode = path.join(prefix, "node.exe");
    return {
      command: isFile(siblingNode) ? siblingNode : nodeExecutable,
      args: [cli],
    };
  } catch {
    return null;
  }
}

export function resolveWindowsPiProcessLaunch(
  launch: { command: string; args: string[] },
  env: NodeJS.ProcessEnv,
  cwd: string,
): { command: string; args: string[] } {
  if (process.platform !== "win32") return launch;
  const keys = Object.keys(env).sort();
  const options = {
    cwd,
    path: env[keys.find((key) => key.toUpperCase() === "PATH") ?? "PATH"] ?? "",
    pathExt:
      env[keys.find((key) => key.toUpperCase() === "PATHEXT") ?? "PATHEXT"] ??
      ".COM;.EXE;.BAT;.CMD",
  };
  const executable = whichCommandSync(launch.command, options);
  if (executable === undefined) return launch;
  const unwrapped = resolvePiNpmShim(
    executable,
    whichCommandSync("node", options) ?? "node",
  );
  return unwrapped === null
    ? launch
    : { command: unwrapped.command, args: [...unwrapped.args, ...launch.args] };
}

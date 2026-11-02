import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import { z } from "zod";

const piPackageSchema = z.object({
  bin: z.union([z.string().min(1), z.object({ pi: z.string().min(1) })]),
});

const managedInstallMarkerSchema = z.object({
  kind: z.literal("pi-managed-install"),
  schemaVersion: z.literal(1),
  layout: z.literal("releases-v1"),
});

const STANDALONE_NODE_LAUNCHER_LINE =
  'IF EXIST "%LOCALAPPDATA%\\pi-node\\current\\node.exe" SET "node=%LOCALAPPDATA%\\pi-node\\current\\node.exe"';

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

function resolvePiPackageCli(
  packagePath: string,
): { lexicalCli: string; cli: string } | null {
  const packageDir = realpathSync(packagePath);
  const pkg = piPackageSchema.parse(
    JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")),
  );
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.pi;
  const cli = realpathSync(path.resolve(packageDir, bin));
  const relative = path.relative(packageDir, cli);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !isFile(cli)
  )
    return null;
  return { lexicalCli: path.resolve(packagePath, bin), cli };
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
    const resolved = resolvePiPackageCli(packagePath);
    if (resolved === null) return null;
    const target = path
      .relative(prefix, resolved.lexicalCli)
      .split(path.sep)
      .join("\\");
    if (!isNpmNodeShim(readFileSync(executablePath, "utf8"), target)) {
      return null;
    }
    const siblingNode = path.join(prefix, "node.exe");
    return {
      command: isFile(siblingNode) ? siblingNode : nodeExecutable,
      args: [resolved.cli],
    };
  } catch {
    return null;
  }
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(
    (candidate) => candidate.toUpperCase() === name,
  );
  return key === undefined ? undefined : env[key];
}

export function resolvePiManagedLauncher(
  executablePath: string,
  env: NodeJS.ProcessEnv,
  nodeExecutable: string,
): { command: string; args: string[]; installRoot: string } | null {
  if (path.basename(executablePath).toLowerCase() !== "pi.cmd") return null;
  const binDir = path.dirname(executablePath);
  const installRoot = path.join(path.dirname(binDir), "install");
  try {
    const marker = managedInstallMarkerSchema.safeParse(
      JSON.parse(
        readFileSync(
          path.join(installRoot, "managed-install.json"),
          "utf8",
        ).replace(/^\uFEFF/u, ""),
      ),
    );
    if (!marker.success || !isFile(path.join(binDir, "pi-launcher.js"))) {
      return null;
    }
    const version = readFileSync(
      path.join(installRoot, "current-version"),
      "utf8",
    ).trim();
    if (
      version === "." ||
      version === ".." ||
      !/^[0-9A-Za-z._+-]+$/u.test(version)
    )
      return null;
    const resolved = resolvePiPackageCli(
      path.join(
        installRoot,
        "releases",
        version,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
      ),
    );
    if (resolved === null) return null;
    const localAppData = envValue(env, "LOCALAPPDATA");
    const standaloneNode =
      localAppData === undefined
        ? null
        : path.join(localAppData, "pi-node", "current", "node.exe");
    const usesStandaloneNode =
      standaloneNode !== null &&
      readFileSync(executablePath, "utf8").includes(
        STANDALONE_NODE_LAUNCHER_LINE,
      ) &&
      isFile(standaloneNode);
    return {
      command: usesStandaloneNode ? standaloneNode : nodeExecutable,
      args: [resolved.cli],
      installRoot,
    };
  } catch {
    return null;
  }
}

export function resolveWindowsPiProcessLaunch(
  launch: { command: string; args: string[] },
  env: NodeJS.ProcessEnv,
  cwd: string,
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (process.platform !== "win32") return { ...launch, env };
  const executable = hostToolchain.resolve(launch.command, { env, cwd });
  if (executable === null) return { ...launch, env };
  const nodeExecutable =
    hostToolchain.resolve("node.exe", { env, cwd }) ?? "node";
  const managed = resolvePiManagedLauncher(executable, env, nodeExecutable);
  if (managed !== null) {
    return {
      command: managed.command,
      args: [...managed.args, ...launch.args],
      env: { ...env, PI_MANAGED_INSTALL_ROOT: managed.installRoot },
    };
  }
  const unwrapped = resolvePiNpmShim(executable, nodeExecutable);
  return unwrapped === null
    ? { ...launch, env }
    : {
        command: unwrapped.command,
        args: [...unwrapped.args, ...launch.args],
        env,
      };
}

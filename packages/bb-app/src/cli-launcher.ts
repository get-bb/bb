import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { CLI_LAUNCHER_MARKER } from "@bb/config/cli-command";

const CLI_LAUNCHER_MOVED_MESSAGE =
  "bb has moved or been removed. Start bb once to update this command.";
const CLI_COMMAND_NAME = "bb";
const APPIMAGE_ENTRY_ENV_NAME = "BB_CLI_APPIMAGE_ENTRY";
const APPIMAGE_ARGUMENT_COUNT_ENV_NAME = "BB_CLI_APPIMAGE_ARGUMENT_COUNT";
const APPIMAGE_NO_SANDBOX_ARGUMENT = "--no-sandbox";
const APPIMAGE_BOOTSTRAP = [
  'const { resolve } = process.getBuiltinModule("node:path");',
  'const { pathToFileURL } = process.getBuiltinModule("node:url");',
  `const entry = resolve(process.env.APPDIR, process.env.${APPIMAGE_ENTRY_ENV_NAME});`,
  `const count = Number(process.env.${APPIMAGE_ARGUMENT_COUNT_ENV_NAME});`,
  "const rest = process.argv.slice(1, 1 + count);",
  "process.argv.splice(1, process.argv.length - 1, entry, ...rest);",
  `delete process.env.${APPIMAGE_ENTRY_ENV_NAME};`,
  `delete process.env.${APPIMAGE_ARGUMENT_COUNT_ENV_NAME};`,
  "await import(pathToFileURL(entry).href);",
].join(" ");

export type CliLauncherTarget =
  | {
      appImagePath: string;
      entryRelativePath: string;
      kind: "appimage";
    }
  | {
      electron: boolean;
      entryPath: string;
      kind: "direct";
      runtimePath: string;
    };

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function shellWord(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function cmdText(value: string): string {
  return value.replaceAll("%", "%%");
}

function cmdWord(value: string): string {
  return `"${cmdText(value)}"`;
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relativePath = relative(directory, candidate);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

export function formatCliLauncherPath(args: {
  dataDir: string;
  platform: NodeJS.Platform;
}): string {
  return join(
    args.dataDir,
    "bin",
    args.platform === "win32" ? `${CLI_COMMAND_NAME}.cmd` : CLI_COMMAND_NAME,
  );
}

export function resolveCliLauncherTarget(args: {
  electron: boolean;
  env: NodeJS.ProcessEnv;
  execPath: string;
  packageRoot: string;
  platform: NodeJS.Platform;
}): CliLauncherTarget {
  const entryPath = join(args.packageRoot, "dist", "bb.js");
  const appImagePath = args.env.APPIMAGE?.trim();
  const appDirPath = args.env.APPDIR?.trim();
  if (
    args.platform === "linux" &&
    args.electron &&
    appImagePath !== undefined &&
    appImagePath.length > 0 &&
    appDirPath !== undefined &&
    appDirPath.length > 0 &&
    isInsideDirectory(appDirPath, entryPath)
  ) {
    return {
      appImagePath,
      entryRelativePath: relative(appDirPath, entryPath),
      kind: "appimage",
    };
  }
  return {
    electron: args.electron,
    entryPath,
    kind: "direct",
    runtimePath: args.execPath,
  };
}

function renderWindowsCliLauncher(args: {
  dataDir: string;
  target: Extract<CliLauncherTarget, { kind: "direct" }>;
}): string {
  const paths = [args.target.runtimePath, args.target.entryPath, args.dataDir];
  const utf8 = paths.some((value) =>
    [...value].some((character) => (character.codePointAt(0) ?? 0) > 0x7f),
  );
  const restore = utf8 ? ["chcp %bb_codepage% >nul"] : [];
  return [
    "@echo off",
    `rem ${CLI_LAUNCHER_MARKER}`,
    "setlocal EnableExtensions DisableDelayedExpansion",
    ...(utf8
      ? [
          `for /f "tokens=2 delims=:." %%c in ('chcp') do set "bb_codepage=%%c"`,
          "chcp 65001 >nul",
        ]
      : []),
    `if not defined BB_DATA_DIR set "BB_DATA_DIR=${cmdText(args.dataDir)}"`,
    ...(args.target.electron ? ['set "ELECTRON_RUN_AS_NODE=1"'] : []),
    `if not exist ${cmdWord(args.target.runtimePath)} goto moved`,
    `if exist ${cmdWord(args.target.entryPath)} goto run`,
    ":moved",
    ...restore,
    `echo ${CLI_LAUNCHER_MOVED_MESSAGE} 1>&2`,
    "exit /b 127",
    ":run",
    `${cmdWord(args.target.runtimePath)} ${cmdWord(args.target.entryPath)} %*`,
    'set "bb_exit=%ERRORLEVEL%"',
    ...restore,
    "exit /b %bb_exit%",
    "",
  ].join("\r\n");
}

export function renderCliLauncher(args: {
  dataDir: string;
  platform: NodeJS.Platform;
  target: CliLauncherTarget;
}): string {
  const { target } = args;
  if (args.platform === "win32") {
    if (target.kind !== "direct") {
      throw new Error("An AppImage bb command launcher is Linux only.");
    }
    return renderWindowsCliLauncher({ dataDir: args.dataDir, target });
  }
  const header = [
    "#!/bin/sh",
    `# ${CLI_LAUNCHER_MARKER}`,
    `data_dir=${shellWord(args.dataDir)}`,
    'export BB_DATA_DIR="${BB_DATA_DIR:-$data_dir}"',
  ];
  const moved = [`  echo "${CLI_LAUNCHER_MOVED_MESSAGE}" >&2`, "  exit 127"];
  if (target.kind === "direct") {
    return [
      ...header,
      ...(target.electron ? ["export ELECTRON_RUN_AS_NODE=1"] : []),
      `runtime=${shellWord(target.runtimePath)}`,
      `entry=${shellWord(target.entryPath)}`,
      'if [ ! -x "$runtime" ] || [ ! -f "$entry" ]; then',
      ...moved,
      "fi",
      'exec "$runtime" "$entry" "$@"',
      "",
    ].join("\n");
  }
  return [
    ...header,
    "export ELECTRON_RUN_AS_NODE=1",
    `runtime=${shellWord(target.appImagePath)}`,
    'if [ ! -x "$runtime" ]; then',
    ...moved,
    "fi",
    `export ${APPIMAGE_ENTRY_ENV_NAME}=${shellWord(target.entryRelativePath)}`,
    `export ${APPIMAGE_ARGUMENT_COUNT_ENV_NAME}=$#`,
    `exec "$runtime" --input-type=module --eval ${shellWord(APPIMAGE_BOOTSTRAP)} -- "$@" ${APPIMAGE_NO_SANDBOX_ARGUMENT}`,
    "",
  ].join("\n");
}

export async function writeCliLauncher(args: {
  content: string;
  launcherPath: string;
}): Promise<"foreign" | "unchanged" | "written"> {
  let existing: string | null = null;
  try {
    existing = await readFile(args.launcherPath, "utf8");
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  if (existing !== null && !existing.includes(CLI_LAUNCHER_MARKER)) {
    return "foreign";
  }
  if (existing === args.content) {
    return "unchanged";
  }
  await mkdir(dirname(args.launcherPath), { recursive: true });
  const stagingPath = `${args.launcherPath}.${process.pid}.tmp`;
  try {
    await writeFile(stagingPath, args.content, { mode: 0o755 });
    await rename(stagingPath, args.launcherPath);
  } finally {
    await rm(stagingPath, { force: true });
  }
  return "written";
}

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  WORKSPACE_OPEN_TARGET_ICON_DATA_URL_MAX_LENGTH,
  type WorkspaceOpenTarget,
  type WorkspaceOpenTargetCapabilities,
  type WorkspaceOpenTargetIcon,
  type WorkspaceOpenTargetId,
  type WorkspaceOpenTargetKind,
} from "@bb/host-daemon-contract";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";

const execFileAsync = promisify(execFile);
const DESKTOP_APP_TARGET_ID_PREFIX = "desktop-app:";
const MAC_APP_TARGET_ID_PREFIX = "mac-app:";
const MAC_FILE_APPLICATION_DISCOVERY_LIMIT = 5;
const MAC_APPLICATION_ICON_THUMBNAIL_SIZE_PX = 32;
const MAC_APPLICATIONS_FOR_FILE_SCRIPT = `
function run(argv) {
  ObjC.import("AppKit");
  const filePath = argv[0];
  const url = $.NSURL.fileURLWithPath(filePath);
  const applications = $.NSWorkspace.sharedWorkspace.URLsForApplicationsToOpenURL(url);
  const output = [];
  for (let index = 0; index < applications.count; index += 1) {
    const applicationUrl = applications.objectAtIndex(index);
    const bundle = $.NSBundle.bundleWithURL(applicationUrl);
    const bundleId = bundle ? ObjC.unwrap(bundle.bundleIdentifier) : null;
    output.push({
      appPath: ObjC.unwrap(applicationUrl.path),
      bundleId,
    });
  }
  return JSON.stringify(output);
}
`;
const macApplicationsForFileResultSchema = z.array(
  z
    .object({
      appPath: z.string().min(1),
      bundleId: z.string().min(1).nullable(),
    })
    .strict(),
);

export type WorkspaceOpenTargetErrorCode =
  | "path_not_found"
  | "path_not_openable"
  | "remote_mapping_missing"
  | "remote_target_unsupported"
  | "target_unavailable"
  | "unsupported_platform";

export interface WorkspaceOpenTargetErrorOptions {
  code: WorkspaceOpenTargetErrorCode;
  message: string;
}

export class WorkspaceOpenTargetError extends Error {
  readonly code: WorkspaceOpenTargetErrorCode;

  constructor(options: WorkspaceOpenTargetErrorOptions) {
    super(options.message);
    this.name = "WorkspaceOpenTargetError";
    this.code = options.code;
  }
}

export interface OpenPathInTargetArgs {
  columnNumber: number | null;
  context: OpenPathInTargetContext;
  lineNumber: number | null;
  path: string;
  targetId: WorkspaceOpenTargetId;
}

export interface ListWorkspaceOpenTargetsOptions {
  path?: string;
}

interface ExecFileResult {
  stdout: string;
}

type ExecFileHandler = (
  file: string,
  args: string[],
) => Promise<ExecFileResult>;

export interface WorkspaceOpenTargetRuntime {
  applicationDirectories: string[];
  desktopFileDirectories?: string[];
  env?: NodeJS.ProcessEnv;
  execFile: ExecFileHandler;
  platform: NodeJS.Platform;
}

interface MacDefaultLaunchAdapter {
  openMode: "default-app";
}

interface MacApplicationLaunchAdapter {
  appName: string;
  bundleIds: string[];
  builtIn: boolean;
  fileOpenCommand?: MacFileOpenCommandAdapter;
  lineOpenCommand?: MacLineOpenCommandAdapter;
  localTerminalOpenCommand?: MacLocalTerminalOpenCommandAdapter;
  openMode: "application";
  pathOpenCommand?: MacPathOpenCommandAdapter;
  remoteSshOpenCommand?: MacRemoteSshOpenCommandAdapter;
}

type MacLaunchAdapter = MacApplicationLaunchAdapter | MacDefaultLaunchAdapter;

interface LaunchAdapter {
  capabilities: WorkspaceOpenTargetCapabilities;
  fileOpenBehavior: "direct" | "containing-directory";
  icon: WorkspaceOpenTargetIcon;
  id: WorkspaceOpenTargetId;
  kind: WorkspaceOpenTargetKind;
  label: string;
  macos: MacLaunchAdapter;
}

interface ExecFileInvocation {
  args: string[];
  file: string;
}

interface BuildMacLineOpenArgs {
  columnNumber: number | null;
  lineNumber: number;
  path: string;
}

interface BuildMacTerminalOpenArgs {
  columnNumber: number | null;
  lineNumber: number | null;
  path: string;
}

interface BuildMacRemoteSshOpenArgs {
  columnNumber: number | null;
  lineNumber: number | null;
  path: string;
  sshAuthority: string;
}

interface MacLineOpenCommandAdapter {
  executable: string;
  supportsColumn: boolean;
  toArgs: (args: BuildMacLineOpenArgs) => string[];
}

interface MacPathOpenCommandAdapter {
  executable: string;
  toArgs: (path: string) => string[];
}

interface MacFileOpenCommandAdapter {
  executable: string;
  toArgs: (path: string) => string[];
}

interface MacLocalTerminalOpenCommandAdapter {
  executable: string;
  toArgs: (args: BuildMacTerminalOpenArgs) => string[];
}

interface MacRemoteSshOpenCommandAdapter {
  capabilities: WorkspaceOpenTargetCapabilities;
  executable: string;
  requiredExecutables?: string[];
  toArgs: (args: BuildMacRemoteSshOpenArgs) => string[];
}

interface PlatformOpenInvocationArgs {
  columnNumber: number | null;
  existingPath: ExistingPath;
  lineNumber: number | null;
}

interface PlatformRemoteSshOpenInvocationArgs {
  columnNumber: number | null;
  lineNumber: number | null;
  path: string;
  sshAuthority: string;
}

interface ResolveMacOpenInvocationArgs {
  columnNumber: number | null;
  definition: LaunchAdapter;
  existingPath: ExistingPath;
  lineNumber: number | null;
}

interface ResolveMacRemoteSshOpenInvocationArgs {
  columnNumber: number | null;
  definition: LaunchAdapter;
  lineNumber: number | null;
  path: string;
  sshAuthority: string;
}

interface ResolveTargetOpenPathArgs {
  definition: LaunchAdapter;
  existingPath: ExistingPath;
}

interface ResolveMacTargetIconArgs {
  appPath: string | null;
  definition: LaunchAdapter;
  runtime: WorkspaceOpenTargetRuntime;
}

interface DiscoveredMacApplication {
  appPath: string;
  bundleId: string | null;
  label: string;
}

interface LinuxDesktopApplication {
  desktopFileId: string;
  desktopFilePath: string;
  exec: string;
  label: string;
}

type OpenPathInTargetContext =
  | { kind: "local" }
  | {
      kind: "remote-ssh";
      serverOrigin: string;
      hostId: string;
      sshAuthority: string;
    };

function formatPathWithLineNumber(args: BuildMacLineOpenArgs): string {
  return args.columnNumber === null
    ? `${args.path}:${args.lineNumber}`
    : `${args.path}:${args.lineNumber}:${args.columnNumber}`;
}

function formatJetBrainsLineOpenArgs(args: BuildMacLineOpenArgs): string[] {
  return ["--line", String(args.lineNumber), args.path];
}

function formatZedRemoteSshUri(args: BuildMacRemoteSshOpenArgs): string {
  const absolutePath = args.path.startsWith("/") ? args.path : `/${args.path}`;
  const encodedPath = absolutePath.split("/").map(encodeURIComponent).join("/");
  const uri = `ssh://${args.sshAuthority}${encodedPath}`;
  if (args.lineNumber === null) {
    return uri;
  }
  return args.columnNumber === null
    ? `${uri}:${args.lineNumber}`
    : `${uri}:${args.lineNumber}:${args.columnNumber}`;
}

function quoteShellArg(value: string): string {
  if (value === "") {
    return "''";
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildTerminalShellScript(args: BuildMacTerminalOpenArgs): string {
  const line = args.lineNumber === null ? "" : String(args.lineNumber);
  const column = args.columnNumber === null ? "" : String(args.columnNumber);
  const editorScript = [
    "editor=''",
    'if [ -n "${VISUAL:-}" ]; then editor=$VISUAL; elif [ -n "${EDITOR:-}" ]; then editor=$EDITOR; elif command -v nvim >/dev/null 2>&1; then editor=nvim; elif command -v vim >/dev/null 2>&1; then editor=vim; elif command -v vi >/dev/null 2>&1; then editor=vi; elif command -v nano >/dev/null 2>&1; then editor=nano; elif command -v less >/dev/null 2>&1; then editor=less; fi',
    'if [ -n "$editor" ]; then editor_name=$(basename "$editor"); case "$editor_name" in nvim|vim|vi) if [ -n "$line" ] && [ -n "$column" ]; then "$editor" "+call cursor($line,$column)" "$file"; elif [ -n "$line" ]; then "$editor" "+$line" "$file"; else "$editor" "$file"; fi ;; nano) if [ -n "$line" ] && [ -n "$column" ]; then "$editor" "+$line,$column" "$file"; elif [ -n "$line" ]; then "$editor" "+$line" "$file"; else "$editor" "$file"; fi ;; less) if [ -n "$line" ]; then "$editor" "+${line}g" "$file"; else "$editor" "$file"; fi ;; *) "$editor" "$file" ;; esac; else printf "%s\\n" "No terminal editor found for $target"; fi',
  ].join("; ");

  return [
    `target=${quoteShellArg(args.path)}`,
    `line=${quoteShellArg(line)}`,
    `column=${quoteShellArg(column)}`,
    'if [ -d "$target" ]; then cd "$target" || exit; exec "${SHELL:-/bin/sh}"; fi',
    'if [ -f "$target" ]; then dir=$(dirname "$target") || exit; file=$(basename "$target") || exit; cd "$dir" || exit',
    editorScript,
    'exec "${SHELL:-/bin/sh}"',
    "fi",
    'printf "%s\\n" "Path is not a file or directory: $target"',
    'exec "${SHELL:-/bin/sh}"',
  ].join("; ");
}

function buildLocalTerminalShellArgs(args: BuildMacTerminalOpenArgs): string[] {
  return ["/bin/sh", "-lc", buildTerminalShellScript(args)];
}

function buildRemoteTerminalSshArgs(args: BuildMacRemoteSshOpenArgs): string[] {
  return ["ssh", "-t", "--", args.sshAuthority, buildTerminalShellScript(args)];
}

function buildShellCommand(args: string[]): string {
  return args.map(quoteShellArg).join(" ");
}

function buildMacTerminalLocalOpenArgs(
  args: BuildMacTerminalOpenArgs & { appName: "Terminal" | "iTerm" },
): string[] {
  const command = escapeAppleScriptString(
    buildShellCommand(buildLocalTerminalShellArgs(args)),
  );

  if (args.appName === "Terminal") {
    return [
      "-e",
      `tell application "Terminal" to do script "${command}"`,
      "-e",
      'tell application "Terminal" to activate',
    ];
  }

  return [
    "-e",
    'tell application "iTerm" to create window with default profile',
    "-e",
    `tell application "iTerm" to tell current session of current window to write text "${command}"`,
    "-e",
    'tell application "iTerm" to activate',
  ];
}

function buildMacTerminalRemoteSshOpenArgs(
  args: BuildMacRemoteSshOpenArgs & { appName: "Terminal" | "iTerm" },
): string[] {
  const command = escapeAppleScriptString(
    buildShellCommand(buildRemoteTerminalSshArgs(args)),
  );

  if (args.appName === "Terminal") {
    return [
      "-e",
      `tell application "Terminal" to do script "${command}"`,
      "-e",
      'tell application "Terminal" to activate',
    ];
  }

  return [
    "-e",
    'tell application "iTerm" to create window with default profile',
    "-e",
    `tell application "iTerm" to tell current session of current window to write text "${command}"`,
    "-e",
    'tell application "iTerm" to activate',
  ];
}

function buildMacGhosttyLocalOpenArgs(
  args: BuildMacTerminalOpenArgs,
): string[] {
  return [
    "-na",
    "Ghostty",
    "--args",
    "-e",
    ...buildLocalTerminalShellArgs(args),
  ];
}

function buildMacGhosttyRemoteSshOpenArgs(
  args: BuildMacRemoteSshOpenArgs,
): string[] {
  return [
    "-na",
    "Ghostty",
    "--args",
    "-e",
    ...buildRemoteTerminalSshArgs(args),
  ];
}

const FULL_FILE_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: true,
  openFileAtLine: true,
};

const BASIC_FILE_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: false,
  openFileAtLine: false,
};

const FILE_MANAGER_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: false,
  openFileAtLine: false,
};

const TERMINAL_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: true,
  openFileAtLine: true,
};

const LINE_ONLY_FILE_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: false,
  openFileAtLine: true,
};

const LAUNCH_ADAPTERS: LaunchAdapter[] = [
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "vscode" },
    id: "vscode",
    kind: "editor",
    label: "VS Code",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Visual Studio Code",
      bundleIds: ["com.microsoft.VSCode"],
      builtIn: false,
      lineOpenCommand: {
        executable: "code",
        supportsColumn: true,
        toArgs: (args) => ["-g", formatPathWithLineNumber(args)],
      },
      pathOpenCommand: {
        executable: "code",
        toArgs: (path) => [path],
      },
      remoteSshOpenCommand: {
        capabilities: FULL_FILE_OPEN_CAPABILITIES,
        executable: "code",
        toArgs: (args) => [
          "--remote",
          `ssh-remote+${args.sshAuthority}`,
          ...(args.lineNumber === null
            ? [args.path]
            : [
                "-g",
                formatPathWithLineNumber({
                  lineNumber: args.lineNumber,
                  columnNumber: args.columnNumber,
                  path: args.path,
                }),
              ]),
        ],
      },
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "vscode" },
    id: "vscode-insiders",
    kind: "editor",
    label: "VS Code Insiders",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Visual Studio Code - Insiders",
      bundleIds: ["com.microsoft.VSCodeInsiders"],
      builtIn: false,
      lineOpenCommand: {
        executable: "code-insiders",
        supportsColumn: true,
        toArgs: (args) => ["-g", formatPathWithLineNumber(args)],
      },
      pathOpenCommand: {
        executable: "code-insiders",
        toArgs: (path) => [path],
      },
      remoteSshOpenCommand: {
        capabilities: FULL_FILE_OPEN_CAPABILITIES,
        executable: "code-insiders",
        toArgs: (args) => [
          "--remote",
          `ssh-remote+${args.sshAuthority}`,
          ...(args.lineNumber === null
            ? [args.path]
            : [
                "-g",
                formatPathWithLineNumber({
                  lineNumber: args.lineNumber,
                  columnNumber: args.columnNumber,
                  path: args.path,
                }),
              ]),
        ],
      },
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "cursor" },
    id: "cursor",
    kind: "editor",
    label: "Cursor",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Cursor",
      // ToDesktop bundle IDs are generated; keep app-name path fallback below.
      bundleIds: ["com.todesktop.230313mzl4w4u92"],
      builtIn: false,
      lineOpenCommand: {
        executable: "cursor",
        supportsColumn: true,
        toArgs: (args) => ["-g", formatPathWithLineNumber(args)],
      },
      pathOpenCommand: {
        executable: "cursor",
        toArgs: (path) => [path],
      },
      remoteSshOpenCommand: {
        capabilities: FULL_FILE_OPEN_CAPABILITIES,
        executable: "cursor",
        toArgs: (args) => [
          "--remote",
          `ssh-remote+${args.sshAuthority}`,
          ...(args.lineNumber === null
            ? [args.path]
            : [
                "-g",
                formatPathWithLineNumber({
                  lineNumber: args.lineNumber,
                  columnNumber: args.columnNumber,
                  path: args.path,
                }),
              ]),
        ],
      },
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "sublime-text" },
    id: "sublime-text",
    kind: "editor",
    label: "Sublime Text",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Sublime Text",
      bundleIds: ["com.sublimetext.4", "com.sublimetext.3"],
      builtIn: false,
      lineOpenCommand: {
        executable: "subl",
        supportsColumn: true,
        toArgs: (args) => [formatPathWithLineNumber(args)],
      },
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "zed" },
    id: "zed",
    kind: "editor",
    label: "Zed",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Zed",
      bundleIds: ["dev.zed.Zed"],
      builtIn: false,
      lineOpenCommand: {
        executable: "zed",
        supportsColumn: true,
        toArgs: (args) => [formatPathWithLineNumber(args)],
      },
      pathOpenCommand: {
        executable: "zed",
        toArgs: (path) => [path],
      },
      remoteSshOpenCommand: {
        capabilities: FULL_FILE_OPEN_CAPABILITIES,
        executable: "zed",
        toArgs: (args) => [formatZedRemoteSshUri(args)],
      },
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "windsurf" },
    id: "windsurf",
    kind: "editor",
    label: "Windsurf",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Windsurf",
      bundleIds: ["com.exafunction.windsurf"],
      builtIn: false,
      lineOpenCommand: {
        executable: "windsurf",
        supportsColumn: true,
        toArgs: (args) => ["-g", formatPathWithLineNumber(args)],
      },
      pathOpenCommand: {
        executable: "windsurf",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "bbedit",
    kind: "editor",
    label: "BBEdit",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "BBEdit",
      bundleIds: ["com.barebones.bbedit"],
      builtIn: false,
      lineOpenCommand: {
        executable: "bbedit",
        supportsColumn: false,
        toArgs: (args) => [`+${args.lineNumber}`, args.path],
      },
      pathOpenCommand: {
        executable: "bbedit",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "textmate",
    kind: "editor",
    label: "TextMate",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "TextMate",
      bundleIds: ["com.macromates.TextMate"],
      builtIn: false,
      lineOpenCommand: {
        executable: "mate",
        supportsColumn: false,
        toArgs: (args) => ["--line", String(args.lineNumber), args.path],
      },
      pathOpenCommand: {
        executable: "mate",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "emacs",
    kind: "editor",
    label: "Emacs",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Emacs",
      bundleIds: ["org.gnu.Emacs"],
      builtIn: false,
      lineOpenCommand: {
        executable: "emacsclient",
        supportsColumn: true,
        toArgs: (args) => [
          args.columnNumber === null
            ? `+${args.lineNumber}`
            : `+${args.lineNumber}:${args.columnNumber}`,
          args.path,
        ],
      },
      pathOpenCommand: {
        executable: "emacsclient",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "intellij-idea",
    kind: "editor",
    label: "IntelliJ IDEA",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "IntelliJ IDEA",
      bundleIds: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
      builtIn: false,
      lineOpenCommand: {
        executable: "idea",
        supportsColumn: false,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        executable: "idea",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "pycharm",
    kind: "editor",
    label: "PyCharm",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "PyCharm",
      bundleIds: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
      builtIn: false,
      lineOpenCommand: {
        executable: "pycharm",
        supportsColumn: false,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        executable: "pycharm",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "webstorm",
    kind: "editor",
    label: "WebStorm",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "WebStorm",
      bundleIds: ["com.jetbrains.WebStorm"],
      builtIn: false,
      lineOpenCommand: {
        executable: "webstorm",
        supportsColumn: false,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        executable: "webstorm",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "goland",
    kind: "editor",
    label: "GoLand",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "GoLand",
      bundleIds: ["com.jetbrains.goland"],
      builtIn: false,
      lineOpenCommand: {
        executable: "goland",
        supportsColumn: false,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        executable: "goland",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "rider",
    kind: "editor",
    label: "Rider",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Rider",
      bundleIds: ["com.jetbrains.rider"],
      builtIn: false,
      lineOpenCommand: {
        executable: "rider",
        supportsColumn: false,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        executable: "rider",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "rustrover",
    kind: "editor",
    label: "RustRover",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "RustRover",
      bundleIds: ["com.jetbrains.rustrover"],
      builtIn: false,
      lineOpenCommand: {
        executable: "rustrover",
        supportsColumn: false,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        executable: "rustrover",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "phpstorm",
    kind: "editor",
    label: "PhpStorm",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "PhpStorm",
      bundleIds: ["com.jetbrains.PhpStorm"],
      builtIn: false,
      lineOpenCommand: {
        executable: "phpstorm",
        supportsColumn: false,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        executable: "phpstorm",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "app" },
    id: "android-studio",
    kind: "editor",
    label: "Android Studio",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Android Studio",
      bundleIds: ["com.google.android.studio"],
      builtIn: false,
      lineOpenCommand: {
        executable: "studio",
        supportsColumn: false,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        executable: "studio",
        toArgs: (path) => [path],
      },
    },
  },
  {
    capabilities: BASIC_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "antigravity" },
    id: "antigravity",
    kind: "editor",
    label: "Antigravity",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Antigravity",
      bundleIds: ["com.google.antigravity", "com.googlelabs.antigravity"],
      builtIn: false,
    },
  },
  {
    capabilities: LINE_ONLY_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "xcode" },
    id: "xcode",
    kind: "editor",
    label: "Xcode",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Xcode",
      bundleIds: ["com.apple.dt.Xcode"],
      builtIn: false,
      lineOpenCommand: {
        executable: "xed",
        supportsColumn: false,
        toArgs: (args) => ["-l", String(args.lineNumber), args.path],
      },
    },
  },
  {
    capabilities: FILE_MANAGER_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "finder" },
    id: "finder",
    kind: "file-manager",
    label: "Finder",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Finder",
      bundleIds: ["com.apple.finder"],
      builtIn: true,
      fileOpenCommand: {
        executable: "open",
        toArgs: (path) => ["-R", path],
      },
    },
  },
  {
    capabilities: TERMINAL_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "terminal" },
    id: "terminal",
    kind: "terminal",
    label: "Terminal",
    fileOpenBehavior: "containing-directory",
    macos: {
      openMode: "application",
      appName: "Terminal",
      bundleIds: ["com.apple.Terminal"],
      builtIn: true,
      localTerminalOpenCommand: {
        executable: "osascript",
        toArgs: (args) =>
          buildMacTerminalLocalOpenArgs({
            appName: "Terminal",
            columnNumber: args.columnNumber,
            lineNumber: args.lineNumber,
            path: args.path,
          }),
      },
      remoteSshOpenCommand: {
        capabilities: TERMINAL_OPEN_CAPABILITIES,
        executable: "osascript",
        requiredExecutables: ["ssh"],
        toArgs: (args) =>
          buildMacTerminalRemoteSshOpenArgs({
            appName: "Terminal",
            columnNumber: args.columnNumber,
            lineNumber: args.lineNumber,
            path: args.path,
            sshAuthority: args.sshAuthority,
          }),
      },
    },
  },
  {
    capabilities: TERMINAL_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "iterm2" },
    id: "iterm2",
    kind: "terminal",
    label: "iTerm2",
    fileOpenBehavior: "containing-directory",
    macos: {
      openMode: "application",
      appName: "iTerm",
      bundleIds: ["com.googlecode.iterm2"],
      builtIn: false,
      localTerminalOpenCommand: {
        executable: "osascript",
        toArgs: (args) =>
          buildMacTerminalLocalOpenArgs({
            appName: "iTerm",
            columnNumber: args.columnNumber,
            lineNumber: args.lineNumber,
            path: args.path,
          }),
      },
      remoteSshOpenCommand: {
        capabilities: TERMINAL_OPEN_CAPABILITIES,
        executable: "osascript",
        requiredExecutables: ["ssh"],
        toArgs: (args) =>
          buildMacTerminalRemoteSshOpenArgs({
            appName: "iTerm",
            columnNumber: args.columnNumber,
            lineNumber: args.lineNumber,
            path: args.path,
            sshAuthority: args.sshAuthority,
          }),
      },
    },
  },
  {
    capabilities: TERMINAL_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "ghostty" },
    id: "ghostty",
    kind: "terminal",
    label: "Ghostty",
    fileOpenBehavior: "containing-directory",
    macos: {
      openMode: "application",
      appName: "Ghostty",
      bundleIds: ["com.mitchellh.ghostty"],
      builtIn: false,
      localTerminalOpenCommand: {
        executable: "open",
        toArgs: (args) =>
          buildMacGhosttyLocalOpenArgs({
            columnNumber: args.columnNumber,
            lineNumber: args.lineNumber,
            path: args.path,
          }),
      },
      remoteSshOpenCommand: {
        capabilities: TERMINAL_OPEN_CAPABILITIES,
        executable: "open",
        requiredExecutables: ["ssh"],
        toArgs: (args) =>
          buildMacGhosttyRemoteSshOpenArgs({
            columnNumber: args.columnNumber,
            lineNumber: args.lineNumber,
            path: args.path,
            sshAuthority: args.sshAuthority,
          }),
      },
    },
  },
  {
    capabilities: BASIC_FILE_OPEN_CAPABILITIES,
    icon: { kind: "symbol", name: "default-app" },
    id: "default-app",
    kind: "default-app",
    label: "Default App",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "default-app",
    },
  },
];

async function toWorkspaceOpenTarget(
  definition: LaunchAdapter,
  runtime: WorkspaceOpenTargetRuntime,
  appPath: string | null,
): Promise<WorkspaceOpenTarget> {
  const target: WorkspaceOpenTarget = {
    id: definition.id,
    label: definition.label,
    kind: definition.kind,
    icon: await resolveMacTargetIcon({
      appPath,
      definition,
      runtime,
    }),
    capabilities: definition.capabilities,
  };
  if (
    definition.macos.openMode !== "default-app" &&
    definition.macos.remoteSshOpenCommand !== undefined &&
    (await findUnavailableMacRemoteSshExecutable(
      definition.macos.remoteSshOpenCommand,
      runtime,
    )) === null
  ) {
    target.remoteSshCapabilities =
      definition.macos.remoteSshOpenCommand.capabilities;
  }
  return target;
}

function toCliWorkspaceOpenTarget(
  definition: LaunchAdapter,
): WorkspaceOpenTarget {
  return {
    id: definition.id,
    label: definition.label,
    kind: definition.kind,
    icon: definition.icon,
    capabilities: definition.capabilities,
    ...(definition.macos.openMode !== "default-app" &&
    definition.macos.remoteSshOpenCommand !== undefined
      ? {
          remoteSshCapabilities:
            definition.macos.remoteSshOpenCommand.capabilities,
        }
      : {}),
  };
}

async function toGenericMacApplicationOpenTarget(
  application: DiscoveredMacApplication & { bundleId: string },
  runtime: WorkspaceOpenTargetRuntime,
): Promise<WorkspaceOpenTarget> {
  const iconDataUrl = await resolveMacApplicationIconDataUrl(
    application.appPath,
    runtime,
  );
  return {
    id: encodeMacApplicationTargetId(application.bundleId),
    label: application.label,
    kind: "native-app",
    icon:
      iconDataUrl === null
        ? { kind: "symbol", name: "app" }
        : { kind: "data-url", dataUrl: iconDataUrl },
    capabilities: BASIC_FILE_OPEN_CAPABILITIES,
  };
}

function encodeMacApplicationTargetId(bundleId: string): WorkspaceOpenTargetId {
  return `${MAC_APP_TARGET_ID_PREFIX}${bundleId}`;
}

function parseMacApplicationTargetId(
  targetId: WorkspaceOpenTargetId,
): string | null {
  return targetId.startsWith(MAC_APP_TARGET_ID_PREFIX)
    ? targetId.slice(MAC_APP_TARGET_ID_PREFIX.length)
    : null;
}

function encodeDesktopApplicationTargetId(
  desktopFileId: string,
): WorkspaceOpenTargetId {
  return `${DESKTOP_APP_TARGET_ID_PREFIX}${desktopFileId}`;
}

function parseDesktopApplicationTargetId(
  targetId: WorkspaceOpenTargetId,
): string | null {
  return targetId.startsWith(DESKTOP_APP_TARGET_ID_PREFIX)
    ? targetId.slice(DESKTOP_APP_TARGET_ID_PREFIX.length)
    : null;
}

function findLaunchAdapterByBundleId(bundleId: string): LaunchAdapter | null {
  return (
    LAUNCH_ADAPTERS.find(
      (adapter) =>
        adapter.macos.openMode === "application" &&
        adapter.macos.bundleIds.includes(bundleId),
    ) ?? null
  );
}

function findLaunchAdapterForMacApplication(
  application: DiscoveredMacApplication,
): LaunchAdapter | null {
  if (application.bundleId !== null) {
    const bundleIdAdapter = findLaunchAdapterByBundleId(application.bundleId);
    if (bundleIdAdapter !== null) {
      return bundleIdAdapter;
    }
  }

  return (
    LAUNCH_ADAPTERS.find(
      (adapter) =>
        adapter.macos.openMode === "application" &&
        adapter.macos.appName === application.label,
    ) ?? null
  );
}

function getCliOpenExecutable(adapter: LaunchAdapter): string | null {
  if (adapter.macos.openMode === "default-app") {
    return null;
  }
  return (
    adapter.macos.pathOpenCommand?.executable ??
    adapter.macos.lineOpenCommand?.executable ??
    null
  );
}

async function isCliTargetAvailable(
  adapter: LaunchAdapter,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<boolean> {
  if (adapter.macos.openMode === "default-app") {
    return false;
  }
  const executable = getCliOpenExecutable(adapter);
  return executable === null
    ? false
    : isExecutableAvailable(executable, runtime);
}

async function listCliWorkspaceOpenTargets(
  runtime: WorkspaceOpenTargetRuntime,
): Promise<WorkspaceOpenTarget[]> {
  const targets = await Promise.all(
    LAUNCH_ADAPTERS.map(async (adapter) => {
      if (!(await isCliTargetAvailable(adapter, runtime))) {
        return null;
      }
      return toCliWorkspaceOpenTarget(adapter);
    }),
  );
  return targets.filter(isWorkspaceOpenTarget);
}

async function getDefaultOpenExecutable(
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string | null> {
  if (runtime.platform === "linux") {
    if (
      isWslRuntime(runtime) &&
      (await isExecutableAvailable("wslview", runtime))
    ) {
      return "wslview";
    }
    return (await isExecutableAvailable("xdg-open", runtime))
      ? "xdg-open"
      : null;
  }

  return null;
}

async function getFileManagerExecutable(
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string | null> {
  if (runtime.platform === "linux") {
    if (
      isWslRuntime(runtime) &&
      (await isExecutableAvailable("explorer.exe", runtime))
    ) {
      return "explorer.exe";
    }
    return (await isExecutableAvailable("xdg-open", runtime))
      ? "xdg-open"
      : null;
  }

  return null;
}

async function getTerminalExecutable(
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string | null> {
  const candidates =
    runtime.platform === "linux"
      ? ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]
      : [];

  for (const candidate of candidates) {
    if (await isExecutableAvailable(candidate, runtime)) {
      return candidate;
    }
  }

  return null;
}

async function listPlatformWorkspaceOpenTargets(
  runtime: WorkspaceOpenTargetRuntime,
): Promise<WorkspaceOpenTarget[]> {
  const targets: WorkspaceOpenTarget[] = [];
  if (await getDefaultOpenExecutable(runtime)) {
    targets.push({
      id: "default-app",
      label: "Default App",
      kind: "default-app",
      icon: { kind: "symbol", name: "default-app" },
      capabilities: BASIC_FILE_OPEN_CAPABILITIES,
    });
  }

  if (await getFileManagerExecutable(runtime)) {
    targets.push({
      id: "file-manager",
      label: "File Manager",
      kind: "file-manager",
      icon: { kind: "symbol", name: "file-manager" },
      capabilities: FILE_MANAGER_OPEN_CAPABILITIES,
    });
  }

  const terminalExecutable = await getTerminalExecutable(runtime);
  if (terminalExecutable !== null) {
    targets.push({
      id: "terminal",
      label: "Terminal",
      kind: "terminal",
      icon: { kind: "symbol", name: "terminal" },
      capabilities: TERMINAL_OPEN_CAPABILITIES,
    });
  }

  return targets;
}

function parseDesktopEntryValue(line: string): [string, string] | null {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }
  return [
    line.slice(0, separatorIndex).trim(),
    line.slice(separatorIndex + 1).trim(),
  ];
}

function parseLinuxDesktopApplication(
  desktopFilePath: string,
  content: string,
): LinuxDesktopApplication | null {
  let inDesktopEntry = false;
  const fields = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      inDesktopEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inDesktopEntry) {
      continue;
    }
    const parsed = parseDesktopEntryValue(line);
    if (parsed !== null) {
      fields.set(parsed[0], parsed[1]);
    }
  }

  if (
    fields.get("Type") !== "Application" ||
    fields.get("Hidden") === "true" ||
    fields.get("NoDisplay") === "true"
  ) {
    return null;
  }

  const label = fields.get("Name");
  const exec = fields.get("Exec");
  if (!label || !exec) {
    return null;
  }

  return {
    desktopFileId: path.basename(desktopFilePath, ".desktop"),
    desktopFilePath,
    exec,
    label,
  };
}

async function listLinuxDesktopApplications(
  runtime: WorkspaceOpenTargetRuntime,
): Promise<LinuxDesktopApplication[]> {
  const applications: LinuxDesktopApplication[] = [];
  const seenIds = new Set<string>();
  for (const directory of runtime.desktopFileDirectories ?? []) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".desktop")) {
        continue;
      }
      const desktopFilePath = path.join(directory, entry.name);
      const desktopFileId = path.basename(desktopFilePath, ".desktop");
      if (seenIds.has(desktopFileId)) {
        continue;
      }
      const content = await fs
        .readFile(desktopFilePath, "utf8")
        .catch(() => null);
      if (content === null) {
        continue;
      }
      const application = parseLinuxDesktopApplication(
        desktopFilePath,
        content,
      );
      if (application === null) {
        continue;
      }
      seenIds.add(desktopFileId);
      applications.push(application);
    }
  }
  return applications.sort((a, b) => a.label.localeCompare(b.label));
}

function toLinuxDesktopApplicationOpenTarget(
  application: LinuxDesktopApplication,
): WorkspaceOpenTarget {
  return {
    id: encodeDesktopApplicationTargetId(application.desktopFileId),
    label: application.label,
    kind: "native-app",
    icon: { kind: "symbol", name: "app" },
    capabilities: BASIC_FILE_OPEN_CAPABILITIES,
  };
}

async function defaultExecFile(
  file: string,
  args: string[],
): Promise<ExecFileResult> {
  const result = await execFileAsync(file, args, {
    env: sanitizeInheritedChildProcessEnv({ env: process.env }),
  });
  return {
    stdout: result.stdout,
  };
}

function createDefaultRuntime(): WorkspaceOpenTargetRuntime {
  const homeDirectory = os.homedir();
  return {
    applicationDirectories: [
      "/Applications",
      "/System/Applications",
      path.join(homeDirectory, "Applications"),
    ],
    desktopFileDirectories: [
      "/usr/share/applications",
      "/usr/local/share/applications",
      path.join(homeDirectory, ".local/share/applications"),
    ],
    env: process.env,
    execFile: defaultExecFile,
    platform: process.platform,
  };
}

function getMacApplicationCandidatePaths(
  definition: LaunchAdapter,
  runtime: WorkspaceOpenTargetRuntime,
): string[] {
  if (definition.macos.openMode === "default-app") {
    return [];
  }

  const appBundleName = `${definition.macos.appName}.app`;
  return runtime.applicationDirectories.map((directory) =>
    path.join(directory, appBundleName),
  );
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function isWslRuntime(runtime: WorkspaceOpenTargetRuntime): boolean {
  return (
    runtime.platform === "linux" &&
    (runtime.env?.WSL_DISTRO_NAME !== undefined ||
      runtime.env?.WSL_INTEROP !== undefined)
  );
}

async function readMacApplicationInfoPlistValue(
  appPath: string,
  key: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string | null> {
  try {
    const result = await runtime.execFile("plutil", [
      "-extract",
      key,
      "raw",
      "-o",
      "-",
      path.join(appPath, "Contents", "Info.plist"),
    ]);
    const value = result.stdout.trim();
    return value.length === 0 ? null : value;
  } catch {
    return null;
  }
}

async function resolveMacApplicationIconDataUrl(
  appPath: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string | null> {
  const iconFile = await readMacApplicationInfoPlistValue(
    appPath,
    "CFBundleIconFile",
    runtime,
  );
  if (iconFile === null) {
    return null;
  }

  const iconFileName =
    path.extname(iconFile) === "" ? `${iconFile}.icns` : iconFile;
  const iconPath = path.join(appPath, "Contents", "Resources", iconFileName);
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-open-target-icon-"),
  );
  const pngPath = path.join(tempDir, `${path.basename(iconPath)}.png`);
  try {
    await runtime.execFile("qlmanage", [
      "-t",
      "-s",
      String(MAC_APPLICATION_ICON_THUMBNAIL_SIZE_PX),
      "-o",
      tempDir,
      iconPath,
    ]);
    const iconBytes = await fs.readFile(pngPath);
    const dataUrl = `data:image/png;base64,${iconBytes.toString("base64")}`;
    return dataUrl.length > WORKSPACE_OPEN_TARGET_ICON_DATA_URL_MAX_LENGTH
      ? null
      : dataUrl;
  } catch {
    return null;
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true });
  }
}

async function resolveMacTargetIcon({
  appPath,
  definition,
  runtime,
}: ResolveMacTargetIconArgs): Promise<WorkspaceOpenTargetIcon> {
  if (
    appPath !== null &&
    definition.macos.openMode === "application" &&
    !definition.macos.builtIn
  ) {
    const iconDataUrl = await resolveMacApplicationIconDataUrl(
      appPath,
      runtime,
    );
    if (iconDataUrl !== null) {
      return { kind: "data-url", dataUrl: iconDataUrl };
    }
  }

  return definition.icon;
}

async function hasMacBundleId(
  bundleId: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<boolean> {
  return (
    (await findMacApplicationPathsByBundleId(bundleId, runtime)).length > 0
  );
}

async function findMacApplicationPathsByBundleId(
  bundleId: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string[]> {
  try {
    const result = await runtime.execFile("mdfind", [
      `kMDItemCFBundleIdentifier == ${toMdfindStringLiteral(bundleId)}`,
    ]);
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function toMdfindStringLiteral(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

async function hasMacApplicationPath(
  definition: LaunchAdapter,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<boolean> {
  return (await findMacApplicationPath(definition, runtime)) !== null;
}

async function findMacApplicationPath(
  definition: LaunchAdapter,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string | null> {
  if (definition.macos.openMode === "default-app") {
    return null;
  }

  for (const bundleId of definition.macos.bundleIds) {
    const paths = await findMacApplicationPathsByBundleId(bundleId, runtime);
    const appPath = paths.find((candidate) => candidate.endsWith(".app"));
    if (appPath) {
      return appPath;
    }
  }

  const candidatePaths = getMacApplicationCandidatePaths(definition, runtime);
  const results = await Promise.all(candidatePaths.map(pathExists));
  const index = results.findIndex(Boolean);
  return index === -1 ? null : candidatePaths[index];
}

async function findMacApplicationPathByBundleId(
  bundleId: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string | null> {
  const paths = await findMacApplicationPathsByBundleId(bundleId, runtime);
  return paths.find((candidate) => candidate.endsWith(".app")) ?? null;
}

async function readMacApplicationLabel(
  appPath: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string> {
  return (
    (await readMacApplicationInfoPlistValue(
      appPath,
      "CFBundleDisplayName",
      runtime,
    )) ??
    (await readMacApplicationInfoPlistValue(
      appPath,
      "CFBundleName",
      runtime,
    )) ??
    path.basename(appPath, ".app")
  );
}

async function listMacApplicationsForFilePath(
  filePath: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<DiscoveredMacApplication[]> {
  if (!(await pathExists(filePath))) {
    return [];
  }

  let parsedApplications: z.infer<typeof macApplicationsForFileResultSchema>;
  try {
    const result = await runtime.execFile("osascript", [
      "-l",
      "JavaScript",
      "-e",
      MAC_APPLICATIONS_FOR_FILE_SCRIPT,
      "--",
      filePath,
    ]);
    parsedApplications = macApplicationsForFileResultSchema.parse(
      JSON.parse(result.stdout.trim()),
    );
  } catch {
    return [];
  }

  const applications: DiscoveredMacApplication[] = [];
  const seenBundleIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const application of parsedApplications) {
    if (!application.appPath.endsWith(".app")) {
      continue;
    }
    if (
      application.bundleId !== null &&
      seenBundleIds.has(application.bundleId)
    ) {
      continue;
    }
    if (application.bundleId === null && seenPaths.has(application.appPath)) {
      continue;
    }

    if (application.bundleId === null) {
      seenPaths.add(application.appPath);
    } else {
      seenBundleIds.add(application.bundleId);
    }

    applications.push({
      appPath: application.appPath,
      bundleId: application.bundleId,
      label: await readMacApplicationLabel(application.appPath, runtime),
    });
    if (applications.length >= MAC_FILE_APPLICATION_DISCOVERY_LIMIT) {
      break;
    }
  }

  return applications;
}

async function isMacTargetAvailable(
  definition: LaunchAdapter,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<boolean> {
  if (definition.macos.openMode === "default-app") {
    return true;
  }

  if (definition.macos.builtIn) {
    return true;
  }

  for (const bundleId of definition.macos.bundleIds) {
    if (await hasMacBundleId(bundleId, runtime)) {
      return true;
    }
  }

  return hasMacApplicationPath(definition, runtime);
}

function isWorkspaceOpenTarget(
  target: WorkspaceOpenTarget | null,
): target is WorkspaceOpenTarget {
  return target !== null;
}

async function listKnownMacWorkspaceOpenTargets(
  runtime: WorkspaceOpenTargetRuntime,
): Promise<WorkspaceOpenTarget[]> {
  const targets: WorkspaceOpenTarget[] = [];
  for (const adapter of LAUNCH_ADAPTERS) {
    if (adapter.macos.openMode === "default-app" || adapter.macos.builtIn) {
      targets.push(await toWorkspaceOpenTarget(adapter, runtime, null));
      continue;
    }

    const appPath = await findMacApplicationPath(adapter, runtime);
    if (appPath !== null) {
      targets.push(await toWorkspaceOpenTarget(adapter, runtime, appPath));
    }
  }
  return targets;
}

export async function listWorkspaceOpenTargetsWithRuntime(
  runtime: WorkspaceOpenTargetRuntime,
  options: ListWorkspaceOpenTargetsOptions = {},
): Promise<WorkspaceOpenTarget[]> {
  if (runtime.platform !== "darwin") {
    if (runtime.platform !== "linux") {
      return [];
    }
    return [
      ...(await listCliWorkspaceOpenTargets(runtime)),
      ...(await listPlatformWorkspaceOpenTargets(runtime)),
      ...(await listLinuxDesktopApplications(runtime)).map(
        toLinuxDesktopApplicationOpenTarget,
      ),
    ];
  }

  const targets: WorkspaceOpenTarget[] = [];
  const seenTargetIds = new Set<WorkspaceOpenTargetId>();
  const pushTarget = (target: WorkspaceOpenTarget): void => {
    if (seenTargetIds.has(target.id)) {
      return;
    }
    seenTargetIds.add(target.id);
    targets.push(target);
  };

  for (const target of await listKnownMacWorkspaceOpenTargets(runtime)) {
    pushTarget(target);
  }

  const pathSpecificApplications =
    options.path === undefined
      ? []
      : await listMacApplicationsForFilePath(options.path, runtime);
  for (const application of pathSpecificApplications) {
    const adapter = findLaunchAdapterForMacApplication(application);
    if (adapter !== null) {
      pushTarget(
        await toWorkspaceOpenTarget(adapter, runtime, application.appPath),
      );
      continue;
    }
    if (application.bundleId !== null) {
      pushTarget(
        await toGenericMacApplicationOpenTarget(
          { ...application, bundleId: application.bundleId },
          runtime,
        ),
      );
    }
  }

  return targets;
}

function findLaunchAdapter(
  targetId: WorkspaceOpenTargetId,
): LaunchAdapter | null {
  return LAUNCH_ADAPTERS.find((candidate) => candidate.id === targetId) ?? null;
}

function requireLaunchAdapter(targetId: WorkspaceOpenTargetId): LaunchAdapter {
  const definition = findLaunchAdapter(targetId);
  if (!definition) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `Workspace open target is unavailable: ${targetId}`,
    });
  }
  return definition;
}

interface ExistingPath {
  path: string;
  type: "directory" | "file";
}

async function requireOpenablePath(targetPath: string): Promise<ExistingPath> {
  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat) {
    throw new WorkspaceOpenTargetError({
      code: "path_not_found",
      message: `Open target path does not exist: ${targetPath}`,
    });
  }

  if (stat.isDirectory()) {
    return {
      path: targetPath,
      type: "directory",
    };
  }

  if (stat.isFile()) {
    return {
      path: targetPath,
      type: "file",
    };
  }

  throw new WorkspaceOpenTargetError({
    code: "path_not_openable",
    message: `Open target path must be a file or directory: ${targetPath}`,
  });
}

function resolveTargetOpenPath(args: ResolveTargetOpenPathArgs): string {
  if (
    args.existingPath.type === "file" &&
    args.definition.fileOpenBehavior === "containing-directory"
  ) {
    return path.dirname(args.existingPath.path);
  }

  return args.existingPath.path;
}

async function isExecutableAvailable(
  executable: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<boolean> {
  try {
    await runtime.execFile("which", [executable]);
    return true;
  } catch {
    return false;
  }
}

function getMacRemoteSshOpenCommandExecutables(
  command: MacRemoteSshOpenCommandAdapter,
): string[] {
  return [command.executable, ...(command.requiredExecutables ?? [])];
}

async function findUnavailableMacRemoteSshExecutable(
  command: MacRemoteSshOpenCommandAdapter,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<string | null> {
  for (const executable of getMacRemoteSshOpenCommandExecutables(command)) {
    if (!(await isExecutableAvailable(executable, runtime))) {
      return executable;
    }
  }

  return null;
}

async function maybeResolveMacLineOpenInvocation(
  args: ResolveMacOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation | null> {
  if (args.lineNumber === null || args.existingPath.type !== "file") {
    return null;
  }

  if (args.definition.macos.openMode === "default-app") {
    return null;
  }

  const lineOpenCommand = args.definition.macos.lineOpenCommand;
  if (!lineOpenCommand) {
    return null;
  }

  if (!(await isExecutableAvailable(lineOpenCommand.executable, runtime))) {
    return null;
  }

  return {
    file: lineOpenCommand.executable,
    args: lineOpenCommand.toArgs({
      columnNumber: lineOpenCommand.supportsColumn ? args.columnNumber : null,
      lineNumber: args.lineNumber,
      path: args.existingPath.path,
    }),
  };
}

async function maybeResolveMacPathOpenInvocation(
  args: ResolveMacOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation | null> {
  if (args.definition.macos.openMode === "default-app") {
    return null;
  }

  const pathOpenCommand = args.definition.macos.pathOpenCommand;
  if (!pathOpenCommand) {
    return null;
  }

  if (!(await isExecutableAvailable(pathOpenCommand.executable, runtime))) {
    return null;
  }

  const openPath = resolveTargetOpenPath({
    definition: args.definition,
    existingPath: args.existingPath,
  });
  return {
    file: pathOpenCommand.executable,
    args: pathOpenCommand.toArgs(openPath),
  };
}

async function maybeResolveMacFileOpenInvocation(
  args: ResolveMacOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation | null> {
  if (
    args.definition.macos.openMode === "default-app" ||
    args.existingPath.type !== "file"
  ) {
    return null;
  }

  const fileOpenCommand = args.definition.macos.fileOpenCommand;
  if (!fileOpenCommand) {
    return null;
  }

  if (!(await isExecutableAvailable(fileOpenCommand.executable, runtime))) {
    return null;
  }

  return {
    file: fileOpenCommand.executable,
    args: fileOpenCommand.toArgs(args.existingPath.path),
  };
}

function maybeResolveMacLocalTerminalOpenInvocation(
  args: ResolveMacOpenInvocationArgs,
): ExecFileInvocation | null {
  if (args.definition.macos.openMode === "default-app") {
    return null;
  }

  const localTerminalOpenCommand =
    args.definition.macos.localTerminalOpenCommand;
  if (!localTerminalOpenCommand) {
    return null;
  }

  return {
    file: localTerminalOpenCommand.executable,
    args: localTerminalOpenCommand.toArgs({
      columnNumber: args.definition.capabilities.openFileAtColumn
        ? args.columnNumber
        : null,
      lineNumber: args.lineNumber,
      path: args.existingPath.path,
    }),
  };
}

async function resolveMacOpenInvocation(
  args: ResolveMacOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const lineOpenInvocation = await maybeResolveMacLineOpenInvocation(
    args,
    runtime,
  );
  if (lineOpenInvocation) {
    return lineOpenInvocation;
  }

  const fileOpenInvocation = await maybeResolveMacFileOpenInvocation(
    args,
    runtime,
  );
  if (fileOpenInvocation) {
    return fileOpenInvocation;
  }

  const pathOpenInvocation = await maybeResolveMacPathOpenInvocation(
    args,
    runtime,
  );
  if (pathOpenInvocation) {
    return pathOpenInvocation;
  }

  const localTerminalOpenInvocation =
    maybeResolveMacLocalTerminalOpenInvocation(args);
  if (localTerminalOpenInvocation) {
    return localTerminalOpenInvocation;
  }

  const openPath = resolveTargetOpenPath({
    definition: args.definition,
    existingPath: args.existingPath,
  });
  if (args.definition.macos.openMode === "default-app") {
    return {
      file: "open",
      args: ["--", openPath],
    };
  }

  return {
    file: "open",
    args: ["-a", args.definition.macos.appName, "--", openPath],
  };
}

async function resolveMacRemoteSshOpenInvocation(
  args: ResolveMacRemoteSshOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  if (args.definition.macos.openMode === "default-app") {
    throw new WorkspaceOpenTargetError({
      code: "remote_target_unsupported",
      message: `${args.definition.label} cannot open remote SSH paths`,
    });
  }

  const remoteSshOpenCommand = args.definition.macos.remoteSshOpenCommand;
  if (remoteSshOpenCommand === undefined) {
    throw new WorkspaceOpenTargetError({
      code: "remote_target_unsupported",
      message: `${args.definition.label} cannot open remote SSH paths`,
    });
  }

  const unavailableExecutable = await findUnavailableMacRemoteSshExecutable(
    remoteSshOpenCommand,
    runtime,
  );
  if (unavailableExecutable !== null) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `${args.definition.label} remote SSH opener is unavailable: ${unavailableExecutable}`,
    });
  }

  return {
    file: remoteSshOpenCommand.executable,
    args: remoteSshOpenCommand.toArgs({
      columnNumber: remoteSshOpenCommand.capabilities.openFileAtColumn
        ? args.columnNumber
        : null,
      lineNumber: remoteSshOpenCommand.capabilities.openFileAtLine
        ? args.lineNumber
        : null,
      path: args.path,
      sshAuthority: args.sshAuthority,
    }),
  };
}

async function resolveGenericMacApplicationOpenInvocation(
  args: {
    bundleId: string;
    existingPath: ExistingPath;
  },
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const appPath = await findMacApplicationPathByBundleId(
    args.bundleId,
    runtime,
  );
  if (appPath === null) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `Workspace open target is unavailable: ${args.bundleId}`,
    });
  }

  return {
    file: "open",
    args: ["-b", args.bundleId, "--", args.existingPath.path],
  };
}

async function resolveCliOpenInvocation(
  args: PlatformOpenInvocationArgs & {
    definition: LaunchAdapter;
  },
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const lineOpenInvocation = await maybeResolveMacLineOpenInvocation(
    args,
    runtime,
  );
  if (lineOpenInvocation) {
    return lineOpenInvocation;
  }

  const pathOpenInvocation = await maybeResolveMacPathOpenInvocation(
    args,
    runtime,
  );
  if (pathOpenInvocation) {
    return pathOpenInvocation;
  }

  throw new WorkspaceOpenTargetError({
    code: "target_unavailable",
    message: `Workspace open target is unavailable: ${args.definition.label}`,
  });
}

async function resolvePlatformDefaultOpenInvocation(
  args: PlatformOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const executable = await getDefaultOpenExecutable(runtime);
  if (executable === null) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: "Default app opener is unavailable",
    });
  }

  return {
    file: executable,
    args: [args.existingPath.path],
  };
}

async function resolvePlatformFileManagerOpenInvocation(
  args: PlatformOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const executable = await getFileManagerExecutable(runtime);
  if (executable === null) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: "File manager opener is unavailable",
    });
  }

  const openPath =
    args.existingPath.type === "file"
      ? path.dirname(args.existingPath.path)
      : args.existingPath.path;
  return {
    file: executable,
    args: [openPath],
  };
}

function buildLinuxTerminalOpenInvocation(
  executable: string,
  args: BuildMacTerminalOpenArgs,
): ExecFileInvocation {
  const shellArgs = buildLocalTerminalShellArgs(args);
  if (executable === "gnome-terminal") {
    return { file: executable, args: ["--", ...shellArgs] };
  }
  return { file: executable, args: ["-e", ...shellArgs] };
}

function buildLinuxTerminalRemoteSshInvocation(
  executable: string,
  args: BuildMacRemoteSshOpenArgs,
): ExecFileInvocation {
  const shellArgs = buildRemoteTerminalSshArgs(args);
  if (executable === "gnome-terminal") {
    return { file: executable, args: ["--", ...shellArgs] };
  }
  return { file: executable, args: ["-e", ...shellArgs] };
}

async function resolvePlatformTerminalOpenInvocation(
  args: PlatformOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const executable = await getTerminalExecutable(runtime);
  if (executable === null) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: "Terminal opener is unavailable",
    });
  }

  return buildLinuxTerminalOpenInvocation(executable, {
    columnNumber: args.columnNumber,
    lineNumber: args.lineNumber,
    path: args.existingPath.path,
  });
}

async function resolvePlatformTerminalRemoteSshOpenInvocation(
  args: PlatformRemoteSshOpenInvocationArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const executable = await getTerminalExecutable(runtime);
  if (executable === null || !(await isExecutableAvailable("ssh", runtime))) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: "Terminal remote SSH opener is unavailable",
    });
  }

  if (runtime.platform !== "linux") {
    throw new WorkspaceOpenTargetError({
      code: "remote_target_unsupported",
      message: "Terminal remote SSH opener is unsupported on this platform",
    });
  }

  return buildLinuxTerminalRemoteSshInvocation(executable, args);
}

function splitDesktopExec(exec: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;
  for (const char of exec) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaping) {
    current += "\\";
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function expandDesktopExecToken(
  token: string,
  args: {
    application: LinuxDesktopApplication;
    path: string;
  },
): { token: string; usedPath: boolean } | null {
  let usedPath = false;
  const expanded = token.replaceAll(/%[a-zA-Z%]/gu, (fieldCode) => {
    switch (fieldCode) {
      case "%%":
        return "%";
      case "%f":
      case "%F":
      case "%u":
      case "%U":
        usedPath = true;
        return args.path;
      case "%c":
        return args.application.label;
      case "%k":
        return args.application.desktopFilePath;
      case "%i":
        return "";
      default:
        return "";
    }
  });
  return expanded.length === 0 ? null : { token: expanded, usedPath };
}

function buildLinuxDesktopApplicationInvocation(
  application: LinuxDesktopApplication,
  targetPath: string,
): ExecFileInvocation {
  const rawTokens = splitDesktopExec(application.exec);
  const tokens: string[] = [];
  let usedPath = false;
  for (const rawToken of rawTokens) {
    const expanded = expandDesktopExecToken(rawToken, {
      application,
      path: targetPath,
    });
    if (expanded === null) {
      continue;
    }
    tokens.push(expanded.token);
    usedPath ||= expanded.usedPath;
  }
  if (tokens.length === 0) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `Desktop app opener is unavailable: ${application.label}`,
    });
  }
  if (!usedPath) {
    tokens.push(targetPath);
  }
  return {
    file: tokens[0] ?? application.exec,
    args: tokens.slice(1),
  };
}

async function findLinuxDesktopApplication(
  desktopFileId: string,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<LinuxDesktopApplication | null> {
  return (
    (await listLinuxDesktopApplications(runtime)).find(
      (application) => application.desktopFileId === desktopFileId,
    ) ?? null
  );
}

async function resolveLinuxDesktopApplicationOpenInvocation(
  args: {
    desktopFileId: string;
    existingPath: ExistingPath;
  },
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const application = await findLinuxDesktopApplication(
    args.desktopFileId,
    runtime,
  );
  if (application === null) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `Workspace open target is unavailable: ${args.desktopFileId}`,
    });
  }
  return buildLinuxDesktopApplicationInvocation(
    application,
    args.existingPath.path,
  );
}

async function resolvePlatformOpenInvocation(
  args: OpenPathInTargetArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  if (runtime.platform !== "linux") {
    throw new WorkspaceOpenTargetError({
      code: "unsupported_platform",
      message: "Workspace open targets are not supported on this platform",
    });
  }

  const desktopFileId = parseDesktopApplicationTargetId(args.targetId);
  if (args.context.kind === "remote-ssh") {
    if (desktopFileId !== null) {
      throw new WorkspaceOpenTargetError({
        code: "remote_target_unsupported",
        message: `${args.targetId} cannot open remote SSH paths`,
      });
    }
    if (args.targetId === "terminal") {
      return resolvePlatformTerminalRemoteSshOpenInvocation(
        {
          columnNumber: args.columnNumber,
          lineNumber: args.lineNumber,
          path: args.path,
          sshAuthority: args.context.sshAuthority,
        },
        runtime,
      );
    }

    const definition = findLaunchAdapter(args.targetId);
    if (
      definition !== null &&
      definition.macos.openMode !== "default-app" &&
      definition.macos.remoteSshOpenCommand !== undefined
    ) {
      return resolveMacRemoteSshOpenInvocation(
        {
          definition,
          columnNumber: args.columnNumber,
          lineNumber: args.lineNumber,
          path: args.path,
          sshAuthority: args.context.sshAuthority,
        },
        runtime,
      );
    }

    throw new WorkspaceOpenTargetError({
      code: "remote_target_unsupported",
      message: `${args.targetId} cannot open remote SSH paths`,
    });
  }

  const existingPath = await requireOpenablePath(args.path);
  if (desktopFileId !== null) {
    return resolveLinuxDesktopApplicationOpenInvocation(
      { desktopFileId, existingPath },
      runtime,
    );
  }

  const platformArgs: PlatformOpenInvocationArgs = {
    columnNumber: args.columnNumber,
    existingPath,
    lineNumber: args.lineNumber,
  };
  const definition = findLaunchAdapter(args.targetId);
  if (
    definition !== null &&
    (await isCliTargetAvailable(definition, runtime))
  ) {
    return resolveCliOpenInvocation(
      {
        ...platformArgs,
        definition,
      },
      runtime,
    );
  }

  if (args.targetId === "default-app") {
    return resolvePlatformDefaultOpenInvocation(platformArgs, runtime);
  }
  if (args.targetId === "file-manager") {
    return resolvePlatformFileManagerOpenInvocation(platformArgs, runtime);
  }
  if (args.targetId === "terminal") {
    return resolvePlatformTerminalOpenInvocation(platformArgs, runtime);
  }

  throw new WorkspaceOpenTargetError({
    code: "target_unavailable",
    message: `Workspace open target is unavailable: ${args.targetId}`,
  });
}

export async function openPathInTargetWithRuntime(
  args: OpenPathInTargetArgs,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<void> {
  if (runtime.platform !== "darwin") {
    const invocation = await resolvePlatformOpenInvocation(args, runtime);
    await runtime.execFile(invocation.file, invocation.args);
    return;
  }

  const genericMacBundleId = parseMacApplicationTargetId(args.targetId);
  if (genericMacBundleId !== null) {
    if (args.context.kind === "remote-ssh") {
      throw new WorkspaceOpenTargetError({
        code: "remote_target_unsupported",
        message: `${args.targetId} cannot open remote SSH paths`,
      });
    }
    const invocation = await resolveGenericMacApplicationOpenInvocation(
      {
        bundleId: genericMacBundleId,
        existingPath: await requireOpenablePath(args.path),
      },
      runtime,
    );
    await runtime.execFile(invocation.file, invocation.args);
    return;
  }

  const definition = requireLaunchAdapter(args.targetId);
  if (!(await isMacTargetAvailable(definition, runtime))) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `Workspace open target is unavailable: ${definition.label}`,
    });
  }

  if (args.context.kind === "remote-ssh") {
    const invocation = await resolveMacRemoteSshOpenInvocation(
      {
        definition,
        columnNumber: args.columnNumber,
        lineNumber: args.lineNumber,
        path: args.path,
        sshAuthority: args.context.sshAuthority,
      },
      runtime,
    );
    await runtime.execFile(invocation.file, invocation.args);
    return;
  }

  const existingPath = await requireOpenablePath(args.path);
  const invocation = await resolveMacOpenInvocation(
    {
      definition,
      columnNumber: args.columnNumber,
      existingPath,
      lineNumber: args.lineNumber,
    },
    runtime,
  );
  await runtime.execFile(invocation.file, invocation.args);
}

export async function listWorkspaceOpenTargets(
  options: ListWorkspaceOpenTargetsOptions = {},
): Promise<WorkspaceOpenTarget[]> {
  return listWorkspaceOpenTargetsWithRuntime(createDefaultRuntime(), options);
}

export async function openPathInTarget(
  args: OpenPathInTargetArgs,
): Promise<void> {
  await openPathInTargetWithRuntime(args, createDefaultRuntime());
}

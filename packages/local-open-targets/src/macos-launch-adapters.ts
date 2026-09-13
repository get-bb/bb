import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  BASIC_FILE_OPEN_CAPABILITIES,
  FILE_MANAGER_OPEN_CAPABILITIES,
  FULL_FILE_OPEN_CAPABILITIES,
  LINE_ONLY_FILE_OPEN_CAPABILITIES,
  TERMINAL_OPEN_CAPABILITIES,
} from "./capabilities.js";
import {
  buildMacGhosttyLocalOpenArgs,
  buildMacGhosttyRemoteSshOpenArgs,
  buildMacTerminalAppLocalOpenArgs,
  buildMacTerminalLocalOpenArgs,
  buildMacTerminalRemoteSshOpenArgs,
} from "./terminal.js";
import type {
  MacBundledExecutableAdapter,
  BuildMacLineOpenArgs,
  BuildMacRemoteSshOpenArgs,
  LaunchAdapter,
  MacCommandExecutableAdapter,
} from "./types.js";

const CURSOR_CLI_JS_RELATIVE_PATH = [
  "Contents",
  "Resources",
  "app",
  "out",
  "cli.js",
];

function formatPathWithLineNumber(args: BuildMacLineOpenArgs): string {
  return args.columnNumber === null
    ? `${args.path}:${args.lineNumber}`
    : `${args.path}:${args.lineNumber}:${args.columnNumber}`;
}

function formatJetBrainsLineOpenArgs(args: BuildMacLineOpenArgs): string[] {
  return [
    "--line",
    String(args.lineNumber),
    ...(args.columnNumber === null
      ? []
      : ["--column", String(args.columnNumber)]),
    args.path,
  ];
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

function formatTextMateOpenUri(args: BuildMacLineOpenArgs): string {
  const uri = new URL("txmt://open/");
  uri.searchParams.set("url", pathToFileURL(args.path).toString());
  uri.searchParams.set("line", String(args.lineNumber));
  if (args.columnNumber !== null) {
    uri.searchParams.set("column", String(args.columnNumber));
  }
  return uri.toString();
}

function buildCursorCliEnv(
  env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const cursorEnv: NodeJS.ProcessEnv = { ...(env ?? process.env) };
  cursorEnv.VSCODE_NODE_OPTIONS = cursorEnv.NODE_OPTIONS;
  cursorEnv.VSCODE_NODE_REPL_EXTERNAL_MODULE =
    cursorEnv.NODE_REPL_EXTERNAL_MODULE;
  delete cursorEnv.NODE_OPTIONS;
  delete cursorEnv.NODE_REPL_EXTERNAL_MODULE;
  cursorEnv.ELECTRON_RUN_AS_NODE = "1";
  return cursorEnv;
}

const CURSOR_BUNDLED_EXECUTABLE: MacBundledExecutableAdapter = {
  relativeExecutablePath: ["Contents", "MacOS", "Cursor"],
  requiredRelativePaths: [CURSOR_CLI_JS_RELATIVE_PATH],
  toArgsPrefix: (appPath) => [
    path.join(appPath, ...CURSOR_CLI_JS_RELATIVE_PATH),
  ],
  toEnv: buildCursorCliEnv,
};

function bundledExecutable(
  ...relativeExecutablePath: string[]
): MacBundledExecutableAdapter {
  return {
    relativeExecutablePath,
  };
}

function resourcesAppBinExecutable(
  executable: string,
): MacBundledExecutableAdapter {
  return bundledExecutable("Contents", "Resources", "app", "bin", executable);
}

const LEGACY_WINDSURF_EXECUTABLE: MacCommandExecutableAdapter = {
  bundledExecutable: resourcesAppBinExecutable("windsurf"),
  executable: "windsurf",
};

type MacApplicationLaunchAdapter = Extract<
  LaunchAdapter["macos"],
  { openMode: "application" }
>;

interface VsCodeFamilyCommandsArgs {
  bundledExecutable: MacBundledExecutableAdapter;
  executable: string;
  fallbackExecutables?: MacCommandExecutableAdapter[];
}

function formatVsCodeRemoteSshArgs(args: BuildMacRemoteSshOpenArgs): string[] {
  return [
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
  ];
}

function vsCodeFamilyCommands(
  args: VsCodeFamilyCommandsArgs,
): Pick<
  MacApplicationLaunchAdapter,
  "lineOpenCommand" | "pathOpenCommand" | "remoteSshOpenCommand"
> {
  const command = {
    bundledExecutable: args.bundledExecutable,
    executable: args.executable,
    ...(args.fallbackExecutables !== undefined
      ? { fallbackExecutables: args.fallbackExecutables }
      : {}),
  };
  return {
    lineOpenCommand: {
      ...command,
      supportsColumn: true,
      toArgs: (lineArgs) => ["-g", formatPathWithLineNumber(lineArgs)],
    },
    pathOpenCommand: {
      ...command,
      toArgs: (path) => [path],
    },
    remoteSshOpenCommand: {
      ...command,
      capabilities: FULL_FILE_OPEN_CAPABILITIES,
      toArgs: formatVsCodeRemoteSshArgs,
    },
  };
}

interface JetBrainsEditorAdapterArgs extends Pick<
  LaunchAdapter,
  "icon" | "id" | "label"
> {
  appName: string;
  bundleIds: string[];
  executable: string;
  toolboxPrefix: string;
}

function jetBrainsEditorAdapter(
  args: JetBrainsEditorAdapterArgs,
): LaunchAdapter {
  const command = {
    bundledExecutable: bundledExecutable("Contents", "MacOS", args.executable),
    executable: args.executable,
  };
  return {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: args.icon,
    id: args.id,
    kind: "editor",
    label: args.label,
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: args.appName,
      bundleIds: args.bundleIds,
      builtIn: false,
      jetBrainsToolbox: {
        bundlePrefixes: [args.toolboxPrefix],
        executable: args.executable,
      },
      lineOpenCommand: {
        ...command,
        supportsColumn: true,
        toArgs: formatJetBrainsLineOpenArgs,
      },
      pathOpenCommand: {
        ...command,
        toArgs: (path) => [path],
      },
    },
  };
}

function macTerminalAppCommands(
  appName: "Terminal" | "iTerm",
): Pick<
  MacApplicationLaunchAdapter,
  "localTerminalOpenCommand" | "remoteSshOpenCommand"
> {
  return {
    localTerminalOpenCommand: {
      executable: "osascript",
      toArgs: (args) =>
        buildMacTerminalLocalOpenArgs({
          appName,
          columnNumber: args.columnNumber,
          editorCommand: args.editorCommand,
          lineNumber: args.lineNumber,
          path: args.path,
          pathType: args.pathType,
          shellPath: args.shellPath,
        }),
    },
    remoteSshOpenCommand: {
      capabilities: TERMINAL_OPEN_CAPABILITIES,
      executable: "osascript",
      requiredExecutables: ["ssh"],
      toArgs: (args) =>
        buildMacTerminalRemoteSshOpenArgs({
          appName,
          columnNumber: args.columnNumber,
          lineNumber: args.lineNumber,
          path: args.path,
          sshAuthority: args.sshAuthority,
        }),
    },
  };
}

export const LAUNCH_ADAPTERS: LaunchAdapter[] = [
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
      additionalAppNames: ["Code"],
      bundleIds: ["com.microsoft.VSCode"],
      builtIn: false,
      ...vsCodeFamilyCommands({
        bundledExecutable: resourcesAppBinExecutable("code"),
        executable: "code",
      }),
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "vscode-insiders" },
    id: "vscode-insiders",
    kind: "editor",
    label: "VS Code Insiders",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Visual Studio Code - Insiders",
      additionalAppNames: ["Code - Insiders"],
      bundleIds: ["com.microsoft.VSCodeInsiders"],
      builtIn: false,
      ...vsCodeFamilyCommands({
        bundledExecutable: resourcesAppBinExecutable("code"),
        executable: "code-insiders",
      }),
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
      bundleIds: ["com.todesktop.230313mzl4w4u92"],
      builtIn: false,
      ...vsCodeFamilyCommands({
        bundledExecutable: CURSOR_BUNDLED_EXECUTABLE,
        executable: "cursor",
      }),
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
        bundledExecutable: bundledExecutable(
          "Contents",
          "SharedSupport",
          "bin",
          "subl",
        ),
        executable: "subl",
        supportsColumn: true,
        toArgs: (args) => [formatPathWithLineNumber(args)],
      },
      pathOpenCommand: {
        bundledExecutable: bundledExecutable(
          "Contents",
          "SharedSupport",
          "bin",
          "subl",
        ),
        executable: "subl",
        toArgs: (path) => [path],
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
      additionalAppNames: ["Zed Preview", "Zed Nightly"],
      bundleIds: ["dev.zed.Zed"],
      builtIn: false,
      lineOpenCommand: {
        bundledExecutable: bundledExecutable("Contents", "MacOS", "zed"),
        executable: "zed",
        supportsColumn: true,
        toArgs: (args) => [formatPathWithLineNumber(args)],
      },
      pathOpenCommand: {
        bundledExecutable: bundledExecutable("Contents", "MacOS", "zed"),
        executable: "zed",
        toArgs: (path) => [path],
      },
      remoteSshOpenCommand: {
        bundledExecutable: bundledExecutable("Contents", "MacOS", "zed"),
        capabilities: FULL_FILE_OPEN_CAPABILITIES,
        executable: "zed",
        toArgs: (args) => [formatZedRemoteSshUri(args)],
      },
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "devin-desktop" },
    id: "devin-desktop",
    kind: "editor",
    label: "Devin Desktop",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      additionalAppNames: ["Windsurf"],
      appName: "Devin",
      bundleIds: ["com.exafunction.windsurf"],
      builtIn: false,
      ...vsCodeFamilyCommands({
        bundledExecutable: resourcesAppBinExecutable("devin-desktop"),
        executable: "devin-desktop",
        fallbackExecutables: [LEGACY_WINDSURF_EXECUTABLE],
      }),
    },
  },
  {
    capabilities: BASIC_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "bbedit" },
    id: "bbedit",
    kind: "editor",
    label: "BBEdit",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "BBEdit",
      bundleIds: ["com.barebones.bbedit"],
      builtIn: false,
    },
  },
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "textmate" },
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
        executable: "open",
        supportsColumn: true,
        toArgs: (args) => ["-a", "TextMate", formatTextMateOpenUri(args)],
      },
    },
  },
  {
    capabilities: BASIC_FILE_OPEN_CAPABILITIES,
    icon: { kind: "builtin", name: "emacs" },
    id: "emacs",
    kind: "editor",
    label: "Emacs",
    fileOpenBehavior: "direct",
    macos: {
      openMode: "application",
      appName: "Emacs",
      bundleIds: ["org.gnu.Emacs"],
      builtIn: false,
    },
  },
  jetBrainsEditorAdapter({
    icon: { kind: "builtin", name: "intellij" },
    id: "intellij-idea",
    label: "IntelliJ IDEA",
    appName: "IntelliJ IDEA",
    bundleIds: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    executable: "idea",
    toolboxPrefix: "intellij idea",
  }),
  jetBrainsEditorAdapter({
    icon: { kind: "builtin", name: "pycharm" },
    id: "pycharm",
    label: "PyCharm",
    appName: "PyCharm",
    bundleIds: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
    executable: "pycharm",
    toolboxPrefix: "pycharm",
  }),
  jetBrainsEditorAdapter({
    icon: { kind: "builtin", name: "webstorm" },
    id: "webstorm",
    label: "WebStorm",
    appName: "WebStorm",
    bundleIds: ["com.jetbrains.WebStorm"],
    executable: "webstorm",
    toolboxPrefix: "webstorm",
  }),
  jetBrainsEditorAdapter({
    icon: { kind: "builtin", name: "goland" },
    id: "goland",
    label: "GoLand",
    appName: "GoLand",
    bundleIds: ["com.jetbrains.goland"],
    executable: "goland",
    toolboxPrefix: "goland",
  }),
  jetBrainsEditorAdapter({
    icon: { kind: "builtin", name: "rider" },
    id: "rider",
    label: "Rider",
    appName: "Rider",
    bundleIds: ["com.jetbrains.rider"],
    executable: "rider",
    toolboxPrefix: "rider",
  }),
  jetBrainsEditorAdapter({
    icon: { kind: "builtin", name: "rustrover" },
    id: "rustrover",
    label: "RustRover",
    appName: "RustRover",
    bundleIds: ["com.jetbrains.rustrover"],
    executable: "rustrover",
    toolboxPrefix: "rustrover",
  }),
  jetBrainsEditorAdapter({
    icon: { kind: "builtin", name: "phpstorm" },
    id: "phpstorm",
    label: "PhpStorm",
    appName: "PhpStorm",
    bundleIds: ["com.jetbrains.PhpStorm"],
    executable: "phpstorm",
    toolboxPrefix: "phpstorm",
  }),
  jetBrainsEditorAdapter({
    icon: { kind: "builtin", name: "android-studio" },
    id: "android-studio",
    label: "Android Studio",
    appName: "Android Studio",
    bundleIds: ["com.google.android.studio"],
    executable: "studio",
    toolboxPrefix: "android studio",
  }),
  {
    capabilities: FULL_FILE_OPEN_CAPABILITIES,
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
      ...vsCodeFamilyCommands({
        bundledExecutable: resourcesAppBinExecutable("antigravity"),
        executable: "antigravity",
      }),
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
      ...macTerminalAppCommands("Terminal"),
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
      ...macTerminalAppCommands("iTerm"),
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
            editorCommand: args.editorCommand,
            lineNumber: args.lineNumber,
            path: args.path,
            pathType: args.pathType,
            shellPath: args.shellPath,
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
    icon: { kind: "builtin", name: "warp" },
    id: "warp",
    kind: "terminal",
    label: "Warp",
    fileOpenBehavior: "containing-directory",
    macos: {
      openMode: "application",
      appName: "Warp",
      bundleIds: ["dev.warp.Warp", "dev.warp.Warp-Stable"],
      builtIn: false,
      localTerminalOpenCommand: {
        executable: "open",
        toArgs: (args) =>
          buildMacTerminalAppLocalOpenArgs({
            appName: "Warp",
            columnNumber: args.columnNumber,
            lineNumber: args.lineNumber,
            path: args.path,
            pathType: args.pathType,
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

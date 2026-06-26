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
  buildMacTerminalLocalOpenArgs,
  buildMacTerminalRemoteSshOpenArgs,
} from "./terminal.js";
import type {
  BuildMacLineOpenArgs,
  BuildMacRemoteSshOpenArgs,
  LaunchAdapter,
} from "./types.js";

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
            pathType: args.pathType,
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
            pathType: args.pathType,
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
            pathType: args.pathType,
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

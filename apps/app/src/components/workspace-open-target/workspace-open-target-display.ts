import type {
  WorkspaceOpenTargetIcon,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";

const WORKSPACE_OPEN_TARGET_FALLBACK_LABELS: Record<
  string,
  string | undefined
> = {
  "android-studio": "Android Studio",
  antigravity: "Antigravity",
  bbedit: "BBEdit",
  cursor: "Cursor",
  "default-app": "Default App",
  emacs: "Emacs",
  "file-manager": "File Manager",
  finder: "Finder",
  ghostty: "Ghostty",
  goland: "GoLand",
  "intellij-idea": "IntelliJ IDEA",
  iterm2: "iTerm2",
  phpstorm: "PhpStorm",
  pycharm: "PyCharm",
  rider: "Rider",
  rustrover: "RustRover",
  "sublime-text": "Sublime Text",
  terminal: "Terminal",
  textmate: "TextMate",
  "vscode-insiders": "VS Code Insiders",
  vscode: "VS Code",
  warp: "Warp",
  webstorm: "WebStorm",
  windsurf: "Windsurf",
  xcode: "Xcode",
  zed: "Zed",
};

export function getWorkspaceOpenTargetFallbackLabel(
  targetId: WorkspaceOpenTargetId,
): string {
  return WORKSPACE_OPEN_TARGET_FALLBACK_LABELS[targetId] ?? targetId;
}

export function getWorkspaceOpenTargetFallbackIcon(
  targetId: WorkspaceOpenTargetId,
): WorkspaceOpenTargetIcon {
  switch (targetId) {
    case "default-app":
      return { kind: "symbol", name: "default-app" };
    case "file-manager":
    case "finder":
      return { kind: "symbol", name: "file-manager" };
    case "terminal":
    case "iterm2":
    case "ghostty":
    case "warp":
      return { kind: "symbol", name: "terminal" };
    default:
      return { kind: "builtin", name: targetId };
  }
}

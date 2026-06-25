import type {
  WorkspaceOpenTargetIcon,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";

const WORKSPACE_OPEN_TARGET_FALLBACK_LABELS: Record<
  string,
  string | undefined
> = {
  antigravity: "Antigravity",
  cursor: "Cursor",
  "default-app": "Default App",
  "file-manager": "File Manager",
  finder: "Finder",
  ghostty: "Ghostty",
  iterm2: "iTerm2",
  "sublime-text": "Sublime Text",
  terminal: "Terminal",
  vscode: "VS Code",
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
      return { kind: "symbol", name: "terminal" };
    default:
      return { kind: "builtin", name: targetId };
  }
}

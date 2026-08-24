const TERMINAL_TITLE_MAX_LENGTH = 200;

interface NormalizeTerminalTitleArgs {
  title: string;
}

export function normalizeTerminalTitle({
  title,
}: NormalizeTerminalTitleArgs): string | null {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return null;
  }

  if (isShellPathTitle(trimmedTitle)) {
    return null;
  }

  return trimmedTitle.slice(0, TERMINAL_TITLE_MAX_LENGTH);
}

function isShellPathTitle(title: string): boolean {
  const match = /^[^@\s:]+@[^:\s]+:(.+)$/u.exec(title);
  const path = match?.[1]?.trimStart();
  return !!path && isPathLikeTerminalTitlePath(path);
}

function isPathLikeTerminalTitlePath(path: string): boolean {
  return (
    path === "~" ||
    path === "." ||
    path.startsWith("~/") ||
    path.startsWith("/") ||
    path.startsWith("./")
  );
}

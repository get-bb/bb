const TERMINAL_TITLE_MAX_LENGTH = 200;

interface NormalizeTerminalTitleArgs {
  title: string;
}

interface IsPathLikeTerminalTitlePathArgs {
  path: string;
}

interface ParseShellPathTitleArgs {
  title: string;
}

interface ShellPathTitleParts {
  path: string;
}

type NormalizedTerminalTitle = string | null;

export function normalizeTerminalTitle({
  title,
}: NormalizeTerminalTitleArgs): NormalizedTerminalTitle {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return null;
  }

  const pathTitle = parseShellPathTitle({ title: trimmedTitle });
  if (pathTitle !== null) {
    return null;
  }

  return trimmedTitle.slice(0, TERMINAL_TITLE_MAX_LENGTH);
}

function parseShellPathTitle({
  title,
}: ParseShellPathTitleArgs): ShellPathTitleParts | null {
  const match = /^[^@\s:]+@[^:\s]+:(.+)$/u.exec(title);
  const path = match?.[1]?.trimStart();
  if (!path || !isPathLikeTerminalTitlePath({ path })) {
    return null;
  }
  return { path };
}

function isPathLikeTerminalTitlePath({
  path,
}: IsPathLikeTerminalTitlePathArgs): boolean {
  return (
    path === "~" ||
    path === "." ||
    path.startsWith("~/") ||
    path.startsWith("/") ||
    path.startsWith("./")
  );
}

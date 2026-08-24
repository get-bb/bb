import type { TerminalSession } from "@bb/server-contract";

/**
 * Pure presentation helpers for terminal sessions (list rows, header, the
 * title sync from the shell's OSC title). Mirrors
 * apps/app/src/components/thread/terminal/thread-terminal-title.ts and the
 * status labels of useThreadTerminalController.ts.
 */

const TERMINAL_TITLE_MAX_LENGTH = 200;

function terminalStatusLabel(status: TerminalSession["status"]): string {
  switch (status) {
    case "starting":
      return "starting";
    case "running":
      return "running";
    case "disconnected":
      return "disconnected";
    case "exited":
      return "exited";
  }
}

export interface TerminalSessionRowModel {
  id: string;
  title: string;
  /** "running", "exited (code 1)", … */
  subtitle: string;
  active: boolean;
}

export function describeTerminalSessionRow(
  session: TerminalSession,
): TerminalSessionRowModel {
  const status = terminalStatusLabel(session.status);
  const subtitle =
    session.status === "exited" && session.exitCode !== null
      ? `${status} (code ${session.exitCode})`
      : status;
  return {
    id: session.id,
    title: session.title,
    subtitle,
    active: session.status === "running" || session.status === "starting",
  };
}

/** Newest first; live sessions before exited ones. */
export function sortTerminalSessions(
  sessions: readonly TerminalSession[],
): TerminalSession[] {
  return [...sessions].sort((left, right) => {
    const leftLive = left.status !== "exited" ? 0 : 1;
    const rightLive = right.status !== "exited" ? 0 : 1;
    if (leftLive !== rightLive) return leftLive - rightLive;
    return right.createdAt - left.createdAt;
  });
}

/** Status line the terminal page prints when a session is not running. */
export function terminalSessionStatusNotice(
  session: Pick<TerminalSession, "status" | "exitCode">,
): string | null {
  switch (session.status) {
    case "disconnected":
      return "Terminal disconnected";
    case "exited":
      return session.exitCode === null
        ? "Terminal exited"
        : `Terminal exited with code ${session.exitCode}`;
    case "starting":
    case "running":
      return null;
  }
}

function isPathLikeTitlePath(path: string): boolean {
  return (
    path === "~" ||
    path === "." ||
    path.startsWith("~/") ||
    path.startsWith("/") ||
    path.startsWith("./")
  );
}

/**
 * The shell's OSC title (`user@host:~/path`) is not worth a rename; anything
 * else (a program name like `vim`, `htop`) is, trimmed to the route's limit.
 * Returns null when the title should be left alone.
 */
export function normalizeTerminalTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const match = /^[^@\s:]+@[^:\s]+:(.+)$/u.exec(trimmed);
  const path = match?.[1]?.trimStart();
  if (path && isPathLikeTitlePath(path)) return null;
  return trimmed.slice(0, TERMINAL_TITLE_MAX_LENGTH);
}

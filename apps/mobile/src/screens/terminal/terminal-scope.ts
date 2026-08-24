import type { TerminalCreateScope } from "@bb/sdk/browser";
import type { TerminalQueryScope } from "@/lib/query/query-keys";
import type { PanelScope } from "../panel/panel-model";

/**
 * Which terminals a workspace-panel scope lists and creates. A thread's
 * terminals follow the thread (the server closes them with it); the
 * root-compose panel has no thread, so it uses the reused worktree when one
 * is picked and otherwise the selected machine's home directory
 * (`host_path`), like the web's nav-panel terminals.
 */
export function terminalListScopeForPanelScope(
  scope: PanelScope,
): TerminalQueryScope | null {
  if (scope.kind === "thread")
    return { kind: "thread", threadId: scope.threadId };
  if (scope.environmentId !== null) {
    return { kind: "environment", environmentId: scope.environmentId };
  }
  if (scope.hostId !== null) return { kind: "host_path", hostId: scope.hostId };
  return null;
}

export function terminalCreateScopeForPanelScope(
  scope: PanelScope,
): TerminalCreateScope | null {
  if (scope.kind === "thread")
    return { kind: "thread", threadId: scope.threadId };
  if (scope.environmentId !== null) {
    return { kind: "environment", environmentId: scope.environmentId };
  }
  if (scope.hostId !== null) {
    return { kind: "host_path", hostId: scope.hostId, cwd: null };
  }
  return null;
}

/** Why the panel cannot start a terminal in this scope. */
export function terminalScopeUnavailableMessage(scope: PanelScope): string {
  return scope.kind === "thread"
    ? "This thread has no workspace to run a terminal in."
    : "Pick a machine or a worktree to run a terminal.";
}

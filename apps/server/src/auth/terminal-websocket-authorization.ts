import {
  getEnvironment,
  getProject,
  getTerminalSession,
  getThread,
  type DbConnection,
} from "@bb/db";
import type { PolicyAction, PolicyResource } from "@bb/domain";

/** Namespaced action prefix for registry-issued terminal WebSocket operations. */
export const TERMINAL_WS_ACTION_PREFIX = "terminalWs." as const;

/** Fixed action name for opening a human browser terminal WebSocket. */
export const TERMINAL_WS_OPEN_ACTION_NAME =
  `${TERMINAL_WS_ACTION_PREFIX}open` as const;

/** Fixed action name for periodic membership recheck on a terminal socket. */
export const TERMINAL_WS_REAUTHORIZE_ACTION_NAME =
  `${TERMINAL_WS_ACTION_PREFIX}reauthorize` as const;

/**
 * Module-private identity registry. Only pairs returned by this module's
 * issuers are recognized; structural forgeries with matching field shapes are
 * denied even when names/kinds/ids look identical.
 */
const issuedActionToResource = new WeakMap<object, object>();

function issuePair(
  action: PolicyAction,
  resource: PolicyResource,
): { readonly action: PolicyAction; readonly resource: PolicyResource } {
  const frozenAction = Object.freeze({ name: action.name });
  const frozenResource = Object.freeze({
    kind: resource.kind,
    id: resource.id,
  });
  issuedActionToResource.set(frozenAction, frozenResource);
  return { action: frozenAction, resource: frozenResource };
}

const REAUTHORIZE_PAIR = issuePair(
  { name: TERMINAL_WS_REAUTHORIZE_ACTION_NAME },
  { kind: "terminalSocket", id: null },
);

/** Identity-issued pair used only for terminal-socket membership rechecks. */
export function getTerminalWebsocketReauthorizePair(): {
  readonly action: PolicyAction;
  readonly resource: PolicyResource;
} {
  return REAUTHORIZE_PAIR;
}

/**
 * True only for registry-issued terminal-WS action/resource pairs that share
 * object identity with this module's issuer. Structural copies return false.
 */
export function isRegistryIssuedTerminalWebsocketAuthorization(
  action: PolicyAction,
  resource: PolicyResource,
): boolean {
  if (
    action === null ||
    typeof action !== "object" ||
    resource === null ||
    typeof resource !== "object"
  ) {
    return false;
  }
  return issuedActionToResource.get(action) === resource;
}

export type ResolvedTerminalWebsocketOpenAuthorization =
  | {
      readonly kind: "issued";
      readonly action: PolicyAction;
      readonly resource: PolicyResource;
      readonly terminalId: string;
    }
  | {
      readonly kind: "denied";
    };

function denyOpen(): ResolvedTerminalWebsocketOpenAuthorization {
  return { kind: "denied" };
}

/**
 * Map a path terminal id to a registry-issued open authorization pair, or a
 * non-enumerating denial.
 *
 * Issued only when the terminal row has standard-project lineage:
 * - environmentId exists and belongs to a standard project
 * - when threadId is set, the thread exists, is standard, and matches that
 *   project (and environment when the thread itself is environment-bound)
 *
 * Denial covers missing rows, host-path (no environment), personal projects,
 * and inconsistent thread/environment/project lineage. Callers must not use
 * the denial to distinguish existence.
 */
export function resolveTerminalWebsocketOpenAuthorization(
  db: DbConnection,
  terminalId: string,
): ResolvedTerminalWebsocketOpenAuthorization {
  if (typeof terminalId !== "string" || terminalId.length < 1) {
    return denyOpen();
  }

  const session = getTerminalSession(db, { terminalId });
  if (session === null) {
    return denyOpen();
  }

  // Host-path / environment-less terminals are never authorized for scoped WT.
  if (
    session.environmentId === null ||
    typeof session.environmentId !== "string" ||
    session.environmentId.length < 1
  ) {
    return denyOpen();
  }

  const environment = getEnvironment(db, session.environmentId);
  if (
    environment === null ||
    environment.status === "destroyed" ||
    session.hostId !== environment.hostId
  ) {
    return denyOpen();
  }

  const environmentProject = getProject(db, environment.projectId);
  if (environmentProject === null || environmentProject.kind !== "standard") {
    return denyOpen();
  }

  if (session.threadId !== null) {
    if (typeof session.threadId !== "string" || session.threadId.length < 1) {
      return denyOpen();
    }
    const thread = getThread(db, session.threadId);
    if (thread === null || thread.deletedAt !== null) {
      return denyOpen();
    }
    const threadProject = getProject(db, thread.projectId);
    if (threadProject === null || threadProject.kind !== "standard") {
      return denyOpen();
    }
    if (thread.projectId !== environment.projectId) {
      return denyOpen();
    }
    // Thread assigned to a different environment than the terminal is
    // inconsistent lineage.
    if (thread.environmentId !== session.environmentId) {
      return denyOpen();
    }
  }

  const pair = issuePair(
    { name: TERMINAL_WS_OPEN_ACTION_NAME },
    { kind: "terminal", id: terminalId },
  );
  return {
    kind: "issued",
    action: pair.action,
    resource: pair.resource,
    terminalId,
  };
}

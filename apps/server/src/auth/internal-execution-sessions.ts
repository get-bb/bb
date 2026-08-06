import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
} from "@bb/domain";
import type { InternalPrincipalSession } from "./internal-principal-authority.js";
import {
  PUBLIC_HTTP_ACTION_PREFIX,
  isRegistryIssuedPublicHttpAuthorization,
} from "./public-http-authorization.js";

/**
 * Exact Principal modes for server-minted internal execution sessions.
 * Unknown or padded values fail closed at construction.
 */
export type InternalExecutionPrincipalMode = "local-owner" | "work-together";

export type PluginBackgroundCallbackCategory =
  | "service"
  | "schedule"
  | "thread-event"
  | "dispose";

export type CreateInternalExecutionSessionsArgs = {
  readonly mode: InternalExecutionPrincipalMode;
};

export type CreatePluginBackgroundSessionArgs = {
  readonly pluginId: string;
  readonly callbackCategory: PluginBackgroundCallbackCategory;
  readonly callbackName: string;
};

export type CreateThreadAgentSessionArgs = {
  readonly threadId: string;
  readonly projectId: string;
};

export type InternalExecutionSessions = {
  createPluginBackgroundSession(
    args: CreatePluginBackgroundSessionArgs,
  ): InternalPrincipalSession;
  createThreadAgentSession(
    args: CreateThreadAgentSessionArgs,
  ): InternalPrincipalSession;
};

/** Fixed display name for plugin-background system Principals. */
export const PLUGIN_BACKGROUND_PRINCIPAL_DISPLAY_NAME = "Plugin background";

/** Fixed display name for per-thread agent Principals. */
export const THREAD_AGENT_PRINCIPAL_DISPLAY_NAME = "Thread agent";

// Module-private issuance brand: derived authority accepts only sessions
// minted by this module, never a structurally supplied system/agent session.
const issuedInternalDerivedSessions = new WeakSet<object>();

const CALLBACK_CATEGORIES = new Set<PluginBackgroundCallbackCategory>([
  "service",
  "schedule",
  "thread-event",
  "dispose",
]);

/**
 * Work-together thread-agent allowlist: exact-thread public HTTP operations.
 * Kept closed and intentional — collection/admin mutations stay out.
 */
const THREAD_AGENT_THREAD_OPERATIONS = Object.freeze(
  new Set<string>([
    "threads.get",
    "threads.childSummary",
    "threads.send",
    "threads.interactions",
    "threads.interaction",
    "threads.timeline",
    "threads.conversationOutline",
    "threads.timelineTurnSummaryDetails",
    "threads.output",
    "threads.events",
    "threads.eventWait",
    "threads.defaultExecutionOptions",
    "threads.storageFiles",
    "threads.storageFile",
    "threads.storagePaths",
    "threads.storageContent",
    "threads.worktreeFile",
  ]),
);

const THREAD_AGENT_PROJECT_OPERATIONS = Object.freeze(
  new Set<string>([
    "projects.get",
    "projects.defaultExecutionOptions",
    "projects.promptHistory",
    "projects.files",
    "projects.fileContent",
    "projects.paths",
    "projects.commands",
    "projects.skills",
    "projects.skillContent",
    "projects.skillFiles",
    "projects.branches",
    "projects.attachmentContent",
  ]),
);

const THREAD_AGENT_SYSTEM_OPERATIONS = Object.freeze(
  new Set<string>([
    "system.providers",
    "system.executionOptions",
    "system.providerLogo",
    "system.version",
  ]),
);

/**
 * Sanitized construction/authorization failure. Messages stay generic and never
 * echo caller-selected ids, display names, or action details.
 */
export class InternalExecutionSessionError extends Error {
  constructor() {
    super("Internal execution session rejected the request");
    this.name = "InternalExecutionSessionError";
  }
}

function rejectInternalExecutionSession(): never {
  throw new InternalExecutionSessionError();
}

function assertExactMode(
  value: unknown,
): asserts value is InternalExecutionPrincipalMode {
  if (value !== "local-owner" && value !== "work-together") {
    rejectInternalExecutionSession();
  }
}

/**
 * Opaque path-safe identifier segment used in Principal ids and resource
 * matching. Rejects empty, trimmed, path, and query-bearing values.
 */
function assertEntityId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  ) {
    rejectInternalExecutionSession();
  }
  return value;
}

function assertPluginId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)
  ) {
    rejectInternalExecutionSession();
  }
  return value;
}

function assertCallbackName(value: unknown): string {
  // Dots are required so thread-event callbackName can be the canonical
  // event name (e.g. "thread.created").
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,64}$/u.test(value)) {
    rejectInternalExecutionSession();
  }
  return value;
}

function assertCallbackCategory(
  value: unknown,
): asserts value is PluginBackgroundCallbackCategory {
  if (
    typeof value !== "string" ||
    !CALLBACK_CATEGORIES.has(value as PluginBackgroundCallbackCategory)
  ) {
    rejectInternalExecutionSession();
  }
}

function readPublicHttpOperationName(action: PolicyAction): string | null {
  if (
    action === null ||
    typeof action !== "object" ||
    typeof action.name !== "string" ||
    !action.name.startsWith(PUBLIC_HTTP_ACTION_PREFIX)
  ) {
    return null;
  }
  const operationName = action.name.slice(PUBLIC_HTTP_ACTION_PREFIX.length);
  if (operationName.length === 0 || operationName === "unmapped") {
    return null;
  }
  return operationName;
}

function freezePrincipal(principal: Principal): Principal {
  return Object.freeze({
    id: principal.id,
    kind: principal.kind,
    displayName: principal.displayName,
  });
}

function freezeSession(
  principal: Principal,
  authorize: (
    action: PolicyAction,
    resource: PolicyResource,
  ) => Promise<PolicyDecision>,
): InternalPrincipalSession {
  const session = Object.freeze({
    principal: freezePrincipal(principal),
    authorize: Object.freeze(authorize),
  });
  issuedInternalDerivedSessions.add(session);
  return session;
}

/** True only for a system/agent session issued by this deep module. */
export function isIssuedInternalDerivedSession(
  value: unknown,
): value is InternalPrincipalSession {
  return (
    typeof value === "object" &&
    value !== null &&
    issuedInternalDerivedSessions.has(value)
  );
}

function allowAllAuthorize(
  _action: PolicyAction,
  _resource: PolicyResource,
): Promise<PolicyDecision> {
  return Promise.resolve({ allowed: true });
}

/**
 * Intentional work-together deny-all for plugin background until a later
 * per-bundled-callback capability profile lands. Not an accidental unmapped
 * miss — every action is explicitly refused.
 */
function denyAllAuthorize(
  _action: PolicyAction,
  _resource: PolicyResource,
): Promise<PolicyDecision> {
  return Promise.resolve({ allowed: false, reason: "forbidden" });
}

function createThreadAgentAuthorize(args: {
  readonly mode: InternalExecutionPrincipalMode;
  readonly threadId: string;
  readonly projectId: string;
}): (
  action: PolicyAction,
  resource: PolicyResource,
) => Promise<PolicyDecision> {
  if (args.mode === "local-owner") {
    return allowAllAuthorize;
  }

  const threadId = args.threadId;
  const projectId = args.projectId;

  return async (
    action: PolicyAction,
    resource: PolicyResource,
  ): Promise<PolicyDecision> => {
    if (!isRegistryIssuedPublicHttpAuthorization(action, resource)) {
      return { allowed: false, reason: "forbidden" };
    }
    const operationName = readPublicHttpOperationName(action);
    if (operationName === null) {
      return { allowed: false, reason: "forbidden" };
    }

    if (
      resource.kind === "thread" &&
      resource.id === threadId &&
      THREAD_AGENT_THREAD_OPERATIONS.has(operationName)
    ) {
      return { allowed: true };
    }
    if (
      resource.kind === "project" &&
      resource.id === projectId &&
      THREAD_AGENT_PROJECT_OPERATIONS.has(operationName)
    ) {
      return { allowed: true };
    }
    if (
      resource.kind === "systemSettings" &&
      THREAD_AGENT_SYSTEM_OPERATIONS.has(operationName)
    ) {
      // Registry already enforces id null for unscoped system ops and a
      // non-null provider id for providerLogo.
      return { allowed: true };
    }
    return { allowed: false, reason: "forbidden" };
  };
}

function pluginBackgroundPrincipalId(args: {
  readonly pluginId: string;
  readonly callbackCategory: PluginBackgroundCallbackCategory;
  readonly callbackName: string;
}): string {
  return `system:plugin-background/${args.pluginId}/${args.callbackCategory}/${args.callbackName}`;
}

function threadAgentPrincipalId(threadId: string): string {
  return `agent:thread/${threadId}`;
}

/**
 * Deep module that mints immutable system/agent InternalPrincipalSessions.
 *
 * Callers supply mode plus validated plugin/thread coordinates only — never a
 * Principal, displayName, or authorize callback. Humans and machines cannot be
 * manufactured through this seam.
 */
export function createInternalExecutionSessions(
  args: CreateInternalExecutionSessionsArgs,
): InternalExecutionSessions {
  if (args === null || typeof args !== "object") {
    rejectInternalExecutionSession();
  }
  assertExactMode(args.mode);
  const mode = args.mode;

  function createPluginBackgroundSession(
    sessionArgs: CreatePluginBackgroundSessionArgs,
  ): InternalPrincipalSession {
    if (sessionArgs === null || typeof sessionArgs !== "object") {
      rejectInternalExecutionSession();
    }
    const pluginId = assertPluginId(sessionArgs.pluginId);
    assertCallbackCategory(sessionArgs.callbackCategory);
    const callbackCategory = sessionArgs.callbackCategory;
    const callbackName = assertCallbackName(sessionArgs.callbackName);

    const principal = freezePrincipal({
      id: pluginBackgroundPrincipalId({
        pluginId,
        callbackCategory,
        callbackName,
      }),
      kind: "system",
      displayName: PLUGIN_BACKGROUND_PRINCIPAL_DISPLAY_NAME,
    });

    const authorize =
      mode === "local-owner" ? allowAllAuthorize : denyAllAuthorize;

    return freezeSession(principal, authorize);
  }

  function createThreadAgentSession(
    sessionArgs: CreateThreadAgentSessionArgs,
  ): InternalPrincipalSession {
    if (sessionArgs === null || typeof sessionArgs !== "object") {
      rejectInternalExecutionSession();
    }
    const threadId = assertEntityId(sessionArgs.threadId);
    const projectId = assertEntityId(sessionArgs.projectId);

    const principal = freezePrincipal({
      id: threadAgentPrincipalId(threadId),
      kind: "agent",
      displayName: THREAD_AGENT_PRINCIPAL_DISPLAY_NAME,
    });

    return freezeSession(
      principal,
      createThreadAgentAuthorize({ mode, threadId, projectId }),
    );
  }

  return Object.freeze({
    createPluginBackgroundSession,
    createThreadAgentSession,
  });
}

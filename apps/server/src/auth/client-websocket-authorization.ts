import {
  getEnvironment,
  getProject,
  getThread,
  type DbConnection,
} from "@bb/db";
import type {
  PolicyAction,
  PolicyResource,
  RealtimeSubscriptionTarget,
} from "@bb/domain";

/** Namespaced action prefix for registry-issued client WebSocket operations. */
export const CLIENT_WS_ACTION_PREFIX = "clientWs." as const;

/** Fixed action name for periodic membership recheck on an open client socket. */
export const CLIENT_WS_REAUTHORIZE_ACTION_NAME =
  `${CLIENT_WS_ACTION_PREFIX}reauthorize` as const;

/** Fixed action name for authorizing an exact detail subscription target. */
export const CLIENT_WS_SUBSCRIBE_ACTION_NAME =
  `${CLIENT_WS_ACTION_PREFIX}subscribe` as const;

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
  { name: CLIENT_WS_REAUTHORIZE_ACTION_NAME },
  { kind: "clientSocket", id: null },
);

/**
 * Fixed reauthorize action/resource pair. Identity-only: callers must pass the
 * exact objects from this issuer (or the re-exported getters).
 */
export function getClientWebsocketReauthorizePair(): {
  readonly action: PolicyAction;
  readonly resource: PolicyResource;
} {
  return REAUTHORIZE_PAIR;
}

/**
 * True only for registry-issued client-WS action/resource pairs that share
 * object identity with this module's issuer. Structural copies return false.
 */
export function isRegistryIssuedClientWebsocketAuthorization(
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

export type ResolvedClientWebsocketSubscribeAuthorization =
  | {
      readonly kind: "issued";
      readonly action: PolicyAction;
      readonly resource: PolicyResource;
      readonly target: RealtimeSubscriptionTarget;
    }
  | {
      readonly kind: "denied";
    };

function denySubscribe(): ResolvedClientWebsocketSubscribeAuthorization {
  return { kind: "denied" };
}

function issueSubscribe(
  resourceKind: string,
  resourceId: string,
  target: RealtimeSubscriptionTarget,
): ResolvedClientWebsocketSubscribeAuthorization {
  const pair = issuePair(
    { name: CLIENT_WS_SUBSCRIBE_ACTION_NAME },
    { kind: resourceKind, id: resourceId },
  );
  return {
    kind: "issued",
    action: pair.action,
    resource: pair.resource,
    target: Object.freeze({ ...target }),
  };
}

/**
 * Map a parsed realtime subscription target to a registry-issued authorize
 * pair, or a non-enumerating denial. Only exact standard-project detail
 * targets that exist in the database are issued.
 *
 * Denial covers: missing entities, personal projects, every list target, host
 * detail/list, system, and any other unmapped kind. Callers must not use the
 * denial reason to distinguish existence.
 */
export function resolveClientWebsocketSubscribeAuthorization(
  db: DbConnection,
  target: RealtimeSubscriptionTarget,
): ResolvedClientWebsocketSubscribeAuthorization {
  if (target === null || typeof target !== "object") {
    return denySubscribe();
  }

  switch (target.kind) {
    case "thread-detail": {
      if (typeof target.threadId !== "string" || target.threadId.length < 1) {
        return denySubscribe();
      }
      const thread = getThread(db, target.threadId);
      if (thread === null) {
        return denySubscribe();
      }
      const project = getProject(db, thread.projectId);
      if (project === null || project.kind !== "standard") {
        return denySubscribe();
      }
      return issueSubscribe("threadEvents", target.threadId, target);
    }
    case "project-detail": {
      if (typeof target.projectId !== "string" || target.projectId.length < 1) {
        return denySubscribe();
      }
      const project = getProject(db, target.projectId);
      if (project === null || project.kind !== "standard") {
        return denySubscribe();
      }
      return issueSubscribe("project", target.projectId, target);
    }
    case "environment-detail": {
      if (
        typeof target.environmentId !== "string" ||
        target.environmentId.length < 1
      ) {
        return denySubscribe();
      }
      const environment = getEnvironment(db, target.environmentId);
      if (environment === null) {
        return denySubscribe();
      }
      const project = getProject(db, environment.projectId);
      if (project === null || project.kind !== "standard") {
        return denySubscribe();
      }
      return issueSubscribe("environment", target.environmentId, target);
    }
    case "thread-list":
    case "project-list":
    case "environment-list":
    case "host-detail":
    case "host-list":
    case "system":
      return denySubscribe();
    default: {
      const _exhaustive: never = target;
      void _exhaustive;
      return denySubscribe();
    }
  }
}

import {
  SYSTEM_ACTOR_STAMP,
  actorStampSchema,
  type ActorStamp,
  type Principal,
} from "@bb/domain";
import { requirePrincipal } from "../request-context.js";

export { SYSTEM_ACTOR_STAMP };

/** Display name for exact-thread-agent stamps on daemon-transported events. */
export const THREAD_AGENT_ACTOR_DISPLAY_NAME = "Thread agent";

/**
 * Convert a verified Principal into an immutable ActorStamp snapshot.
 * Call only with server-resolved Principals — never request body fields.
 */
export function actorStampFromPrincipal(principal: Principal): ActorStamp {
  return actorStampSchema.parse({
    principalId: principal.id,
    principalKind: principal.kind,
    displayName: principal.displayName,
  });
}

/**
 * Fail-closed stamp for the request-scoped verified Principal.
 * Same durable mutation/event transaction as requirePrincipal(context).
 */
export function requireRequestActorStamp(context: object): ActorStamp {
  return actorStampFromPrincipal(requirePrincipal(context));
}

/**
 * Exact thread agent stamp for daemon-transported provider/thread events.
 * Derived only from the target thread id — never from the machine transport
 * Principal or daemon payload actor fields.
 */
export function exactThreadAgentActorStamp(threadId: string): ActorStamp {
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("exactThreadAgentActorStamp requires a non-empty threadId");
  }
  return actorStampSchema.parse({
    principalId: `agent:thread/${threadId}`,
    principalKind: "agent",
    displayName: THREAD_AGENT_ACTOR_DISPLAY_NAME,
  });
}

/**
 * Explicit stable system stamp for server lifecycle/recovery events when no
 * admitted actor must be preserved.
 */
export function systemActorStamp(): ActorStamp {
  return SYSTEM_ACTOR_STAMP;
}

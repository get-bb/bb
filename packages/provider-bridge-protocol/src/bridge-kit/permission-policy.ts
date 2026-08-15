/**
 * The single statement of when an interactive provider request is answered
 * without ever reaching the user.
 *
 * Both sides of the bridge boundary enforce it and they must agree: a bridge
 * auto-denies its provider's own permission prompts, and the runtime
 * auto-denies the inbound requests that still arrive (a bridge whose provider
 * only learns the policy after the prompt is already in flight). Stating it
 * twice is how the two sides drift, so it lives in the kit — the one place a
 * plugin-shipped bridge and `@bb/agent-runtime` can both import from.
 */
import type { PermissionEscalation } from "@bb/domain";

export interface InteractiveRequestPolicyInput {
  permissionEscalation: PermissionEscalation | null;
}

export function shouldAutoDenyInteractiveRequest(
  policy: InteractiveRequestPolicyInput,
): boolean {
  return policy.permissionEscalation === "deny";
}

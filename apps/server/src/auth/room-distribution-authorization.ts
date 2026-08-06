import type { PolicyAction, PolicyResource } from "@bb/domain";

export const ROOM_DISTRIBUTION_ACTION_PREFIX = "roomDistribution." as const;

export type RoomDistributionAuthorizationOperation =
  | "bootstrap"
  | "commands"
  | "events"
  | "subscribe"
  | "reauthorize";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const OPERATIONS = new Set<RoomDistributionAuthorizationOperation>([
  "bootstrap",
  "commands",
  "events",
  "subscribe",
  "reauthorize",
]);

const issuedActionToResource = new WeakMap<object, object>();

/**
 * Issue one binding-scoped Room distribution authorization pair. Object
 * identity is the authority boundary; structural copies are always denied.
 */
export function issueRoomDistributionAuthorization(args: {
  readonly bindingId: string;
  readonly operation: RoomDistributionAuthorizationOperation;
}): { readonly action: PolicyAction; readonly resource: PolicyResource } {
  if (!CANONICAL_UUID.test(args.bindingId) || !OPERATIONS.has(args.operation)) {
    throw new Error("Invalid Room distribution authorization target");
  }
  const action = Object.freeze({
    name: `${ROOM_DISTRIBUTION_ACTION_PREFIX}${args.operation}`,
  });
  const resource = Object.freeze({
    kind: "room",
    id: args.bindingId,
  });
  issuedActionToResource.set(action, resource);
  return Object.freeze({ action, resource });
}

/** Recognize only exact pairs minted by this module's private registry. */
export function isRegistryIssuedRoomDistributionAuthorization(
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

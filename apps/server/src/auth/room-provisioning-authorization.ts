import type { PolicyAction, PolicyResource } from "@bb/domain";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const issuedActionToResource = new WeakMap<object, object>();

/**
 * Mint the owner-only authorization pair for one WT-initiated binding
 * provisioning request. Object identity prevents structural forgery by other
 * HTTP surfaces in this process.
 */
export function issueRoomProvisioningAuthorization(bindingId: string): {
  readonly action: PolicyAction;
  readonly resource: PolicyResource;
} {
  if (!CANONICAL_UUID.test(bindingId)) {
    throw new Error("Invalid Room provisioning authorization target");
  }
  const action = Object.freeze({ name: "roomProvisioning.provision" });
  const resource = Object.freeze({ kind: "room", id: bindingId });
  issuedActionToResource.set(action, resource);
  return Object.freeze({ action, resource });
}

export function isRegistryIssuedRoomProvisioningAuthorization(
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

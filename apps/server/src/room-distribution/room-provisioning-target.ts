import { canonicalizeInternalRequestTarget } from "@bb/server-contract";

const PREFIX = "/api/bb-room-provisioning/v1/room-bindings/";
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export class InvalidRoomProvisioningTargetError extends Error {
  constructor() {
    super("Invalid room provisioning target");
    this.name = "InvalidRoomProvisioningTargetError";
  }
}

function reject(): never {
  throw new InvalidRoomProvisioningTargetError();
}

/** Accept only the one target-bound, non-public WT provisioning route. */
export function parseRoomProvisioningTarget(input: {
  readonly method: string;
  readonly target: string;
  readonly transport: string;
}): { readonly bindingId: string } {
  if (
    input === null ||
    typeof input !== "object" ||
    input.method !== "POST" ||
    input.transport !== "http" ||
    typeof input.target !== "string"
  ) {
    reject();
  }
  let canonical: string;
  try {
    canonical = canonicalizeInternalRequestTarget(input.target);
  } catch {
    reject();
  }
  if (canonical !== input.target || !input.target.startsWith(PREFIX)) {
    reject();
  }
  const bindingId = input.target.slice(PREFIX.length);
  if (!CANONICAL_UUID.test(bindingId)) {
    reject();
  }
  return Object.freeze({ bindingId });
}

import { describe, expect, it } from "vitest";

import {
  isRegistryIssuedRoomProvisioningAuthorization,
  issueRoomProvisioningAuthorization,
} from "../../src/auth/room-provisioning-authorization.js";

const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";

describe("Room provisioning authorization registry", () => {
  it("recognizes only the exact binding-scoped pair it issued", () => {
    const pair = issueRoomProvisioningAuthorization(BINDING_ID);
    expect(
      isRegistryIssuedRoomProvisioningAuthorization(pair.action, pair.resource),
    ).toBe(true);
    expect(
      isRegistryIssuedRoomProvisioningAuthorization(
        { ...pair.action },
        pair.resource,
      ),
    ).toBe(false);
    expect(
      isRegistryIssuedRoomProvisioningAuthorization(pair.action, {
        ...pair.resource,
      }),
    ).toBe(false);
  });

  it("rejects malformed binding ids", () => {
    expect(() => issueRoomProvisioningAuthorization("not-a-binding")).toThrow(
      "Invalid Room provisioning authorization target",
    );
  });
});

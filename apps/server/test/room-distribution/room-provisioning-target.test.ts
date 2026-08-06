import { describe, expect, it } from "vitest";

import {
  InvalidRoomProvisioningTargetError,
  parseRoomProvisioningTarget,
} from "../../src/room-distribution/room-provisioning-target.js";

const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const PATH = `/api/bb-room-provisioning/v1/room-bindings/${BINDING_ID}`;

describe("Room provisioning target", () => {
  it("accepts only the exact POST/http origin-form target", () => {
    expect(
      parseRoomProvisioningTarget({
        method: "POST",
        target: PATH,
        transport: "http",
      }),
    ).toEqual({ bindingId: BINDING_ID });
  });

  it.each([
    ["GET", PATH, "http"],
    ["POST", `${PATH}/`, "http"],
    ["POST", `${PATH}?retry=1`, "http"],
    ["POST", PATH.replace(BINDING_ID, BINDING_ID.toUpperCase()), "http"],
    ["POST", PATH.replace("provisioning", "rooms"), "http"],
    ["POST", PATH, "websocket"],
    ["POST", `http://cell.invalid${PATH}`, "http"],
  ])("rejects %s %s over %s", (method, target, transport) => {
    expect(() =>
      parseRoomProvisioningTarget({ method, target, transport }),
    ).toThrow(InvalidRoomProvisioningTargetError);
  });
});

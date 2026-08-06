import { describe, expect, it } from "vitest";
import {
  isRegistryIssuedRoomDistributionAuthorization,
  issueRoomDistributionAuthorization,
} from "../../src/auth/room-distribution-authorization.js";

const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";

describe("Room distribution authorization registry", () => {
  it("issues frozen binding-scoped pairs for the closed operation set", () => {
    for (const operation of [
      "bootstrap",
      "commands",
      "events",
      "subscribe",
      "reauthorize",
    ] as const) {
      const pair = issueRoomDistributionAuthorization({
        bindingId: BINDING_ID,
        operation,
      });
      expect(pair).toEqual({
        action: { name: `roomDistribution.${operation}` },
        resource: { kind: "room", id: BINDING_ID },
      });
      expect(Object.isFrozen(pair)).toBe(true);
      expect(Object.isFrozen(pair.action)).toBe(true);
      expect(Object.isFrozen(pair.resource)).toBe(true);
      expect(
        isRegistryIssuedRoomDistributionAuthorization(
          pair.action,
          pair.resource,
        ),
      ).toBe(true);
    }
  });

  it("rejects structural forgeries and crossed issued pairs", () => {
    const first = issueRoomDistributionAuthorization({
      bindingId: BINDING_ID,
      operation: "events",
    });
    const second = issueRoomDistributionAuthorization({
      bindingId: "88888888-aaaa-4bbb-8ccc-dddddddddddd",
      operation: "events",
    });
    expect(
      isRegistryIssuedRoomDistributionAuthorization(
        { ...first.action },
        { ...first.resource },
      ),
    ).toBe(false);
    expect(
      isRegistryIssuedRoomDistributionAuthorization(
        first.action,
        second.resource,
      ),
    ).toBe(false);
  });

  it("refuses non-canonical ids and unknown operations", () => {
    expect(() =>
      issueRoomDistributionAuthorization({
        bindingId: BINDING_ID.toUpperCase(),
        operation: "events",
      }),
    ).toThrow("Invalid Room distribution authorization target");
    expect(() =>
      issueRoomDistributionAuthorization({
        bindingId: "not-a-binding",
        operation: "events",
      }),
    ).toThrow("Invalid Room distribution authorization target");
    expect(() =>
      issueRoomDistributionAuthorization({
        bindingId: BINDING_ID,
        operation: "raw" as "events",
      }),
    ).toThrow("Invalid Room distribution authorization target");
  });
});

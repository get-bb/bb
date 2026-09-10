import { describe, expect, it } from "vitest";
import {
  machineServerAccessBlockedReason,
  machineServerAccessReady,
} from "./machine-server-access";
import type { ServerAccessStatus } from "@bb/server-contract";

function status(
  overrides: Partial<ServerAccessStatus> = {},
): ServerAccessStatus {
  return {
    providers: [
      {
        id: "relay",
        displayName: "Relay",
        description: "Use a managed relay.",
        pluginId: "relay-plugin",
      },
    ],
    defaultProviderId: "relay",
    effectiveUrl: null,
    urlSource: null,
    ...overrides,
  };
}

describe("machine server access readiness", () => {
  it("accepts a registered provider and rejects missing configuration", () => {
    expect(machineServerAccessReady(status())).toBe(true);
    expect(machineServerAccessReady(status({ providers: [] }))).toBe(false);
    expect(machineServerAccessReady(undefined)).toBe(false);
  });

  it("requires a reachable address for direct access", () => {
    const direct = status({
      defaultProviderId: "direct",
      providers: [
        {
          id: "direct",
          displayName: "Manual",
          description: "Use a network address.",
          pluginId: null,
        },
      ],
      effectiveUrl: "https://bb.example.com",
      urlSource: "setting",
    });
    expect(machineServerAccessReady(direct)).toBe(true);
    expect(
      machineServerAccessReady({
        ...direct,
        effectiveUrl: "http://localhost:3000",
      }),
    ).toBe(false);
  });

  it("explains blocked configuration and clears the reason when ready", () => {
    const blocked = status({ providers: [] });
    expect(machineServerAccessBlockedReason(blocked)).toBe(
      "Configure how machines should connect to this bb server.",
    );
    expect(machineServerAccessBlockedReason(status())).toBeNull();
  });
});

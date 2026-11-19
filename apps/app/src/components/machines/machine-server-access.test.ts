import { describe, expect, it } from "vitest";
import {
  MACHINE_SERVER_ACCESS_UNSET_REASON,
  machineServerAccessBlockedReason,
  machineServerAccessReady,
} from "./machine-server-access";
import type { ServerAccessStatus } from "@bb/server-contract";

type Provider = ServerAccessStatus["providers"][number];

function provider(
  overrides: Partial<Provider> & Pick<Provider, "id">,
): Provider {
  return {
    displayName: overrides.id,
    description: "",
    pluginId: null,
    routeKind: "custom",
    enabled: true,
    availability: { status: "available" },
    urls: [],
    ...overrides,
  };
}

function status(providers: Provider[]): ServerAccessStatus {
  return {
    providers,
    effectiveUrl: null,
    urlSource: null,
    localNetwork: { bindHost: "127.0.0.1", addresses: [], listenerError: null },
  };
}

const LAN_OFF = provider({
  id: "local-network",
  routeKind: "local-network",
  enabled: false,
  availability: {
    status: "setup-required",
    message: "Turn on to let devices on this network reach bb",
  },
});
const RELAY_UNPAIRED = provider({
  id: "connect",
  pluginId: "connect",
  routeKind: "relay",
  availability: { status: "setup-required", message: "Pair with bb connect" },
});
const MANUAL_UNSET = provider({
  id: "direct",
  availability: {
    status: "setup-required",
    message: "Set a server URL reachable by machines",
  },
});

describe("machine server access readiness", () => {
  it("is ready once any enabled route is reachable, wherever it sits in the order", () => {
    expect(
      machineServerAccessReady(status([LAN_OFF, RELAY_UNPAIRED, MANUAL_UNSET])),
    ).toBe(false);
    const manual = provider({
      id: "direct",
      urls: ["https://bb.example.com"],
    });
    const access = status([LAN_OFF, RELAY_UNPAIRED, manual]);
    expect(machineServerAccessReady(access)).toBe(true);
    expect(machineServerAccessBlockedReason(access)).toBeNull();
  });

  it("ignores available routes that are turned off", () => {
    const relay = provider({
      id: "connect",
      pluginId: "connect",
      enabled: false,
      urls: ["https://me.getbb.app"],
    });
    const access = status([relay, MANUAL_UNSET]);
    expect(machineServerAccessReady(access)).toBe(false);
    expect(machineServerAccessBlockedReason(access)).toBe(
      "Set a server URL reachable by machines",
    );
  });

  it("does not count an address only this computer can reach", () => {
    const local = provider({ id: "direct", urls: ["http://localhost:3000"] });
    expect(machineServerAccessReady(status([local]))).toBe(false);
    const lan = provider({
      id: "local-network",
      routeKind: "local-network",
      urls: ["http://192.168.1.5:38886"],
    });
    expect(machineServerAccessReady(status([local, lan]))).toBe(true);
  });

  it("trusts a plugin route that grants addresses per machine", () => {
    const relay = provider({ id: "connect", pluginId: "connect" });
    expect(machineServerAccessReady(status([relay]))).toBe(true);
    expect(machineServerAccessReady(status([provider({ id: "direct" })]))).toBe(
      false,
    );
  });

  it("explains the first enabled route that is not working", () => {
    const lanBroken = provider({
      id: "local-network",
      routeKind: "local-network",
      availability: {
        status: "unavailable",
        message: "This computer has no private local network address",
      },
    });
    expect(
      machineServerAccessBlockedReason(
        status([LAN_OFF, RELAY_UNPAIRED, lanBroken]),
      ),
    ).toBe("Pair with bb connect");
    expect(
      machineServerAccessBlockedReason(status([lanBroken, RELAY_UNPAIRED])),
    ).toBe("This computer has no private local network address");
  });

  it("falls back to the generic reason when nothing is enabled or loaded", () => {
    expect(machineServerAccessBlockedReason(status([LAN_OFF]))).toBe(
      MACHINE_SERVER_ACCESS_UNSET_REASON,
    );
    expect(machineServerAccessBlockedReason(undefined)).toBe(
      MACHINE_SERVER_ACCESS_UNSET_REASON,
    );
    expect(machineServerAccessReady(undefined)).toBe(false);
  });
});

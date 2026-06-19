import { describe, expect, it } from "vitest";
import { LanDiscovery } from "../../../src/services/peer-share/lan-discovery.js";

const silentLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

/**
 * Exercise the peer-bookkeeping logic directly (no real socket): announce
 * packets arrive via the private message handler, and listPeers filters self +
 * expired entries against the injected clock.
 */
function makeDiscovery(now: () => number) {
  return new LanDiscovery({
    instanceId: "self",
    logger: silentLogger,
    getAnnounce: () => ({ displayName: "Self", apiPort: 38886 }),
    now,
  });
}

function feed(
  discovery: LanDiscovery,
  payload: { instanceId: string; displayName: string; port: number },
  address: string,
): void {
  // Drive the same path the UDP "message" handler uses.
  (
    discovery as unknown as {
      handleMessage: (message: Buffer, address: string) => void;
    }
  ).handleMessage(
    Buffer.from(JSON.stringify({ marker: "bb-peer-share/1", ...payload })),
    address,
  );
}

describe("LanDiscovery", () => {
  it("records announced peers and excludes self", () => {
    let clock = 1000;
    const discovery = makeDiscovery(() => clock);
    feed(discovery, { instanceId: "alice", displayName: "Alice", port: 38886 }, "192.168.1.5");
    feed(discovery, { instanceId: "self", displayName: "Self", port: 38886 }, "192.168.1.9");

    const peers = discovery.listPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({
      instanceId: "alice",
      displayName: "Alice",
      address: "192.168.1.5",
      port: 38886,
    });
  });

  it("expires peers not heard from within the TTL", () => {
    let clock = 1000;
    const discovery = makeDiscovery(() => clock);
    feed(discovery, { instanceId: "bob", displayName: "Bob", port: 38886 }, "192.168.1.6");
    expect(discovery.listPeers()).toHaveLength(1);

    clock += 20_000; // beyond the 12s TTL
    expect(discovery.listPeers()).toHaveLength(0);
  });

  it("ignores malformed packets", () => {
    const discovery = makeDiscovery(() => 1000);
    (
      discovery as unknown as {
        handleMessage: (message: Buffer, address: string) => void;
      }
    ).handleMessage(Buffer.from("not json"), "192.168.1.7");
    (
      discovery as unknown as {
        handleMessage: (message: Buffer, address: string) => void;
      }
    ).handleMessage(
      Buffer.from(JSON.stringify({ marker: "wrong", instanceId: "x" })),
      "192.168.1.8",
    );
    expect(discovery.listPeers()).toHaveLength(0);
  });
});

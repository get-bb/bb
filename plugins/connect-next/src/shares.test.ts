import { describe, expect, it } from "vitest";
import { createSharesClient, watchServerShares } from "./shares.js";
import { FakeConnectShares } from "./testing/fake-connect.js";

const log = { debug() {}, info() {}, warn() {}, error() {} };

function client(connect: FakeConnectShares) {
  return createSharesClient(
    () =>
      ({
        plugins: { callRpc: connect.callRpc },
      }) as never,
  );
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("watchServerShares", () => {
  it("follows connect's shares and treats a stopped connect plugin as no shares", async () => {
    const connect = new FakeConnectShares();
    connect.setPorts([5173]);
    const seen: number[][] = [];
    const controller = new AbortController();
    const done = watchServerShares(
      {
        shares: client(connect),
        log,
        onPorts: (ports) => seen.push(ports),
        retryMinMs: 10,
        retryMaxMs: 20,
      },
      controller.signal,
    );
    await until(() => seen.length === 1);
    expect(seen).toEqual([[5173]]);

    connect.setPorts([3000, 5173]);
    await until(() => seen.length === 2);
    expect(seen[1]).toEqual([3000, 5173]);

    connect.available = false;
    connect.setPorts([3000]);
    await until(() => seen.at(-1)?.length === 0);

    connect.available = true;
    await until(() => seen.at(-1)?.[0] === 3000);
    controller.abort();
    await done;
  });
});

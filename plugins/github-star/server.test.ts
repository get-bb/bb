import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.js";

function hostWithPrompts(count: number) {
  const calls: unknown[] = [];
  const host = createFakePluginHost({
    pluginId: "bb--github-star",
    sdk: {
      experimental_promptHistory: {
        list: async (input) => {
          calls.push(input);
          return {
            entries: Array.from({ length: count }, () => ({})),
            nextCursor: null,
          };
        },
      },
    },
  });
  return { calls, host };
}

describe("GitHub Star claim", () => {
  it("waits until more than five prompts were sent", async () => {
    const { calls, host } = hostWithPrompts(5);
    await plugin(host.bb);

    expect(await host.harness.callRpc("claim", null)).toEqual({
      outcome: "wait",
    });
    expect(calls).toEqual([{ limit: "6" }]);
    expect(await host.bb.storage.kv.get("asked")).toBeUndefined();
  });

  it("lets exactly one concurrent caller show the prompt, then is done", async () => {
    const { host } = hostWithPrompts(6);
    await plugin(host.bb);

    const outcomes = await Promise.all([
      host.harness.callRpc("claim", null),
      host.harness.callRpc("claim", null),
    ]);
    expect(outcomes).toEqual([{ outcome: "show" }, { outcome: "done" }]);
    expect(await host.harness.callRpc("claim", null)).toEqual({
      outcome: "done",
    });
  });

  it("never asks again once it has asked, even across restarts", async () => {
    const { calls, host } = hostWithPrompts(100);
    await host.bb.storage.kv.set("asked", true);
    await plugin(host.bb);

    expect(await host.harness.callRpc("claim", null)).toEqual({
      outcome: "done",
    });
    expect(calls).toEqual([]);
  });
});

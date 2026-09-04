import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { Account } from "./contracts.js";
import { AccountStore } from "./store.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function delayedAccountReads(kv: PluginKvStorage): PluginKvStorage {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const value = await kv.get<T>(key);
      if (key === "accounts:v1") {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return value;
    },
    set: (key, value) => kv.set(key, value),
    delete: (key) => kv.delete(key),
    list: (prefix) => kv.list(prefix),
  };
}

describe("AccountStore", () => {
  it("preserves both accounts added concurrently", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-account-store-"));
    const host = createFakePluginHost({ pluginId: "account-pool", dataDir });
    const secretsDir = path.join(dataDir, "secrets");
    const store = new AccountStore(
      delayedAccountReads(host.bb.storage.kv),
      secretsDir,
    );
    await store.initialize();
    cleanups.push(async () => {
      await host.harness.lifecycle.dispose();
      await fs.rm(dataDir, { recursive: true, force: true });
    });
    const account = (label: string): Omit<Account, "id" | "createdAt"> => ({
      provider: "claude",
      kind: "api-key",
      label,
      email: null,
      subscriptionType: null,
      rateLimitTier: null,
      enabled: true,
      priority: 100,
    });

    const [first, second] = await Promise.all([
      store.add(account("first"), { kind: "api-key", apiKey: "sk-first" }),
      store.add(account("second"), { kind: "api-key", apiKey: "sk-second" }),
    ]);

    expect((await store.list()).map((entry) => entry.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });
});

import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, migrate, hosts } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMachineAuthService } from "../machine-auth.js";
import { createMachineEnrollmentService } from "./enrollments.js";
import { setPluginMachineProviderBridge } from "../plugins/plugin-machine-provider-registry.js";
import { validatePluginMachineProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
  setPluginMachineProviderBridge(undefined);
});

async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-enrollments-test-"));
  const db = createConnection(":memory:");
  migrate(db);
  cleanup.push(async () => {
    db.$client.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const machineAuth = await createMachineAuthService({
    db,
    dataDir,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const serverAccess = {
    resolve: vi.fn(
      async (_request: {
        key: string;
        hostId: string;
        signal: AbortSignal;
      }) => ({
        id: "grant",
        serverUrl: "https://server.example",
      }),
    ),
  };
  const connected = new Set<string>();
  const deps = {
    dataDir,
    db,
    machineAuth,
    serverAccess,
    isConnected: (id: string) => connected.has(id),
  };
  const create = () => createMachineEnrollmentService(deps);
  const service = create();
  const provider = validatePluginMachineProviderDeclaration({
    id: "test-machine",
    displayName: "Test machine",
    description: "Test machine",
    icon: "Terminal",
    create: async () => ({ status: "failed", message: "unused" }),
    reconcileCleanup: async () => ({ status: "removed" }),
    remove: async () => ({ status: "removed" }),
  });
  setPluginMachineProviderBridge({
    listMachineProviders: () => [{ pluginId: "plugin-a", provider }],
    getMachineProvider: (id) =>
      id === provider.id ? { pluginId: "plugin-a", provider } : undefined,
    invokeProvider: async (_pluginId, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 1_000,
  });
  const seed = (key: string) => {
    const now = Date.now();
    db.insert(hosts)
      .values({
        id: `host_${key}`,
        name: "Test machine",
        type: "persistent",
        machineProviderId: provider.id,
        launchKey: key,
        attempt: 1,
        phase: "creating",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  };
  return {
    ...deps,
    connected,
    create,
    service,
    api: service.forOwner("plugin-a"),
    other: service.forOwner("plugin-b"),
    seed,
  };
}

describe("machine enrollments", () => {
  it("serializes same-key prepares and reissues credentials for the same durable identity", async () => {
    const h = await harness();
    h.seed("create");
    const [first, parallel] = await Promise.all([
      h.api.prepare({ signal: new AbortController().signal, key: "create" }),
      h.api.prepare({ signal: new AbortController().signal, key: "create" }),
    ]);
    expect(parallel.hostId).toBe(first.hostId);
    expect(h.serverAccess.resolve).toHaveBeenCalledTimes(2);
    const restarted = await h
      .create()
      .forOwner("plugin-a")
      .prepare({ signal: new AbortController().signal, key: "create" });
    expect(restarted.id).toBe(first.id);
    expect(restarted.hostId).toBe(first.hostId);
    expect(first.state).toBe("pending");
    if (first.state !== "pending" || restarted.state !== "pending")
      throw new Error("Expected pending enrollment");
    expect(restarted.bootstrap.credential).not.toBe(first.bootstrap.credential);
    expect(parallel.state).toBe("pending");
    if (parallel.state !== "pending")
      throw new Error("Expected pending enrollment");
    expect(parallel.bootstrap.credential).not.toBe(first.bootstrap.credential);
    expect(JSON.stringify(h.db.select().from(hosts).all())).not.toContain(
      first.bootstrap.credential,
    );
  });

  it("rejects removed identities", async () => {
    const h = await harness();
    h.seed("removed");
    const prepared = await h.api.prepare({
      signal: new AbortController().signal,
      key: "removed",
    });
    if (prepared.state !== "pending") throw new Error("Expected enrollment");
    h.db
      .update(hosts)
      .set({ phase: "destroyed" })
      .where(eq(hosts.id, prepared.hostId))
      .run();
    await expect(
      h.api.prepare({ signal: new AbortController().signal, key: "removed" }),
    ).rejects.toThrow("cancelled");
  });

  it("recovers a lost exchange response with a fresh credential for the same identity", async () => {
    const h = await harness();
    h.seed("lost-response");
    const first = await h.api.prepare({
      signal: new AbortController().signal,
      key: "lost-response",
    });
    if (first.state !== "pending")
      throw new Error("Expected pending enrollment");
    const lostResponse = await h.machineAuth.enrollHost({
      token: first.bootstrap.credential,
      hostId: first.hostId,
    });
    expect(lostResponse).not.toBeNull();
    await h.machineAuth.issueHostEnrollKey({
      hostId: first.hostId,
      enrollSource: "public-multi-machine",
    });
    const retry = await h
      .create()
      .forOwner("plugin-a")
      .prepare({ signal: new AbortController().signal, key: "lost-response" });
    if (retry.state !== "pending")
      throw new Error("Expected recoverable pending enrollment");
    expect(retry.hostId).toBe(first.hostId);
    expect(retry.bootstrap.credential === first.bootstrap.credential).toBe(
      false,
    );
    const recovered = await h.machineAuth.enrollHost({
      token: retry.bootstrap.credential,
      hostId: retry.hostId,
    });
    if (!recovered || !lostResponse)
      throw new Error("Expected successful exchanges");
    expect(
      await h.machineAuth.verifyDaemonHostKey(recovered.hostKey),
    ).not.toBeNull();
    expect(
      await h.machineAuth.verifyDaemonHostKey(lostResponse.hostKey),
    ).toBeNull();
    const beforeStart = await h.api.prepare({
      signal: new AbortController().signal,
      key: "lost-response",
    });
    expect(beforeStart.state).toBe("pending");
    expect(
      await h.machineAuth.verifyDaemonHostKey(recovered.hostKey),
    ).not.toBeNull();
    h.db
      .update(hosts)
      .set({ lastSeenAt: Date.now() })
      .where(eq(hosts.id, first.hostId))
      .run();
    expect(
      await h.create().forOwner("plugin-a").prepare({
        signal: new AbortController().signal,
        key: "lost-response",
      }),
    ).toEqual({
      id: first.id,
      hostId: first.hostId,
      state: "enrolled",
    });
  });

  it("recovers access failures with the same durable host identity", async () => {
    const h = await harness();
    h.seed("create");
    h.serverAccess.resolve.mockRejectedValueOnce(
      new Error("temporarily unavailable"),
    );
    await expect(
      h.api.prepare({ signal: new AbortController().signal, key: "create" }),
    ).rejects.toThrow("temporarily unavailable");
    const retry = await h.api.prepare({
      signal: new AbortController().signal,
      key: "create",
    });
    expect(retry.hostId).toBe("host_create");
  });
});

it("propagates cancellation to acquisition and never publishes a late enrollment command", async () => {
  const h = await harness();
  h.seed("cancel");
  const controller = new AbortController();
  let finish: () => void = () => {};
  let acquisitionSignal: AbortSignal | undefined;
  h.serverAccess.resolve.mockImplementation(async ({ signal }) => {
    acquisitionSignal = signal;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { id: "late-grant", serverUrl: "https://server.example" };
  });
  const pending = h.api.prepare({ key: "cancel", signal: controller.signal });
  await vi.waitFor(() => expect(acquisitionSignal).toBeDefined());
  controller.abort(new Error("cancelled"));
  expect(acquisitionSignal?.aborted).toBe(true);
  finish();
  await expect(pending).rejects.toThrow("cancelled");
  expect(
    await h.service.pendingBootstrapForHost({
      hostId: "host_cancel",
      owner: "plugin-a",
    }),
  ).toBeNull();
});

import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createCatalogueService } from "./service.js";
import { registerCatalogueCli } from "./cli.js";
import { hash } from "./model.js";
import type { ImageBackend } from "./backend.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});
async function fixture() {
  const project = {
    id: "project",
    kind: "standard" as const,
    name: "fixture",
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const host = createFakePluginHost({
    pluginId: "environment-modal-sandbox",
    sdk: {
      projects: { get: async () => project, list: async () => [project] },
    },
  });
  disposals.push(() => host.harness.lifecycle.dispose());
  const backend: ImageBackend = {
    accountIdentity: async () => hash("account"),
    build: vi.fn(async (_request, hooks) => {
      hooks.allocated("im-fixture");
      hooks.log("token=secret private-value");
      return "im-fixture";
    }),
    reconcile: vi.fn(async () => null),
    resolve: vi.fn(async (id) => id),
    delete: vi.fn(async () => {}),
  };
  const service = createCatalogueService(
    host.bb,
    async () => ({
      tokenId: "token-id",
      tokenSecret: "private-value",
      appName: "test-app",
      environmentVariables: {},
      timeoutMs: 60000,
      idleMs: 60000,
      cpu: 1,
      memoryMiB: 4096,
    }),
    () => backend,
    Date.now,
    async () => ({
      metadata: {
        sha256: hash("fixture"),
        version: "test",
        protocolVersion: 1,
      },
      data: Buffer.from("fixture"),
    }),
  );
  registerCatalogueCli(host.bb, service);
  const recipe = await service.handlers["recipe.put"]({
    projectId: project.id,
    expectedRevision: 0,
    dockerfileText: "RUN true",
    setupScriptText: "",
    contextRules: { include: [], exclude: [] },
    smoke: { commands: [], timeoutSeconds: 120 },
  });
  const context = service.store.putContext(project.id, {
    recipeId: recipe.recipeId,
    revision: 1,
    source: {
      hostId: "local",
      path: "/fixture",
      commit: "a".repeat(40),
      dirty: [],
      submodules: [],
      lfs: [],
    },
    reviewedDirty: [],
    files: [],
  });
  service.store.completeContext(context.contextId);
  const input = {
    projectId: project.id,
    recipeId: recipe.recipeId,
    revision: 1,
    contextId: context.contextId,
    key: "request",
  };
  return { ...host, service, backend, input, recipe };
}
it("uses the same CLI/RPC handlers and keeps a shared build alive after a follower disconnects", async () => {
  const test = await fixture();
  let finish: (imageId: string) => void = () => {};
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  test.backend.build = vi.fn(async (_request, hooks) => {
    hooks.allocated("im-shared");
    hooks.log("Downloading dependencies");
    return pending;
  });
  const first = await test.service.handlers["build.start"](test.input);
  const cli = await test.harness.behavior.runCli([
    "image",
    "build",
    "--project",
    "fixture",
    "--recipe",
    test.input.recipeId,
    "--revision",
    "1",
    "--context",
    test.input.contextId,
    "--key",
    "second",
    "--json",
  ]);
  expect(JSON.parse(cli.stdout)).toEqual({ ...first, reused: true });
  const running = test.service.sweep();
  await vi.waitFor(() => expect(test.backend.build).toHaveBeenCalledTimes(1));
  const controller = new AbortController();
  const logs = await test.harness.behavior.runCli(
    ["image", "logs", first.buildId, "--follow", "--json"],
    { signal: controller.signal },
  );
  expect(logs.experimental_continue?.argv).toContain(first.buildId);
  controller.abort();
  expect(test.service.store.build(first.buildId)).toMatchObject({
    state: "building",
    cancelRequested: false,
  });
  finish("im-shared");
  await running;
  expect(
    await test.harness.behavior.callRpc("build.get", {
      buildId: first.buildId,
    }),
  ).toMatchObject({ state: "ready", imageId: "im-shared" });
  expect(test.backend.build).toHaveBeenCalledTimes(1);
});
it("reports missing vendor images and permits an explicit retry with a new key", async () => {
  const test = await fixture();
  const first = await test.service.handlers["build.start"](test.input);
  await test.service.sweep();
  test.backend.resolve = async () => null;
  await expect(
    test.service.handlers["build.start"]({ ...test.input, key: "check" }),
  ).rejects.toThrow(/image is missing/);
  expect(test.service.store.build(first.buildId).state).toBe("failed");
  const retried = await test.service.handlers["build.start"]({
    ...test.input,
    key: "explicit-retry",
  });
  expect(retried.state).toBe("queued");
});
it("reconciles deterministic names after transient errors instead of silently submitting again", async () => {
  const test = await fixture();
  test.backend.build = vi.fn(async () => {
    throw new Error("UNAVAILABLE: socket disconnected");
  });
  const first = await test.service.handlers["build.start"](test.input);
  await test.service.sweep();
  expect(test.service.store.build(first.buildId).state).toBe("reconciling");
  await test.service.sweep();
  expect(test.backend.build).toHaveBeenCalledTimes(1);
  test.backend.reconcile = vi.fn(async () => "im-reconciled");
  await test.service.sweep();
  expect(test.service.store.build(first.buildId)).toMatchObject({
    state: "ready",
    imageId: "im-reconciled",
  });
  expect(test.backend.reconcile).toHaveBeenCalledWith(
    test.service.store.build(first.buildId).name,
  );
});
it("returns structured CAS conflict errors through the real RPC boundary", async () => {
  const test = await fixture();
  await expect(
    test.harness.behavior.callRpc("recipe.put", {
      projectId: "project",
      expectedRevision: 0,
      dockerfileText: "RUN changed",
    }),
  ).rejects.toMatchObject({
    code: "conflict",
    message: expect.stringContaining("latest revision 1"),
  });
});
it("fences a late worker result after restart and reconciliation", async () => {
  const test = await fixture();
  let finish: (id: string) => void = () => {};
  test.backend.build = async () =>
    new Promise<string>((resolve) => {
      finish = resolve;
    });
  const first = await test.service.handlers["build.start"](test.input);
  const running = test.service.sweep();
  await vi.waitFor(() =>
    expect(test.service.store.build(first.buildId).state).toBe("building"),
  );
  test.service.store.restart();
  test.backend.reconcile = async () => "im-reconciled";
  await test.service.sweep();
  finish("im-late-worker");
  await running;
  expect(test.service.store.build(first.buildId)).toMatchObject({
    state: "ready",
    imageId: "im-reconciled",
  });
});
it("redacts credentials split across vendor log chunks", async () => {
  const test = await fixture();
  test.backend.build = async (_request, hooks) => {
    hooks.log("private-");
    hooks.log("value\n");
    return "im-safe";
  };
  const first = await test.service.handlers["build.start"](test.input);
  await test.service.sweep();
  const page = test.service.store.events(first.buildId, 0, 200);
  expect(JSON.stringify(page)).not.toContain("private-");
  expect(JSON.stringify(page)).not.toContain("value");
  expect(JSON.stringify(page)).toContain("[REDACTED]");
});

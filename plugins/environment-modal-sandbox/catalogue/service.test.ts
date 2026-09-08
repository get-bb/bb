import { acceptChunk, contextFiles } from "./context.js";
import { afterEach, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { createCatalogueService } from "./service.js";
import { registerCatalogueCli } from "./cli.js";
import { hash } from "./model.js";
import { createVerificationService } from "./verification.js";
import type { ImageBackend } from "./backend.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});
async function fixture(now = Date.now) {
  const project = {
    id: "project",
    kind: "standard" as const,
    name: "fixture",
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [],
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
    now,
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
    contextRules: { include: [], exclude: [] },
    smoke: { commands: ["node --version"], timeoutSeconds: 120 },
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

it("rejects failed smoke and incomplete proof, then promotes the selected agent with CAS", async () => {
  const test = await fixture();
  const build = await test.service.handlers["build.start"](test.input);
  await test.service.sweep();
  const job = await test.service.verifications.start({
    buildId: build.buildId,
    agentProviderId: "codex",
    key: "verify",
  });
  expect(
    await test.service.verifications.start({
      buildId: build.buildId,
      agentProviderId: "codex",
      key: "verify",
    }),
  ).toEqual(job);
  await expect(
    test.service.verifications.start({
      buildId: build.buildId,
      agentProviderId: "claude-code",
      key: "verify",
    }),
  ).rejects.toThrow(/different payload/);
  const verifiedCli = await test.harness.behavior.runCli([
    "image",
    "verify",
    build.buildId,
    "--provider",
    "codex",
    "--key",
    "verify",
    "--json",
  ]);
  expect(verifiedCli.exitCode).toBe(0);
  expect(JSON.parse(verifiedCli.stdout)).toEqual(job);
  const use = {
    projectId: "project",
    buildId: build.buildId,
    agentProviderId: "codex",
    expectedRevision: 0,
  };
  const save = (
    state: "failed" | "passed",
    exitCode: number,
    completedTurnSeq: number | null,
  ) => {
    const data = {
      ...job,
      restored: true,
      state,
      hostId: "machine",
      environmentId: "checkout",
      threadId: "smoke-thread",
      completedTurnSeq,
      checks: [{ command: "node --version", exitCode }],
    };
    test.service.store.db
      .prepare("UPDATE verifications SET state=?,data=? WHERE id=?")
      .run(state, JSON.stringify(data), job.verificationId);
  };
  save("failed", 1, 42);
  expect(() => test.service.verifications.promote(use)).toThrow(
    /successful verification/,
  );
  save("passed", 1, 42);
  expect(() => test.service.verifications.promote(use)).toThrow(
    /independent command/,
  );
  save("passed", 0, null);
  expect(() => test.service.verifications.promote(use)).toThrow(/agent/);
  save("passed", 0, 42);
  expect(() =>
    test.service.verifications.promote({
      ...use,
      agentProviderId: "claude-code",
    }),
  ).toThrow(/successful verification/);
  expect(test.service.verifications.promote(use)).toMatchObject({
    usableBuildId: build.buildId,
    available: true,
    revision: 1,
  });
  expect(() => test.service.verifications.promote(use)).toThrow(/revision/);
  expect(test.service.store.protected(build.buildId)).toBe(true);
  const project = test.service.store.project("project");
  expect(() =>
    test.service.store.configure({
      ...project,
      usableBuildId: null,
      expectedRevision: 0,
    }),
  ).toThrow(/revision/);
  expect(test.service.store.project("project").usableBuildId).toBe(
    build.buildId,
  );
  expect(
    test.service.store.configure({
      ...project,
      usableBuildId: null,
      expectedRevision: 1,
    }).usableBuildId,
  ).toBeNull();
});

it("keeps failed allocation reconcilable and retains the machine when preparation blocks", async () => {
  const test = await fixture();
  const build = await test.service.handlers["build.start"](test.input);
  await test.service.sweep();
  test.harness.sdk.stub("system.providerStates", async () => ({
    providers: [
      {
        providerId: "codex",
        displayName: "Codex",
        status: "ready",
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
        installedVersion: "1.0.0",
        minimumSupportedVersion: "1.0.0",
        canInstall: true,
        canUpdate: false,
        loginCommand: null,
      },
    ],
  }));
  const submit = vi.fn<typeof test.bb.sdk.hosts.submit>().mockResolvedValue({
    id: "launch",
    phase: "failed",
    hostId: null,
    step: "bootstrap",
    log: "",
    message: "Retryable transport failure",
    cancelPending: false,
    terminal: true,
  });
  test.harness.sdk.stub("hosts.submit", submit);
  const job = await test.service.verifications.start({
    buildId: build.buildId,
    agentProviderId: "codex",
    key: "durable",
  });
  await test.service.verifications.sweep();
  expect(test.service.verifications.get(job.verificationId)).toMatchObject({
    state: "allocating",
  });
  expect(test.service.store.protected(build.buildId)).toBe(true);
  submit.mockResolvedValue({
    id: "launch",
    phase: "ready",
    hostId: "machine",
    step: "ready",
    log: "",
    message: null,
    cancelPending: false,
    terminal: true,
  });
  test.harness.sdk.stub("projects.sources.add", async () => {
    throw new Error("Repository access denied");
  });
  await test.service.verifications.sweep();
  expect(test.service.verifications.get(job.verificationId)).toMatchObject({
    state: "failed",
    hostId: "machine",
    threadId: null,
    failure: expect.stringContaining("preparing"),
  });
  expect(submit.mock.calls.map(([input]) => input.key)).toEqual([
    `modal-${job.verificationId}`,
    `modal-${job.verificationId}`,
  ]);
});

it("reconciles a failed smoke turn after restart and refuses promotion", async () => {
  const test = await fixture();
  const build = await test.service.handlers["build.start"](test.input);
  await test.service.sweep();
  const job = await test.service.verifications.start({
    buildId: build.buildId,
    agentProviderId: "codex",
    key: "failed-turn",
  });
  test.service.store.db
    .prepare("UPDATE verifications SET state=?,data=? WHERE id=?")
    .run(
      "running",
      JSON.stringify({
        ...job,
        state: "running",
        hostId: "machine",
        threadId: "smoke-thread",
      }),
      job.verificationId,
    );
  test.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({
      id: "smoke-thread",
      projectId: "project",
      environmentId: "checkout",
      status: "error",
    }),
  );
  test.harness.sdk.stub("threads.events.list", async () => []);
  const restarted = createVerificationService(test.bb, test.service.store);
  await restarted.sweep();
  expect(restarted.get(job.verificationId)).toMatchObject({
    state: "failed",
    hostId: "machine",
    threadId: "smoke-thread",
    environmentId: "checkout",
    completedTurnSeq: null,
    failure: "Smoke thread failed before a completed agent turn",
  });
  expect(() =>
    restarted.promote({
      projectId: "project",
      buildId: build.buildId,
      agentProviderId: "codex",
      expectedRevision: 0,
    }),
  ).toThrow(/successful verification/);
});

it("preflights the selected agent without allocation and never returns account secrets", async () => {
  const test = await fixture();
  const account = await test.service.handlers["account.inspect"]({});
  expect(account).toMatchObject({ available: true, appName: "test-app" });
  expect(JSON.stringify(account)).not.toContain("private-value");
  const empty = await test.service.handlers["project.preflight"]({
    projectId: "project",
    agentProviderId: "codex",
    buildId: null,
  });
  expect(empty.ready).toBe(false);
  const build = await test.service.handlers["build.start"](test.input);
  await test.service.sweep();
  const unverified = await test.service.handlers["project.preflight"]({
    projectId: "project",
    agentProviderId: "claude-code",
    buildId: build.buildId,
  });
  expect(unverified).toMatchObject({ ready: false, build: null });
  expect(unverified.message).toContain("successful verification");
  test.backend.accountIdentity = async () => {
    throw new Error("private-value");
  };
  const failed = await test.service.handlers["account.inspect"]({});
  expect(failed.available).toBe(false);
  expect(JSON.stringify(failed)).not.toContain("private-value");
});

it("retries identical build content using the newly uploaded context after expired chunks are collected", async () => {
  let now = 1000;
  const test = await fixture(() => now);
  const recipe = await test.service.handlers["recipe.put"]({
    projectId: "project",
    expectedRevision: 1,
    dockerfileText: "COPY package-lock.json /tmp/package-lock.json",
    contextRules: { include: ["package-lock.json"], exclude: [] },
    smoke: { commands: ["true"], timeoutSeconds: 120 },
  });
  const manifest = {
    recipeId: recipe.recipeId,
    revision: recipe.revision,
    source: {
      hostId: "local",
      path: "/fixture",
      commit: "a".repeat(40),
      dirty: [],
      submodules: [],
      lfs: [],
    },
    reviewedDirty: [],
    files: [
      {
        path: "package-lock.json",
        bytes: 2,
        sha256: hash("{}"),
        mode: "100644" as const,
      },
    ],
  };
  const upload = () => {
    const context = test.service.store.putContext("project", manifest);
    test.service.store.db
      .prepare("INSERT INTO context_uploads VALUES (?,?,?)")
      .run(context.contextId, hash("fixture-token"), "local");
    acceptChunk(test.service.store, "fixture-token", {
      contextId: context.contextId,
      path: "package-lock.json",
      offset: 0,
      data: "e30=",
    });
    test.service.store.completeContext(context.contextId);
    return context;
  };
  const old = upload();
  vi.mocked(test.backend.build).mockRejectedValueOnce(
    new Error("Build syntax failure"),
  );
  const input = {
    ...test.input,
    revision: recipe.revision,
    contextId: old.contextId,
  };
  const first = await test.service.handlers["build.start"](input);
  await test.service.sweep();
  expect(test.service.store.build(first.buildId).state).toBe("failed");
  now += 86400001;
  await test.service.sweep();
  expect(() => contextFiles(test.service.store, old.contextId)).toThrow(
    "Archive hash/size mismatch",
  );
  const fresh = upload();
  const retry = await test.service.handlers["build.start"]({
    ...input,
    key: "retry-fresh-context",
    contextId: fresh.contextId,
  });
  expect(retry.buildId).toBe(first.buildId);
  expect(test.service.store.build(retry.buildId).contextId).toBe(
    fresh.contextId,
  );
  expect(contextFiles(test.service.store, fresh.contextId).size).toBe(1);
  await test.service.sweep();
  expect(test.service.store.build(retry.buildId).state).toBe("ready");
});

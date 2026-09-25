import { createProjectSource, getThread, getThreadStartupContext, upsertHost } from "@bb/db";
import type { GitSourceInspection } from "@bb/domain";
import type { PluginHookName } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { resolveSystemProviderModels } from "../../src/services/system/execution-options.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { choosePreStartHost } from "../../src/services/threads/thread-pre-start-placement.js";
import { invokePluginInline, setPluginHookProvider, type PluginHookRegistration } from "../../src/services/plugins/plugin-hook-registry.js";
import { persistedThreadProvisionContextSchema } from "../../src/services/threads/thread-startup-store.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { installFakeGitWorktreeProvider } from "../helpers/environment-provider.js";
import { textInput } from "../helpers/prompt-input.js";
import { seedHost, seedHostSession, seedPrimaryHost, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

type HookRegistry = { [K in PluginHookName]: PluginHookRegistration<K>[] };

const UNBORN_SOURCE: GitSourceInspection = {
  checkout: { kind: "unborn", branchName: "main" },
  defaultBranch: null,
  defaultBranchRelation: null,
  isWorktree: false,
  hasUncommittedChanges: false,
  operation: { kind: "none" },
  originDefaultBranch: null,
};

function installPlacement(handler: PluginHookRegistration<"experimental_thread.place">["handler"], timeoutMs = 10_000) {
  const hooks: HookRegistry = {
    "message.dispatch": [],
    "experimental_thread.place": [{ pluginId: "placement", handler }],
  };
  setPluginHookProvider({
    listHooks: (hook) => hooks[hook],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: timeoutMs,
  });
}

afterEach(() => setPluginHookProvider(undefined));

describe("pre-start machine placement", () => {
  it("chooses a ready remote source before inspecting and provisioning a project default", async () => {
    await withTestHarness(async (harness) => {
      const { host: server } = seedHostSession(harness.deps, { id: "server" });
      seedPrimaryHost(harness.deps, server.id);
      const { host: worker, session } = seedHostSession(harness.deps, { id: "worker" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: worker.id,
        path: "/tmp/remote-only-source",
      });
      const rpc = registerHostRpcResponder(harness, {
        hostId: worker.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "provider.list_models") {
            return { ok: true, result: { models: [availableModelFixture({ model: "gpt-5.1-codex", isDefault: true })], selectedOnlyModels: [] } };
          }
          expect(request.command.type).toBe("host.inspect_git_source");
          return { ok: true, result: UNBORN_SOURCE };
        },
      });
      const handler = vi.fn(() => ({ kind: "choose" as const, hostId: worker.id, requestedAt: Date.now() }));
      installPlacement(handler);
      const thread = await createThreadFromRequest(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5.1-codex",
        reasoningLevel: "high",
        environment: { type: "project-default" },
        input: textInput("Build this"),
        origin: "cli",
        startedOnBehalfOf: null,
      });
      const startup = persistedThreadProvisionContextSchema.parse(JSON.parse(getThreadStartupContext(harness.db, thread.id) ?? "null"));
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ projectId: project.id, providerId: "codex" }));
      expect(rpc.requests.map((request) => request.command.type)).toEqual([
        "host.inspect_git_source",
        "provider.list_models",
      ]);
      expect(startup?.request.environmentIntent).toMatchObject({
        type: "provider",
        machine: { type: "existing", hostId: worker.id },
      });
      expect(getThread(harness.db, thread.id)).toMatchObject({ providerId: "codex" });
      expect(startup?.request.execution).toMatchObject({ model: "gpt-5.1-codex", reasoningLevel: "high" });
      const savedThread = getThread(harness.db, thread.id);
      expect(savedThread).not.toBeNull();
      await acceptThreadSendRequest(harness.deps, {
        thread: savedThread!,
        payload: { input: textInput("Follow up"), mode: "auto" },
      });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  it("uses the chosen machine's model catalog for a remembered UI model and checks explicit models there", async () => {
    await withTestHarness(async (harness) => {
      const { host: server, session: serverSession } = seedHostSession(harness.deps, { id: "server-model" });
      seedPrimaryHost(harness.deps, server.id);
      const { host: worker, session: workerSession } = seedHostSession(harness.deps, { id: "worker-model" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: worker.id, path: "/tmp/worker-model-source" });
      const serverModel = availableModelFixture({ model: "server-only", isDefault: true });
      const workerModel = availableModelFixture({ model: "worker-only", isDefault: true });
      const serverRpc = registerHostRpcResponder(harness, {
        hostId: server.id,
        sessionId: serverSession.id,
        handle: (request) => {
          expect(request.command.type).toBe("provider.list_models");
          return { ok: true, result: { models: [serverModel], selectedOnlyModels: [] } };
        },
      });
      const workerRpc = registerHostRpcResponder(harness, {
        hostId: worker.id,
        sessionId: workerSession.id,
        handle: (request) => request.command.type === "provider.list_models"
          ? { ok: true, result: { models: [workerModel], selectedOnlyModels: [] } }
          : { ok: true, result: UNBORN_SOURCE },
      });
      expect((await resolveSystemProviderModels(harness.deps, { hostId: server.id, providerId: "codex" })).models.map((model) => model.model)).toContain("server-only");
      installPlacement(() => ({ kind: "choose", hostId: worker.id, requestedAt: Date.now() }));
      const environment = { type: "provider" as const, environmentProviderId: "project-checkout", inputs: {} };
      const request = {
        projectId: project.id,
        providerId: "codex",
        model: "server-only",
        reasoningLevel: "high" as const,
        environment,
        input: textInput("Build this"),
        origin: "app" as const,
        startedOnBehalfOf: null,
      };
      const thread = await createThreadFromRequest(harness.deps, {
        ...request,
        executionInputSources: { providerId: "explicit", model: "client-preference", reasoningLevel: "explicit" },
      });
      const startup = persistedThreadProvisionContextSchema.parse(JSON.parse(getThreadStartupContext(harness.db, thread.id) ?? "null"));
      expect(startup.request.environmentIntent).toMatchObject({ machine: { type: "existing", hostId: worker.id } });
      expect(startup.request.execution).toMatchObject({ model: "worker-only", reasoningLevel: "high" });
      await expect(createThreadFromRequest(harness.deps, {
        ...request,
        executionInputSources: { providerId: "explicit", model: "explicit" },
      })).rejects.toMatchObject({ body: { code: "model_unavailable" } });
      expect(serverRpc.requests.map((entry) => entry.command.type)).toEqual(["provider.list_models"]);
      expect(workerRpc.requests.some((entry) => entry.command.type === "provider.list_models")).toBe(true);
    });
  });

  it.each(["absent", "failed", "no-candidate"] as const)("does not select an unready remote source when placement is %s", async (hook) => {
    await withTestHarness(async (harness) => {
      const { host: server } = seedHostSession(harness.deps, { id: "server-fallback" });
      seedPrimaryHost(harness.deps, server.id);
      const { host: worker, session } = seedHostSession(harness.deps, { id: "worker-fallback" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: worker.id, path: "/tmp/remote-fallback-source" });
      const rpc = registerHostRpcResponder(harness, {
        hostId: worker.id,
        sessionId: session.id,
        handle: (request) => request.command.type === "provider.list_models"
          ? { ok: true, result: { models: [availableModelFixture({ model: "worker-only", isDefault: true })], selectedOnlyModels: [] } }
          : { ok: true, result: UNBORN_SOURCE },
      });
      if (hook === "failed") installPlacement(() => { throw new Error("placement failed"); });
      if (hook === "no-candidate") installPlacement(() => ({ kind: "default", reason: "Provider readiness is unknown" }));
      await expect(createThreadFromRequest(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        environment: { type: "project-default" },
        input: textInput("Build this"),
        origin: "cli",
        startedOnBehalfOf: null,
      })).rejects.toMatchObject({ body: { code: "invalid_request", message: "Project has no local-path source for host" } });
      expect(rpc.requests).toEqual([]);
    });
  });

  it("keeps the selected provider when its model catalog is unavailable", async () => {
    await withTestHarness(async (harness) => {
      const { host: server } = seedHostSession(harness.deps, { id: "server-selected-provider" });
      seedPrimaryHost(harness.deps, server.id);
      const { host: worker, session } = seedHostSession(harness.deps, { id: "worker-selected-provider" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: worker.id });
      const rpc = registerHostRpcResponder(harness, {
        hostId: worker.id,
        sessionId: session.id,
        handle: (request) => request.command.type === "provider.list_models"
          ? { ok: true, result: { models: request.command.providerId === "claude-code" ? [availableModelFixture({ model: "other-provider", isDefault: true })] : [], selectedOnlyModels: [] } }
          : { ok: true, result: UNBORN_SOURCE },
      });
      const handler = vi.fn(() => ({ kind: "choose" as const, hostId: worker.id, requestedAt: Date.now() }));
      installPlacement(handler);
      await expect(createThreadFromRequest(harness.deps, {
        projectId: project.id,
        environment: { type: "project-default" },
        input: textInput("Build this"),
        origin: "cli",
        startedOnBehalfOf: null,
      })).rejects.toMatchObject({ body: { code: "model_catalog_unavailable" } });
      expect(handler).toHaveBeenCalledOnce();
      expect(rpc.requests.flatMap((request) => request.command.type === "provider.list_models"
        ? [request.command.providerId]
        : [])).toEqual(["codex"]);
    });
  });

  it("keeps catalog provider fallback on the ordinary server default", async () => {
    await withTestHarness(async (harness) => {
      const { host: server, session } = seedHostSession(harness.deps, { id: "server-provider-fallback" });
      seedPrimaryHost(harness.deps, server.id);
      const { project } = seedProjectWithSource(harness.deps, { hostId: server.id });
      const rpc = registerHostRpcResponder(harness, {
        hostId: server.id,
        sessionId: session.id,
        handle: (request) => request.command.type === "provider.list_models"
          ? { ok: true, result: { models: request.command.providerId === "claude-code" ? [availableModelFixture({ model: "fallback-provider", isDefault: true })] : [], selectedOnlyModels: [] } }
          : { ok: true, result: UNBORN_SOURCE },
      });
      const thread = await createThreadFromRequest(harness.deps, {
        projectId: project.id,
        environment: { type: "project-default" },
        input: textInput("Build this"),
        origin: "cli",
        startedOnBehalfOf: null,
      });
      expect(getThread(harness.db, thread.id)?.providerId).toBe("claude-code");
      expect(rpc.requests.flatMap((request) => request.command.type === "provider.list_models"
        ? [request.command.providerId]
        : [])).toEqual(["codex", "claude-code"]);
    });
  });

  it("places the CLI worktree shape before source validation", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const { host: server } = seedHostSession(harness.deps, { id: "server-cli-worktree" });
      seedPrimaryHost(harness.deps, server.id);
      const { host: worker, session } = seedHostSession(harness.deps, { id: "worker-cli-worktree" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: worker.id, path: "/tmp/remote-cli-worktree" });
      const rpc = registerHostRpcResponder(harness, {
        hostId: worker.id,
        sessionId: session.id,
        handle: (request) => request.command.type === "provider.list_models"
          ? { ok: true, result: { models: [availableModelFixture({ model: "worker-only", isDefault: true })], selectedOnlyModels: [] } }
          : { ok: true, result: {
              checkout: { kind: "branch" as const, branchName: "feature", headSha: "abc123" },
              defaultBranch: "main",
              defaultBranchRelation: null,
              isWorktree: false,
              hasUncommittedChanges: false,
              operation: { kind: "none" as const },
              originDefaultBranch: null,
            } satisfies GitSourceInspection },
      });
      const handler = vi.fn(() => ({ kind: "choose" as const, hostId: worker.id, requestedAt: Date.now() }));
      installPlacement(handler);
      const thread = await createThreadFromRequest(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        environment: { type: "provider", environmentProviderId: "git-worktree", inputs: { branch: { kind: "default" } } },
        input: textInput("Build this"),
        origin: "cli",
        startedOnBehalfOf: null,
      });
      const startup = persistedThreadProvisionContextSchema.parse(JSON.parse(getThreadStartupContext(harness.db, thread.id) ?? "null"));
      expect(handler).toHaveBeenCalledOnce();
      expect(rpc.requests.some((request) => request.command.type === "host.inspect_git_source")).toBe(true);
      expect(startup.request.environmentIntent).toMatchObject({
        environmentProviderId: "git-worktree",
        machine: { type: "existing", hostId: worker.id },
        inputs: { branch: { kind: "default" } },
      });
    });
  });

  it("rejects stale, missing-source, and disconnected hook choices", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "candidate" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      for (const choice of [
        { hostId: host.id, requestedAt: Date.now() - 30_001 },
        { hostId: "missing", requestedAt: Date.now() },
      ]) {
        installPlacement(() => ({ kind: "choose", ...choice }));
        await expect(choosePreStartHost(harness.deps, { projectId: project.id, providerId: "codex" })).resolves.toBeNull();
      }
      installPlacement(() => ({ kind: "choose", hostId: host.id, requestedAt: Date.now() }));
      await expect(choosePreStartHost(harness.deps, { projectId: "different", providerId: "codex" })).resolves.toBeNull();
      const disconnected = seedHost(harness.deps, { id: "offline" });
      createProjectSource(harness.db, harness.hub, {
        projectId: project.id,
        type: "local_path",
        hostId: disconnected.id,
        path: "/tmp/offline-checkout",
      });
      installPlacement(() => ({ kind: "choose", hostId: disconnected.id, requestedAt: Date.now() }));
      await expect(choosePreStartHost(harness.deps, { projectId: project.id, providerId: "codex" })).resolves.toBeNull();
      installPlacement(() => ({ kind: "choose", hostId: host.id, requestedAt: Date.now() + 1_000 }));
      await expect(choosePreStartHost(harness.deps, { projectId: project.id, providerId: "codex" })).resolves.toBeNull();
      upsertHost(harness.db, harness.hub, { id: host.id, name: host.name, type: "ephemeral" });
      installPlacement(() => ({ kind: "choose", hostId: host.id, requestedAt: Date.now() }));
      await expect(choosePreStartHost(harness.deps, { projectId: project.id, providerId: "codex" })).resolves.toBeNull();
    });
  });

  it("keeps an explicitly selected machine and does not ask placement", async () => {
    await withTestHarness(async (harness) => {
      const { host: server, session: serverSession } = seedHostSession(harness.deps, { id: "server-explicit" });
      seedPrimaryHost(harness.deps, server.id);
      const { host, session } = seedHostSession(harness.deps, { id: "explicit" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      registerHostRpcResponder(harness, {
        hostId: server.id,
        sessionId: serverSession.id,
        handle: () => ({ ok: true, result: { models: [availableModelFixture({ model: "server-only", isDefault: true })], selectedOnlyModels: [] } }),
      });
      const remoteRpc = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => request.command.type === "provider.list_models"
          ? { ok: true, result: { models: [availableModelFixture({ model: "worker-only", isDefault: true })], selectedOnlyModels: [] } }
          : { ok: true, result: UNBORN_SOURCE },
      });
      expect((await resolveSystemProviderModels(harness.deps, { hostId: server.id, providerId: "codex" })).models.map((model) => model.model)).toContain("server-only");
      const handler = vi.fn(() => ({ kind: "default" as const, reason: "should not run" }));
      installPlacement(handler);
      const request = {
        projectId: project.id,
        providerId: "codex",
        model: "worker-only",
        environment: {
          type: "provider" as const,
          environmentProviderId: "project-checkout",
          machine: { type: "existing" as const, hostId: host.id },
          inputs: {},
        },
        input: textInput("Build this"),
        origin: "cli" as const,
        startedOnBehalfOf: null,
      };
      const thread = await createThreadFromRequest(harness.deps, request);
      const startup = persistedThreadProvisionContextSchema.parse(JSON.parse(getThreadStartupContext(harness.db, thread.id) ?? "null"));
      expect(handler).not.toHaveBeenCalled();
      expect(startup.request.environmentIntent).toMatchObject({
        machine: { type: "existing", hostId: host.id },
      });
      expect(startup.request.execution.model).toBe("worker-only");
      const rejected = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...request,
          origin: "sdk",
          model: "server-only",
        }),
      });
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ code: "model_unavailable" });
      expect(remoteRpc.requests.some((entry) => entry.command.type === "provider.list_models")).toBe(true);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it("uses the server default when a placement hook fails", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, { id: "server-fallback" });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => request.command.type === "provider.list_models"
          ? { ok: true, result: { models: [availableModelFixture({ model: "gpt-5.1-codex", isDefault: true })], selectedOnlyModels: [] } }
          : { ok: true, result: UNBORN_SOURCE },
      });
      const handler = vi.fn(() => { throw new Error("probe failed"); });
      installPlacement(handler);
      const thread = await createThreadFromRequest(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5.1-codex",
        environment: { type: "project-default" },
        input: textInput("Build this"),
        origin: "cli",
        startedOnBehalfOf: null,
      });
      const startup = persistedThreadProvisionContextSchema.parse(JSON.parse(getThreadStartupContext(harness.db, thread.id) ?? "null"));
      expect(handler).toHaveBeenCalledOnce();
      expect(startup.request.environmentIntent).toMatchObject({
        machine: { type: "existing", hostId: host.id },
      });
    });
  });

  it("aborts a timed-out placement and returns the normal default", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "candidate" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      let signal: AbortSignal | undefined;
      installPlacement(({ signal: received }) => {
        signal = received;
        return new Promise(() => {});
      }, 10);
      await expect(choosePreStartHost(harness.deps, { projectId: project.id, providerId: "codex" })).resolves.toBeNull();
      expect(signal?.aborted).toBe(true);
      expect(signal?.onabort).toBeNull();
    });
  });

  it.each(["chosen", "failed"] as const)("disposes the hook race on %s exit", async (outcome) => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "candidate" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      let signal: AbortSignal | undefined;
      installPlacement(({ signal: received }) => {
        signal = received;
        if (outcome === "failed") throw new Error("Plugin unloaded");
        return { kind: "choose", hostId: host.id, requestedAt: Date.now() };
      });
      await expect(choosePreStartHost(harness.deps, { projectId: project.id, providerId: "codex" }))
        .resolves.toBe(outcome === "chosen" ? host.id : null);
      expect(signal?.aborted).toBe(true);
      expect(signal?.onabort).toBeNull();
    });
  });

  it("previews placement over the route without starting a thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "preview-candidate" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const preview = async () => {
        const response = await harness.app.request(
          `/api/v1/threads/placement-preview?projectId=${project.id}&providerId=codex`,
        );
        expect(response.status).toBe(200);
        return response.json();
      };
      await expect(preview()).resolves.toEqual({ kind: "unavailable" });
      installPlacement(() => ({ kind: "choose", hostId: host.id, requestedAt: Date.now() }));
      await expect(preview()).resolves.toEqual({ kind: "host", hostId: host.id, hostName: host.name, skipped: [] });
      const skip = { hostId: host.id, reason: "Codex not signed in" };
      installPlacement(() => ({ kind: "default", reason: "No ready machine", skipped: [skip] }));
      await expect(preview()).resolves.toEqual({ kind: "default", skipped: [{ ...skip, hostName: host.name }] });
      installPlacement(() => ({ kind: "choose", hostId: host.id, requestedAt: Date.now() - 30_001 }));
      await expect(preview()).resolves.toEqual({ kind: "default", skipped: [] });
      const missing = await harness.app.request("/api/v1/threads/placement-preview?projectId=missing&providerId=codex");
      expect(missing.status).toBe(404);
    });
  });
});

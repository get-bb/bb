import {
  getAppSettings,
  getStoredProviderModelCatalog,
  setAppSettings,
  updateHost,
} from "@bb/db";
import type { JsonValue, ProviderFork } from "@bb/domain";
import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import {
  resolveSystemExecutionOptions,
  resolveSystemProviderModels,
} from "../../src/services/system/execution-options.js";
import { resolveBridgeLaunchForProviderId } from "../../src/services/system/provider-bridge-launch.js";
import { applyThreadExecutionOverride } from "../../src/services/threads/thread-execution-override.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import {
  captureLogLines,
  capturePushes,
  catalogAnswer,
  errorAnswer,
  healthAnswer,
  installCatalogStore,
  modelList,
  requireRegistration,
  settleTimers,
} from "../helpers/provider-model-catalogs.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const BASE_NOW = 1_800_000_000_000;
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const SETTLED = "Provider model catalog refresh settled";

type ListModelsCommand = Extract<
  HostDaemonOnlineRpcRequestMessage["command"],
  { type: "provider.list_models" }
>;

type ListModelsAnswer = (
  command: ListModelsCommand,
) => HostRpcHandlerResult | Promise<HostRpcHandlerResult>;

function setupCatalogHost(
  harness: TestAppHarness,
  args: { id: string; memoryEntryLimit?: number },
) {
  const clock = { now: BASE_NOW };
  const store = installCatalogStore(harness, {
    clock,
    memoryEntryLimit: args.memoryEntryLimit,
  });
  const { host, session } = seedHostSession(harness.deps, { id: args.id });
  let answer: ListModelsAnswer = (command) =>
    catalogAnswer(modelList(`${command.providerId}-model`));
  const connect = (sessionId: string) => {
    const responder = registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId,
      handle: (request) => {
        switch (request.command.type) {
          case "provider.health":
            return healthAnswer("not_installed");
          case "provider.list_models":
            return answer(request.command);
          case "provider.installation.run":
            return {
              ok: true,
              result: {
                events: [
                  {
                    type: "completed",
                    provider: request.command.providerId,
                    exitCode: 0,
                    signal: null,
                    success: true,
                  },
                ],
              },
            };
          default:
            throw new Error(`Unexpected RPC command ${request.command.type}`);
        }
      },
    });
    return (providerId?: string): ListModelsCommand[] =>
      responder.requests.flatMap((request) =>
        request.command.type === "provider.list_models" &&
        (providerId === undefined || request.command.providerId === providerId)
          ? [request.command]
          : [],
      );
  };
  return {
    clock,
    store,
    hostId: host.id,
    sessionId: session.id,
    connect,
    listRequests: connect(session.id),
    setAnswer(next: ListModelsAnswer) {
      answer = next;
    },
    read(providerId: string, environmentId?: string) {
      return resolveSystemExecutionOptions(
        harness.deps,
        environmentId === undefined
          ? { hostId: host.id, providerId }
          : { environmentId, providerId },
      );
    },
  };
}

function modelIds(response: { models: readonly { model: string }[] }) {
  return response.models.map((model) => model.model);
}

function fallbackModelIds(harness: TestAppHarness, providerId: string) {
  const ids = requireRegistration(harness, providerId).fallbackModels.map(
    (model) => model.model,
  );
  expect(ids.length).toBeGreaterThan(0);
  return ids;
}

function registerCatalogProbe(
  harness: TestAppHarness,
  args: {
    bridgeOptions?: Readonly<Record<string, JsonValue>>;
    fork?: ProviderFork;
  },
) {
  const base = requireRegistration(harness, "claude-code");
  return harness.deps.providerRegistry.register({
    ...base,
    info: { ...base.info, id: "catalog-probe" },
    bridgeOptions: args.bridgeOptions ?? base.bridgeOptions,
    serverCapabilities: {
      ...base.serverCapabilities,
      fork: args.fork ?? base.serverCapabilities.fork,
    },
  });
}

function seedEnvironmentPath(
  harness: TestAppHarness,
  hostId: string,
  path: string,
): string {
  const { project } = seedProjectWithSource(harness.deps, { hostId, path });
  return seedEnvironment(harness.deps, { hostId, projectId: project.id, path })
    .id;
}

describe("provider model catalog store", () => {
  it("keeps catalogs across a daemon reconnect, an unrelated registration and a capability-only re-registration", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, { id: "host-catalog-identity" });
      const probe = registerCatalogProbe(harness, {});
      const fork = resolveBridgeLaunchForProviderId(
        harness.deps,
        "catalog-probe",
      )?.capabilities.fork;
      await host.read("codex");
      await host.read("catalog-probe");

      harness.hub.unregisterDaemon(host.sessionId);
      const nextRequests = host.connect(
        seedSession(harness.deps, host.hostId).id,
      );
      const codex = requireRegistration(harness, "codex");
      harness.deps.providerRegistry.register({
        ...codex,
        pluginId: "unrelated-plugin",
        info: { ...codex.info, id: "unrelated-provider" },
      });
      probe.dispose();
      registerCatalogProbe(harness, { fork: fork === "none" ? "tip" : "none" });
      expect(
        resolveBridgeLaunchForProviderId(harness.deps, "catalog-probe")
          ?.capabilities.fork,
      ).not.toBe(fork);

      expect(modelIds(await host.read("codex"))).toEqual(["codex-model"]);
      expect(modelIds(await host.read("catalog-probe"))).toEqual([
        "catalog-probe-model",
      ]);
      expect(nextRequests()).toHaveLength(0);
    });
  });

  it("treats a fingerprint change as a missing catalog and never serves the old models", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, {
        id: "host-catalog-fingerprint",
      });
      await host.read("claude-code");
      const artifact = harness.deps.pluginHostArtifacts.get(
        "provider-claude-code",
      );
      if (artifact === undefined) {
        throw new Error("Missing claude-code artifact");
      }
      harness.deps.pluginHostArtifacts.set("provider-claude-code", {
        ...artifact,
        digest: "b".repeat(64),
      });
      host.setAnswer(() => errorAnswer("command_failed"));

      const response = await host.read("claude-code");
      expect(response.modelLoadError).toEqual({
        providerId: "claude-code",
        code: "failed",
      });
      expect(modelIds(response)).toEqual(
        fallbackModelIds(harness, "claude-code"),
      );
      expect(host.listRequests()).toHaveLength(2);
    });
  });

  it("serves a stale catalog at once with one background refresh and pushes only when the list changes", async () => {
    await withTestHarness(async (harness) => {
      const logLines = captureLogLines(harness);
      const host = setupCatalogHost(harness, { id: "host-catalog-stale" });
      await host.read("claude-code");
      await settleTimers();
      const pushes = capturePushes(harness);
      const held = createDeferredPromise<HostRpcHandlerResult>();

      host.clock.now += 10 * MINUTE;
      host.setAnswer(() => held.promise);
      const [first, second] = await Promise.all([
        host.read("claude-code"),
        host.read("claude-code"),
      ]);
      expect(modelIds(first)).toEqual(["claude-code-model"]);
      expect(modelIds(second)).toEqual(["claude-code-model"]);
      expect(host.listRequests()).toHaveLength(2);
      held.resolve(catalogAnswer(modelList("claude-next")));
      await vi.waitFor(async () => {
        expect(modelIds(await host.read("claude-code"))).toEqual([
          "claude-next",
        ]);
      });
      await settleTimers();
      expect(pushes).toEqual([host.hostId]);

      host.clock.now += 10 * MINUTE;
      host.setAnswer(() => catalogAnswer(modelList("claude-next")));
      await host.read("claude-code");
      await vi.waitFor(() => {
        expect(host.listRequests()).toHaveLength(3);
      });
      await settleTimers();
      expect(pushes).toEqual([host.hostId]);
      expect(
        logLines(SETTLED).map(({ level, outcome, changed }) => [
          level,
          outcome,
          changed,
        ]),
      ).toEqual([
        ["info", "success", true],
        ["info", "success", true],
        ["info", "success", false],
      ]);
      expect(logLines(SETTLED)[0]).toMatchObject({
        hostId: host.hostId,
        providerId: "claude-code",
        scope: "host",
        modelCount: 1,
        durationMs: expect.any(Number),
      });
    });
  });

  it.each([
    {
      label: "fails",
      answer: errorAnswer("command_failed"),
      level: "warn",
      outcome: "failed",
    },
    {
      label: "times out",
      answer: errorAnswer("command_timeout"),
      level: "warn",
      outcome: "timeout",
    },
    {
      label: "answers for another command type",
      answer: null,
      level: "error",
      outcome: "failed",
    },
  ])(
    "keeps serving the last good catalog when a refresh $label, without a push or a row rewrite",
    async ({ answer, level, outcome }) => {
      await withTestHarness(async (harness) => {
        const logLines = captureLogLines(harness);
        const host = setupCatalogHost(harness, {
          id: "host-catalog-last-good",
        });
        await host.read("claude-code");
        await settleTimers();
        const pushes = capturePushes(harness);
        const rowKey = {
          hostId: host.hostId,
          providerId: "claude-code",
          scopeKey: "",
        };
        const row = getStoredProviderModelCatalog(harness.db, rowKey);
        if (answer === null) {
          const request = harness.hub.requestHostOnlineRpc.bind(harness.hub);
          vi.spyOn(harness.hub, "requestHostOnlineRpc").mockImplementation(
            async (args) =>
              args.message.command.type === "provider.list_models"
                ? {
                    type: "host-rpc.response",
                    requestId: args.message.requestId,
                    commandType: "provider.installation.run",
                    ok: true,
                    result: { events: [] },
                  }
                : request(args),
          );
        } else {
          host.setAnswer(() => answer);
        }

        host.clock.now += 10 * MINUTE;
        await host.read("claude-code");
        await vi.waitFor(() => {
          expect(logLines(SETTLED)).toHaveLength(2);
        });
        await settleTimers();
        const response = await host.read("claude-code");
        expect(response.modelLoadError).toBeNull();
        expect(modelIds(response)).toEqual(["claude-code-model"]);
        expect(getStoredProviderModelCatalog(harness.db, rowKey)).toEqual(row);
        await settleTimers();
        expect(pushes).toEqual([]);
        expect(logLines(SETTLED)).toHaveLength(2);
        expect(logLines(SETTLED)[1]).toMatchObject({
          level,
          outcome,
          changed: false,
        });
      });
    },
  );

  it("answers recorded failures without waiting for 30 seconds, then waits once for auth_required and refreshes a timeout in the background", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, {
        id: "host-catalog-negative-cache",
      });
      const held = createDeferredPromise<HostRpcHandlerResult>();
      let codexAnswer = () => errorAnswer("auth_required");
      let claudeAnswer = ():
        | HostRpcHandlerResult
        | Promise<HostRpcHandlerResult> => errorAnswer("command_timeout");
      host.setAnswer((command) =>
        command.providerId === "codex" ? codexAnswer() : claudeAnswer(),
      );
      const readError = async (providerId: string) =>
        (await host.read(providerId)).modelLoadError?.code;

      expect(await readError("codex")).toBe("auth_required");
      expect(await readError("claude-code")).toBe("timeout");
      host.clock.now += 29 * SECOND;
      expect(await readError("codex")).toBe("auth_required");
      expect(await readError("claude-code")).toBe("timeout");
      expect(host.listRequests()).toHaveLength(2);

      host.clock.now += SECOND;
      codexAnswer = () => catalogAnswer(modelList("gpt-ready"));
      claudeAnswer = () => held.promise;
      expect(await readError("claude-code")).toBe("timeout");
      await vi.waitFor(() => {
        expect(host.listRequests("claude-code")).toHaveLength(2);
      });
      expect(modelIds(await host.read("codex"))).toEqual(["gpt-ready"]);
      expect(host.listRequests("codex")).toHaveLength(2);
      held.resolve(errorAnswer("command_timeout"));

      host.clock.now += 10 * MINUTE;
      codexAnswer = () => errorAnswer("auth_required");
      expect(modelIds(await host.read("codex"))).toEqual(["gpt-ready"]);
      await vi.waitFor(() => {
        expect(host.listRequests("codex")).toHaveLength(3);
      });
      await settleTimers();
      const surfaced = await host.read("codex");
      expect(surfaced.modelLoadError).toEqual({
        providerId: "codex",
        code: "auth_required",
      });
      expect(surfaced.models).toEqual([]);
    });
  });

  it("waits through recorded failures for validation and refreshes a catalog at least a minute old that lacks the override's model", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, { id: "host-catalog-validation" });
      let codexAnswer = () => catalogAnswer(modelList("gpt-5"));
      host.setAnswer((command) =>
        command.providerId === "codex"
          ? codexAnswer()
          : errorAnswer("command_failed"),
      );
      await host.read("claude-code");
      await host.read("claude-code");
      expect(host.listRequests("claude-code")).toHaveLength(1);
      const validated = await resolveSystemProviderModels(harness.deps, {
        hostId: host.hostId,
        providerId: "claude-code",
      });
      expect(validated.modelLoadError?.code).toBe("failed");
      expect(host.listRequests("claude-code")).toHaveLength(2);

      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.hostId,
        path: "/tmp/catalog-override",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.hostId,
        projectId: project.id,
        path: "/tmp/catalog-override",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });
      const override = (model: string) =>
        applyThreadExecutionOverride(harness.deps, {
          thread,
          patch: { model },
        });
      const invalidModel = { status: 400, body: { code: "invalid_request" } };
      await host.read("codex", environment.id);

      host.clock.now += 61 * SECOND;
      codexAnswer = () => catalogAnswer(modelList("gpt-5", "gpt-new"));
      await override("gpt-new");
      expect(host.listRequests("codex")).toHaveLength(2);

      host.clock.now += 30 * SECOND;
      codexAnswer = () => catalogAnswer(modelList("gpt-5", "gpt-newer"));
      await expect(override("gpt-newer")).rejects.toMatchObject(invalidModel);
      expect(host.listRequests("codex")).toHaveLength(2);

      host.clock.now += 31 * SECOND;
      await expect(override("gpt-unknown")).rejects.toMatchObject(invalidModel);
      expect(host.listRequests("codex")).toHaveLength(3);

      host.clock.now += 61 * SECOND;
      codexAnswer = () => errorAnswer("command_timeout");
      await expect(override("gpt-other")).rejects.toMatchObject(invalidModel);
      expect(host.listRequests("codex")).toHaveLength(4);
    });
  });

  it("serves a persisted catalog to a new store and treats a corrupt row as missing", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, {
        id: "host-catalog-persistence",
      });
      await host.read("codex");

      installCatalogStore(harness, { clock: host.clock });
      expect(modelIds(await host.read("codex"))).toEqual(["codex-model"]);
      expect(host.listRequests()).toHaveLength(1);

      harness.db.$client
        .prepare(
          "UPDATE provider_model_catalogs SET models_json = ? WHERE host_id = ?",
        )
        .run("{not json", host.hostId);
      installCatalogStore(harness, { clock: host.clock });
      expect(modelIds(await host.read("codex"))).toEqual(["codex-model"]);
      expect(host.listRequests()).toHaveLength(2);
    });
  });

  it("persists one row per workspace path for workspace-scoped providers and one host row otherwise", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, { id: "host-catalog-workspace" });
      const [environmentA, environmentB] = [
        "/tmp/catalog-pi-a",
        "/tmp/catalog-pi-b",
      ].map((path) => seedEnvironmentPath(harness, host.hostId, path));
      await host.read("pi", environmentA);
      await host.read("pi", environmentB);
      await host.read("pi", environmentA);
      await host.read("claude-code", environmentA);

      const rowExists = (providerId: string, scopeKey: string) =>
        getStoredProviderModelCatalog(harness.db, {
          hostId: host.hostId,
          providerId,
          scopeKey,
        }) !== null;
      expect([
        rowExists("pi", "/tmp/catalog-pi-a"),
        rowExists("pi", "/tmp/catalog-pi-b"),
        rowExists("pi", ""),
        rowExists("claude-code", ""),
      ]).toEqual([true, true, false, true]);
      expect(host.listRequests().map((command) => command.cwd)).toEqual([
        "/tmp/catalog-pi-a",
        "/tmp/catalog-pi-b",
        undefined,
      ]);
    });
  });

  it("records no failure and sends no push when a refresh fails after its daemon session changed or because the host is not active", async () => {
    await withTestHarness(async (harness) => {
      const logLines = captureLogLines(harness);
      const host = setupCatalogHost(harness, {
        id: "host-catalog-host-unavailable",
      });
      const pushes = capturePushes(harness);
      const lateFailure = createDeferredPromise<void>();
      const request = harness.hub.requestHostOnlineRpc.bind(harness.hub);
      let holdNextList = true;
      vi.spyOn(harness.hub, "requestHostOnlineRpc").mockImplementation(
        async (args) => {
          if (
            args.message.command.type !== "provider.list_models" ||
            !holdNextList
          ) {
            return request(args);
          }
          holdNextList = false;
          await lateFailure.promise;
          return {
            type: "host-rpc.response",
            requestId: args.message.requestId,
            commandType: "provider.list_models",
            ok: false,
            errorCode: "command_failed",
            errorMessage: "Runtime shutting down",
          };
        },
      );

      const pending = host.read("claude-code");
      await vi.waitFor(() => {
        expect(holdNextList).toBe(false);
      });
      const nextRequests = host.connect(
        seedSession(harness.deps, host.hostId).id,
      );
      lateFailure.resolve();
      const failed = await pending;
      expect(failed.modelLoadError?.code).toBe("failed");
      expect(modelIds(failed)).toEqual(
        fallbackModelIds(harness, "claude-code"),
      );

      updateHost(harness.db, harness.hub, host.hostId, { phase: "creating" });
      expect((await host.read("claude-code")).modelLoadError?.code).toBe(
        "failed",
      );
      updateHost(harness.db, harness.hub, host.hostId, { phase: "active" });
      expect(modelIds(await host.read("claude-code"))).toEqual([
        "claude-code-model",
      ]);
      expect(nextRequests()).toHaveLength(1);
      await settleTimers();
      expect(pushes).toEqual([host.hostId]);
      expect(
        logLines(SETTLED).map(({ outcome, errorCode }) => [outcome, errorCode]),
      ).toEqual([
        ["host_unavailable", "command_failed"],
        ["host_unavailable", "host_unavailable"],
        ["success", undefined],
      ]);
    });
  });

  it("ignores a refresh that settles after a later refresh under another fingerprint", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, { id: "host-catalog-superseded" });
      const base = requireRegistration(harness, "claude-code");
      const heldOne = createDeferredPromise<HostRpcHandlerResult>();
      const heldTwo = createDeferredPromise<HostRpcHandlerResult>();
      host.setAnswer((command) =>
        command.bridgeLaunch.providerOptions.catalogProbe === "one"
          ? heldOne.promise
          : heldTwo.promise,
      );
      const firstProbe = registerCatalogProbe(harness, {
        bridgeOptions: { ...base.bridgeOptions, catalogProbe: "one" },
      });
      const first = host.read("catalog-probe");
      await vi.waitFor(() => {
        expect(host.listRequests()).toHaveLength(1);
      });
      firstProbe.dispose();
      registerCatalogProbe(harness, {
        bridgeOptions: { ...base.bridgeOptions, catalogProbe: "two" },
      });
      const second = host.read("catalog-probe");
      await vi.waitFor(() => {
        expect(host.listRequests()).toHaveLength(2);
      });

      heldTwo.resolve(catalogAnswer(modelList("model-two")));
      expect(modelIds(await second)).toEqual(["model-two"]);
      heldOne.resolve(catalogAnswer(modelList("model-one")));
      await first;

      expect(modelIds(await host.read("catalog-probe"))).toEqual(["model-two"]);
      expect(host.listRequests()).toHaveLength(2);
      expect(
        getStoredProviderModelCatalog(harness.db, {
          hostId: host.hostId,
          providerId: "catalog-probe",
          scopeKey: "",
        })?.modelsJson,
      ).toContain("model-two");
    });
  });

  it("clears a provider's recorded failure in every workspace scope after a successful install", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, { id: "host-catalog-install" });
      const environmentId = seedEnvironmentPath(
        harness,
        host.hostId,
        "/tmp/catalog-install",
      );
      host.setAnswer(() => errorAnswer("missing_executable"));
      await host.read("pi", environmentId);
      await host.read("pi", environmentId);
      expect(host.listRequests("pi")).toHaveLength(1);

      const install = await harness.app.request(
        `/api/v1/hosts/${host.hostId}/provider-clis/install`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "pi", actionKind: "install" }),
        },
      );
      expect(install.status).toBe(200);
      expect(await install.text()).toContain('"success":true');
      host.setAnswer(() => catalogAnswer(modelList("pi-installed")));

      expect(modelIds(await host.read("pi", environmentId))).toEqual([
        "pi-installed",
      ]);
      expect(host.listRequests("pi")).toHaveLength(2);
    });
  });

  it("marks catalogs stale and drops failures when the machine environment is saved, including a refresh that was in flight", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, {
        id: "host-catalog-machine-environment",
      });
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        machineGitCredentialsEnabled: false,
      });
      const held = createDeferredPromise<HostRpcHandlerResult>();
      let saved = false;
      host.setAnswer((command) => {
        if (saved) {
          return catalogAnswer(modelList(`${command.providerId}-after`));
        }
        switch (command.providerId) {
          case "claude-code":
            return errorAnswer("auth_required");
          case "pi":
            return held.promise;
          default:
            return catalogAnswer(modelList(`${command.providerId}-before`));
        }
      });
      await host.read("codex");
      await host.read("claude-code");
      const coldPi = host.read("pi");
      await vi.waitFor(() => {
        expect(host.listRequests("pi")).toHaveLength(1);
      });

      const response = await harness.app.request(
        "/api/v1/settings/machine-environment",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            variables: [{ name: "CATALOG_REGION", value: "two", note: null }],
          }),
        },
      );
      expect(response.status).toBe(200);
      held.resolve(catalogAnswer(modelList("pi-before")));
      expect(modelIds(await coldPi)).toEqual(["pi-before"]);
      saved = true;

      expect(modelIds(await host.read("claude-code"))).toEqual([
        "claude-code-after",
      ]);
      for (const providerId of ["codex", "pi"]) {
        expect(modelIds(await host.read(providerId))).toEqual([
          `${providerId}-before`,
        ]);
        await vi.waitFor(async () => {
          expect(modelIds(await host.read(providerId))).toEqual([
            `${providerId}-after`,
          ]);
        });
        expect(host.listRequests(providerId)).toHaveLength(2);
      }
    });
  });

  it("never evicts an entry with an in-flight refresh and reloads evicted entries from SQLite", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, {
        id: "host-catalog-eviction",
        memoryEntryLimit: 2,
      });
      const held = createDeferredPromise<HostRpcHandlerResult>();
      host.setAnswer((command) =>
        command.providerId === "claude-code"
          ? held.promise
          : catalogAnswer(modelList(`${command.providerId}-model`)),
      );
      const heldRead = host.read("claude-code");
      await vi.waitFor(() => {
        expect(host.listRequests("claude-code")).toHaveLength(1);
      });
      await host.read("codex");
      await host.read("acp-cursor");
      const joinedRead = host.read("claude-code");
      await settleTimers();
      expect(host.listRequests("claude-code")).toHaveLength(1);
      held.resolve(catalogAnswer(modelList("claude-held")));
      expect(modelIds(await heldRead)).toEqual(["claude-held"]);
      expect(modelIds(await joinedRead)).toEqual(["claude-held"]);

      harness.db.$client
        .prepare(
          "UPDATE provider_model_catalogs SET models_json = ? WHERE host_id = ? AND provider_id = 'codex'",
        )
        .run(JSON.stringify(modelList("codex-from-sqlite")), host.hostId);
      expect(modelIds(await host.read("codex"))).toEqual(["codex-from-sqlite"]);
      expect(host.listRequests("codex")).toHaveLength(1);
    });
  });

  it("forgets a removed host's catalogs, persists and pushes nothing for its in-flight refreshes, and never persists ephemeral hosts", async () => {
    await withTestHarness(async (harness) => {
      const host = setupCatalogHost(harness, { id: "host-catalog-forget" });
      const environmentId = seedEnvironmentPath(
        harness,
        host.hostId,
        "/tmp/catalog-forget",
      );
      await host.read("pi", environmentId);
      await host.read("claude-code");
      const held = createDeferredPromise<HostRpcHandlerResult>();
      host.setAnswer(() => held.promise);
      const pending = host.read("codex");
      await vi.waitFor(() => {
        expect(host.listRequests("codex")).toHaveLength(1);
      });
      const pushes = capturePushes(harness);
      const rowCount = () =>
        harness.db.$client
          .prepare(
            "SELECT COUNT(*) AS count FROM provider_model_catalogs WHERE host_id = ?",
          )
          .get(host.hostId);

      host.store.forgetHost(harness.deps, host.hostId);
      expect(rowCount()).toEqual({ count: 0 });
      held.resolve(catalogAnswer(modelList("late-model")));
      expect((await pending).modelLoadError?.code).toBe("failed");
      await settleTimers();
      expect(pushes).toEqual([]);
      expect(rowCount()).toEqual({ count: 0 });
      await host.read("claude-code");
      expect(host.listRequests("claude-code")).toHaveLength(2);

      const ephemeral = seedHostSession(harness.deps, {
        id: "host-catalog-ephemeral",
      });
      updateHost(harness.db, harness.hub, ephemeral.host.id, {
        type: "ephemeral",
      });
      registerHostRpcResponder(harness, {
        hostId: ephemeral.host.id,
        sessionId: ephemeral.session.id,
        handle: (request) =>
          request.command.type === "provider.list_models"
            ? catalogAnswer(modelList("gpt-5"))
            : healthAnswer("not_installed"),
      });
      const response = await resolveSystemExecutionOptions(harness.deps, {
        hostId: ephemeral.host.id,
        providerId: "codex",
      });
      expect(modelIds(response)).toEqual(["gpt-5"]);
      expect(
        getStoredProviderModelCatalog(harness.db, {
          hostId: ephemeral.host.id,
          providerId: "codex",
          scopeKey: "",
        }),
      ).toBeNull();
    });
  });
});

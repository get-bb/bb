import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  archiveThread,
  claimedThreadSpawns,
  createThread,
  environments,
  getThread,
  hosts,
  insertThreadPluginMetadata,
  updateClaimedThreadSpawn,
  markThreadDeleted,
  migrate,
  noopNotifier,
  projects,
  type DbConnection,
} from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginServiceDeps,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import type { BbPluginApi } from "../../../src/services/plugins/plugin-api.js";
import {
  seedHostSession,
  seedEnvironment,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import {
  registerTestHostRpcCapture,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../../helpers/commands.js";
import { PluginHostArtifactRegistry } from "../../../src/services/plugins/plugin-host-artifact-registry.js";
import { startTestServer, testLogger } from "../../helpers/test-app.js";
import {
  defineRpcContract,
  type ExperimentalClaimedThreadSpawnArgs,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";

const logger = testLogger as unknown as Logger;

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string; hostSource?: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        name: "SDK fixture",
        description: "Plugin SDK fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(options.hostSource === undefined ? {} : { host: "./host.ts" }),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  if (options.hostSource !== undefined) {
    await writeFile(join(rootDir, "host.ts"), options.hostSource);
  }
  return rootDir;
}

function claimPluginServerSource(
  authorityId: string,
  hostId = "host-1",
): string {
  return `
    const schema = { "~standard": { validate(value) { return { value }; } } };
    export default function plugin(bb) {
      bb.experimental_effects.experimental_registerClaimAuthority({
        authorityId: ${JSON.stringify(authorityId)},
        contract: { claim: { input: schema, output: schema } },
        hostId: ${JSON.stringify(hostId)},
        method: "claim",
      });
    }
  `;
}

function requireApi(service: PluginService, pluginId: string): BbPluginApi {
  const api = service.getApi(pluginId);
  if (!api) throw new Error(`plugin ${pluginId} is not running`);
  return api;
}

const claimedEnvironmentBinding = {
  type: "reuse",
  environmentId: "environment-1",
  projectId: "project-1",
  hostId: "host-1",
  canonicalPath: "/tmp/claimed-spawn-environment",
  workspaceProvisionType: "unmanaged",
  isWorktree: false,
  provisionRequestId: "provision-1",
  provisionRequestSha256: "1".repeat(64),
} as const;

function claimedThreadSpawnRequest(prompt: string) {
  return {
    schema: "bb.thread-spawn-request/v2",
    projectId: "project-1",
    environment: { type: "reuse", environmentId: "environment-1" },
    prompt,
    title: null,
    providerId: "codex",
    model: null,
    reasoningLevel: null,
    permissionMode: "accept-edits",
    serviceTier: null,
  } as const;
}

function claimedThreadSpawnArgs(
  authorityId: string,
  claimId: string,
  attemptId: string,
  prompt: string,
): ExperimentalClaimedThreadSpawnArgs {
  return {
    bindingVersion: 2,
    authorityId,
    authorizationId: `authorization-${claimId}`,
    claimId,
    attemptId,
    environmentBinding: claimedEnvironmentBinding,
    request: claimedThreadSpawnRequest(prompt),
  };
}

function currentClaimResult(input: unknown) {
  const request = input as {
    attemptId: string;
    authorityId: string;
    claimId: string;
    requestSha256: string;
    authorizationId: string;
  };
  return {
    schema: "bb.effect-claim-result/v2",
    status: "claimed",
    authorityId: request.authorityId,
    claimId: request.claimId,
    attemptId: request.attemptId,
    requestSha256: request.requestSha256,
    authorizationId: request.authorizationId,
  };
}

function agentConfigurationContext(
  threadId: string,
): Parameters<PluginService["resolveAgentConfiguration"]>[0]["context"] {
  return {
    thread: {
      id: threadId,
      title: null,
      parentThreadId: null,
      sourceThreadId: null,
    },
    project: {
      id: "project-configure",
      kind: "standard",
      name: "Configure fixture",
      gitRemoteUrl: null,
    },
    environment: {
      id: "environment-configure",
      name: null,
      path: null,
      branchName: null,
      workspaceProvisionType: null,
    },
    host: { id: "host-configure", name: "Configure host" },
    provider: {
      id: "codex",
      model: "gpt-5",
      capabilities: { supportsNativeUserQuestion: false },
    },
    origin: { kind: null, pluginId: null },
  };
}

describe("plugin bb.sdk bind gate", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;
  let pluginHostArtifacts: PluginHostArtifactRegistry;
  let appUrl: string | null;
  const sharedPorts = {
    declareSharedPorts: vi.fn(),
    validateSharedPortDeclaration: vi.fn(
      (_hostId: string, ports: readonly number[]) => [...ports],
    ),
    replaceDeclarationsForOwner: vi.fn(),
    clearDeclarationsForOwner: vi.fn(),
  };
  const ensureSharedPortTunnel = vi.fn().mockResolvedValue({
    label: "sawyer-air",
    baseDomain: "getbb.app",
  });
  const callPluginHost = vi.fn(
    async (
      _args: Parameters<NonNullable<PluginServiceDeps["callPluginHost"]>>[0],
    ): Promise<unknown> => ({ pong: true }),
  );
  const disposePluginHost = vi.fn(async () => undefined);
  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    const now = Date.now();
    db.insert(hosts)
      .values({
        id: "host-1",
        name: "Claim authority host",
        type: "persistent",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(projects)
      .values({
        id: "project-1",
        name: "Claimed spawn project",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(environments)
      .values({
        id: "environment-1",
        projectId: "project-1",
        hostId: "host-1",
        path: "/tmp/claimed-spawn-environment",
        providerOwnsPath: false,
        provisionRequestId: "provision-1",
        provisionRequestSha256: "1".repeat(64),
        status: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-test-"));
    sharedPorts.declareSharedPorts.mockClear();
    sharedPorts.validateSharedPortDeclaration.mockClear();
    sharedPorts.replaceDeclarationsForOwner.mockClear();
    sharedPorts.clearDeclarationsForOwner.mockClear();
    ensureSharedPortTunnel.mockClear();
    callPluginHost.mockReset();
    callPluginHost.mockImplementation(async () => ({ pong: true }));
    disposePluginHost.mockClear();
    appUrl = "https://bb.example.test";
    pluginHostArtifacts = new PluginHostArtifactRegistry();
    service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      pluginHostArtifacts,
      sharedPorts,
      ensureSharedPortTunnel,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      getAppUrl: () => appUrl,
      loadTimeoutMs: 2000,
      callPluginHost,
      disposePluginHost,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("throws a descriptive error before bindSdk and resolves after", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-gate",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    const api = requireApi(service, "gate");

    expect(() => api.sdk).toThrow(
      /bb\.sdk is not available until the server is listening/,
    );

    service.bindSdk({ baseUrl: "http://127.0.0.1:9" });
    expect(typeof api.sdk.threads.fork).toBe("function");
    expect(typeof api.sdk.threads.spawn).toBe("function");
  });

  it("rejects unsafe plugin metadata before transport serialization", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-metadata-boundary",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "http://127.0.0.1:9" });
    const api = requireApi(service, "metadata-boundary");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const invalidValues: Array<{
      value: unknown;
      error: Record<string, unknown>;
    }> = [
      {
        value: Number.NaN,
        error: { message: "pluginMetadata must be a plain JSON object" },
      },
      { value: { missing: undefined }, error: { name: "ZodError" } },
    ];
    const operations = [
      (pluginMetadata: unknown) =>
        api.sdk.threads.spawn({
          projectId: "project-1",
          environment: { type: "project-default" },
          prompt: "invalid",
          pluginMetadata,
        } as never),
      (pluginMetadata: unknown) =>
        api.sdk.threads.fork({
          sourceThreadId: "source-1",
          pluginMetadata,
        } as never),
      (set: unknown) =>
        api.sdk.threads.updatePluginMetadata({
          threadId: "thread-1",
          set,
        } as never),
    ];

    for (const operation of operations) {
      for (const invalidValue of invalidValues) {
        await expect(operation(invalidValue.value)).rejects.toMatchObject(
          invalidValue.error,
        );
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves no-context spawn and fork attribution", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-metadata-attribution",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "metadata-attribution");
    const requests: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: "thread-1",
          projectId: "project-1",
          title: null,
          status: "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const operations = [
      (overrides: Record<string, unknown>) =>
        api.sdk.threads.spawn({
          projectId: "project-1",
          environment: { type: "project-default" },
          prompt: "compatibility",
          ...overrides,
        } as never),
      (overrides: Record<string, unknown>) =>
        api.sdk.threads.fork({
          sourceThreadId: "source-1",
          ...overrides,
        } as never),
    ];

    for (const operation of operations) {
      requests.length = 0;
      await operation({});
      expect(requests[0]).toMatchObject({
        origin: "plugin",
        originPluginId: "metadata-attribution",
      });

      await operation({
        origin: "plugin",
        originPluginId: "legacy-plugin",
      });
      expect(requests[1]).toMatchObject({
        origin: "plugin",
        originPluginId: "legacy-plugin",
      });

      await operation({ origin: "sdk" });
      expect(requests[2]).toMatchObject({ origin: "sdk" });
      expect(requests[2]).not.toHaveProperty("originPluginId");
    }
  });

  it("uses only a registered current claim capability for a closed V2 request", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-registered-claim",
      serverSource: claimPluginServerSource("registered-authority"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "registered-claim");
    callPluginHost.mockImplementationOnce(async (call) => {
      const input = call.input as {
        attemptId: string;
        authorityId: string;
        claimId: string;
        requestSha256: string;
      };
      return {
        schema: "bb.effect-claim-result/v2",
        status: "claimed",
        authorityId: input.authorityId,
        claimId: input.claimId,
        attemptId: input.attemptId,
        requestSha256: input.requestSha256,
        authorizationId: "registered-authorization",
      };
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "thread-registered-claim",
          projectId: "project-1",
          environmentId: "environment-1",
          providerId: "codex",
          status: "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      api.experimental_effects.experimental_spawnClaimed({
        bindingVersion: 2,
        claimId: "registered-claim",
        attemptId: "registered-attempt",
        authorityId: "registered-authority",
        authorizationId: "registered-authorization",
        environmentBinding: {
          type: "reuse",
          environmentId: "environment-1",
          projectId: "project-1",
          hostId: "host-1",
          canonicalPath: "/tmp/claimed-spawn-environment",
          workspaceProvisionType: "unmanaged",
          isWorktree: false,
          provisionRequestId: "provision-1",
          provisionRequestSha256: "1".repeat(64),
        },
        request: {
          schema: "bb.thread-spawn-request/v2",
          projectId: "project-1",
          environment: { type: "reuse", environmentId: "environment-1" },
          prompt: "€$\u000f\nA'B\"\\\\/😀",
          title: "Registered effect",
          providerId: "codex",
          model: null,
          reasoningLevel: null,
          permissionMode: "accept-edits",
          serviceTier: null,
        },
      }),
    ).resolves.toMatchObject({
      state: "completed",
      thread: { id: "thread-registered-claim" },
    });
    expect(callPluginHost).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host-1", method: "claim" }),
    );
    const claimInput = callPluginHost.mock.calls[0]?.[0].input as {
      authorityId: string;
      authorizationId: string;
      requestCanonicalJson: string;
      requestSha256: string;
    };
    expect(claimInput).toMatchObject({
      authorityId: "registered-authority",
      authorizationId: "registered-authorization",
    });
    const expectedCanonicalRequest =
      '{"effect":"bb_threads_spawn","pluginId":"registered-claim","request":{"environment":{"environmentId":"environment-1","type":"reuse"},"model":null,"origin":"plugin","originPluginId":"registered-claim","permissionMode":"accept-edits","pluginMetadata":{"__bbClaimedThreadSpawnV2":{"attemptId":"registered-attempt","claimId":"registered-claim"}},"projectId":"project-1","prompt":"€$\\u000f\\nA\'B\\\"\\\\\\\\/😀","providerId":"codex","reasoningLevel":null,"schema":"bb.thread-spawn-request/v2","serviceTier":null,"title":"Registered effect"}}';
    expect(claimInput.requestCanonicalJson).toBe(expectedCanonicalRequest);
    expect(claimInput.requestSha256).toBe(
      createHash("sha256").update(expectedCanonicalRequest).digest("hex"),
    );
  });

  it("snapshots the registered claim contract for the plugin generation", async () => {
    const mutationGlobal = globalThis as typeof globalThis & {
      __bbMutateClaimContract?: () => void;
    };
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-immutable-claim-contract",
      serverSource: `
        const accept = { "~standard": { validate(value) { return { value }; } } };
        const reject = { "~standard": { validate() { return { issues: [{ message: "mutated" }] }; } } };
        const contract = { claim: { input: accept, output: accept } };
        export default function plugin(bb) {
          bb.experimental_effects.experimental_registerClaimAuthority({
            authorityId: "authority-immutable-contract",
            contract,
            hostId: "host-1",
            method: "claim",
          });
          globalThis.__bbMutateClaimContract = () => {
            contract.claim = { input: reject, output: reject };
          };
        }
      `,
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "immutable-claim-contract");
    mutationGlobal.__bbMutateClaimContract?.();
    callPluginHost.mockImplementationOnce(async (call) => {
      const validation = await call.contract[call.method]?.input[
        "~standard"
      ].validate(call.input);
      if (validation === undefined || "issues" in validation) {
        throw new Error("registered claim contract was mutated");
      }
      return currentClaimResult(call.input);
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "thread-immutable-contract",
          projectId: "project-1",
          environmentId: "environment-1",
          providerId: "codex",
          status: "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      await expect(
        api.experimental_effects.experimental_spawnClaimed(
          claimedThreadSpawnArgs(
            "authority-immutable-contract",
            "claim-immutable-contract",
            "attempt-immutable-contract",
            "use the registered contract snapshot",
          ),
        ),
      ).resolves.toMatchObject({ state: "completed" });
    } finally {
      delete mutationGlobal.__bbMutateClaimContract;
    }
  });

  it("refuses non-closed or invalid-Unicode V2 requests before claiming", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-closed-claim",
      serverSource: claimPluginServerSource("authority-closed"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "closed-claim");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const args = claimedThreadSpawnArgs(
      "authority-closed",
      "claim-closed",
      "attempt-closed",
      "closed request",
    );

    const invalid = [
      { ...args, request: { ...args.request, unknown: true } },
      { ...args, request: { ...args.request, model: undefined } },
      { ...args, request: { ...args.request, prompt: "\ud800" } },
    ];
    for (const value of invalid) {
      await expect(
        api.experimental_effects.experimental_spawnClaimed(value as never),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(db.select().from(claimedThreadSpawns).all()).toEqual([]);
    expect(callPluginHost).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("persists nothing when the registered current authority refuses", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-refused-claim",
      serverSource: claimPluginServerSource("authority-refused"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "refused-claim");
    callPluginHost.mockRejectedValueOnce(new Error("claim is not current"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      api.experimental_effects.experimental_spawnClaimed(
        claimedThreadSpawnArgs(
          "authority-refused",
          "claim-refused",
          "attempt-refused",
          "must remain unpersisted",
        ),
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "claim_unavailable" },
    });
    expect(db.select().from(claimedThreadSpawns).all()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a claim authority registered on a different environment host", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-foreign-host-authority",
      serverSource: `
        const schema = { "~standard": { validate(value) { return { value }; } } };
        export default function plugin(bb) {
          bb.experimental_effects.experimental_registerClaimAuthority({
            authorityId: "authority-foreign-host",
            contract: { claim: { input: schema, output: schema } },
            hostId: "host-2",
            method: "claim",
          });
        }
      `,
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "foreign-host-authority");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      api.experimental_effects.experimental_spawnClaimed(
        claimedThreadSpawnArgs(
          "authority-foreign-host",
          "claim-foreign-host",
          "attempt-foreign-host",
          "refuse a foreign authority host",
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.select().from(claimedThreadSpawns).all()).toEqual([]);
    expect(callPluginHost).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("revalidates the provisioned environment after the current claim", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-stale-after-claim",
      serverSource: claimPluginServerSource("authority-stale-after-claim"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "stale-after-claim");
    callPluginHost.mockImplementationOnce(async (call) => {
      db.update(environments).set({ status: "error" }).run();
      return currentClaimResult(call.input);
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      api.experimental_effects.experimental_spawnClaimed(
        claimedThreadSpawnArgs(
          "authority-stale-after-claim",
          "claim-stale-after-claim",
          "attempt-stale-after-claim",
          "revalidate the exact provision row",
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.select().from(claimedThreadSpawns).all()).toEqual([]);
    expect(callPluginHost).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("claims one exact thread spawn and replays its durable result", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-claimed-spawn",
      serverSource: claimPluginServerSource("authority-1"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "claimed-spawn");
    callPluginHost.mockImplementationOnce(async (args) => {
      return currentClaimResult(args.input);
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "thread-claimed-1",
          projectId: "project-1",
          environmentId: "environment-1",
          providerId: "codex",
          title: null,
          status: "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const args = claimedThreadSpawnArgs(
      "authority-1",
      "claim-1",
      "attempt-1",
      "one exact effect",
    );

    const effect = () =>
      api.experimental_effects.experimental_spawnClaimed(args);
    const [first, concurrent] = await Promise.all([effect(), effect()]);
    const replay =
      await api.experimental_effects.experimental_spawnClaimed(args);

    expect(first).toMatchObject({
      schema: "bb.claimed-thread-spawn-result/v1",
      state: "completed",
      replay: false,
      thread: { id: "thread-claimed-1" },
    });
    expect(concurrent).toEqual({ ...first, replay: true });
    expect(replay).toEqual({ ...first, replay: true });
    expect(callPluginHost).toHaveBeenCalledTimes(1);
    expect(callPluginHost).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "claimed-spawn",
        hostId: "host-1",
        method: "claim",
        artifact: expect.objectContaining({
          digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
          generation: expect.any(String),
        }),
      }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toContain(
      '"__bbClaimedThreadSpawnV2":{"claimId":"claim-1","attemptId":"attempt-1"}',
    );

    await expect(
      api.experimental_effects.experimental_spawnClaimed({
        ...args,
        request: { ...args.request, prompt: "different effect" },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const recoveredThread = createThread(db, noopNotifier, {
      projectId: "project-1",
      providerId: "codex",
      pluginMetadata: {
        pluginId: "claimed-spawn",
        metadata: {
          __bbClaimedThreadSpawnV2: {
            claimId: "claim-1",
            attemptId: "attempt-1",
          },
        },
      },
    });
    updateClaimedThreadSpawn(db, "claim-1", {
      state: "delivering",
      threadJson: null,
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...recoveredThread,
          environmentId: "environment-1",
          providerId: "codex",
          status: "pending",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await expect(
      api.experimental_effects.experimental_spawnClaimed(args),
    ).resolves.toMatchObject({
      state: "completed",
      replay: true,
      thread: { id: recoveredThread.id },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refuses a concurrent claim id bound to a distinct attempt", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-concurrent-attempt",
      serverSource: claimPluginServerSource("authority-concurrent-attempt"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "concurrent-attempt");
    let releaseClaim: (() => void) | undefined;
    const claimBarrier = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    callPluginHost.mockImplementationOnce(async (call) => {
      await claimBarrier;
      return currentClaimResult(call.input);
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "thread-concurrent-attempt",
          projectId: "project-1",
          environmentId: "environment-1",
          providerId: "codex",
          status: "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const firstArgs = claimedThreadSpawnArgs(
      "authority-concurrent-attempt",
      "claim-concurrent-attempt",
      "attempt-concurrent-first",
      "one exact concurrent attempt",
    );
    const first = api.experimental_effects.experimental_spawnClaimed(firstArgs);
    await vi.waitFor(() => expect(callPluginHost).toHaveBeenCalledTimes(1));
    const conflicting = api.experimental_effects.experimental_spawnClaimed({
      ...firstArgs,
      attemptId: "attempt-concurrent-second",
    });
    releaseClaim?.();

    await expect(first).resolves.toMatchObject({ state: "completed" });
    await expect(conflicting).rejects.toMatchObject({
      status: 409,
      body: { code: "attempt_identity_conflict" },
    });
    expect(callPluginHost).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never retries a claimed spawn whose delivery result is unknown", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-uncertain-spawn",
      serverSource: claimPluginServerSource("authority-uncertain"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "uncertain-spawn");
    callPluginHost.mockImplementationOnce(async (args) => {
      return currentClaimResult(args.input);
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("response lost"));
    const args = claimedThreadSpawnArgs(
      "authority-uncertain",
      "claim-uncertain",
      "attempt-uncertain",
      "do not resend",
    );

    await expect(
      api.experimental_effects.experimental_spawnClaimed(args),
    ).resolves.toMatchObject({
      state: "delivery_uncertain",
      replay: false,
      thread: null,
    });
    await expect(
      api.experimental_effects.experimental_spawnClaimed(args),
    ).resolves.toMatchObject({
      state: "delivery_uncertain",
      replay: true,
      thread: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("makes a restarted delivery uncertain when reconciliation is unavailable", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-unavailable-reconcile",
      serverSource: claimPluginServerSource("authority-unavailable-reconcile"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "unavailable-reconcile");
    callPluginHost.mockImplementationOnce(async (call) =>
      currentClaimResult(call.input),
    );
    const args = claimedThreadSpawnArgs(
      "authority-unavailable-reconcile",
      "claim-unavailable-reconcile",
      "attempt-unavailable-reconcile",
      "reconcile without redelivery",
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "thread-unavailable-reconcile",
          projectId: "project-1",
          environmentId: "environment-1",
          providerId: "codex",
          status: "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await api.experimental_effects.experimental_spawnClaimed(args);
    const recoveredThread = createThread(db, noopNotifier, {
      projectId: "project-1",
      providerId: "codex",
      pluginMetadata: {
        pluginId: "unavailable-reconcile",
        metadata: {
          __bbClaimedThreadSpawnV2: {
            claimId: args.claimId,
            attemptId: args.attemptId,
          },
        },
      },
    });
    updateClaimedThreadSpawn(db, args.claimId, {
      state: "delivering",
      threadJson: null,
    });
    fetchSpy.mockRejectedValueOnce(new Error("reconciliation unavailable"));

    await expect(
      api.experimental_effects.experimental_spawnClaimed(args),
    ).resolves.toMatchObject({
      state: "delivery_uncertain",
      replay: true,
      thread: null,
    });
    expect(recoveredThread.id).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refuses a replayed controller claim before local persistence", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-current-claim",
      serverSource: claimPluginServerSource("authority-current"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "current-claim");
    callPluginHost.mockImplementationOnce(async (call) => ({
      ...currentClaimResult(call.input),
      status: "replay_refused",
      replay: true,
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const args = claimedThreadSpawnArgs(
      "authority-current",
      "claim-current",
      "attempt-current",
      "refuse controller replay",
    );

    await expect(
      api.experimental_effects.experimental_spawnClaimed(args),
    ).rejects.toMatchObject({
      status: 409,
      body: {
        code: "claim_replay_refused",
        details: {
          attemptId: args.attemptId,
          claimId: args.claimId,
        },
      },
    });
    expect(callPluginHost).toHaveBeenCalledTimes(1);
    expect(db.select().from(claimedThreadSpawns).all()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not spawn when the current claim binds a different request", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-claim-mismatch",
      serverSource: claimPluginServerSource("authority-wrong-request"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "claim-mismatch");
    callPluginHost.mockImplementationOnce(async (call) => {
      return {
        ...currentClaimResult(call.input),
        requestSha256: "0".repeat(64),
      };
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      api.experimental_effects.experimental_spawnClaimed({
        ...claimedThreadSpawnArgs(
          "authority-wrong-request",
          "claim-wrong-request",
          "attempt-wrong-request",
          "exact request",
        ),
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "spawn_request_digest_mismatch" },
    });
    expect(db.select().from(claimedThreadSpawns).all()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a missing reuse environment before claim persistence", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-missing-environment",
      serverSource: claimPluginServerSource("authority-missing-environment"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "missing-environment");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const args = claimedThreadSpawnArgs(
      "authority-missing-environment",
      "claim-missing-environment",
      "attempt-missing-environment",
      "must not cross the stale identity boundary",
    );

    await expect(
      api.experimental_effects.experimental_spawnClaimed({
        ...args,
        environmentBinding: {
          ...args.environmentBinding,
          environmentId: "environment-not-in-db",
        },
        request: {
          ...args.request,
          environment: {
            type: "reuse",
            environmentId: "environment-not-in-db",
          },
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "stale_or_foreign_identity" },
    });
    expect(db.select().from(claimedThreadSpawns).all()).toEqual([]);
    expect(callPluginHost).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("admits only one of two concurrent attempts for one authorization", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-authorization-replay",
      serverSource: claimPluginServerSource("authority-replay"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "authorization-replay");
    callPluginHost.mockImplementation(async (call) => {
      return currentClaimResult(call.input);
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "thread-authorization-once",
          projectId: "project-1",
          environmentId: "environment-1",
          providerId: "codex",
          status: "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const effect = (claimId: string, attemptId: string) =>
      api.experimental_effects.experimental_spawnClaimed({
        ...claimedThreadSpawnArgs(
          "authority-replay",
          claimId,
          attemptId,
          "one authorization",
        ),
        authorizationId: "authorization-once",
      });

    const outcomes = await Promise.allSettled([
      effect("claim-first", "attempt-first"),
      effect("claim-second", "attempt-second"),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    expect(callPluginHost).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("contains a thread returned for the wrong environment", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-spawn-mismatch",
      serverSource: claimPluginServerSource("authority-mismatch"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "spawn-mismatch");
    callPluginHost.mockImplementationOnce(async (call) => {
      return currentClaimResult(call.input);
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "thread-wrong-environment",
          projectId: "project-1",
          environmentId: "environment-wrong",
          providerId: "codex",
          status: "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const args = claimedThreadSpawnArgs(
      "authority-mismatch",
      "claim-mismatch",
      "attempt-mismatch",
      "must stay in environment-1",
    );

    await expect(
      api.experimental_effects.experimental_spawnClaimed(args),
    ).resolves.toMatchObject({ state: "delivery_uncertain", thread: null });
    await expect(
      api.experimental_effects.experimental_spawnClaimed(args),
    ).resolves.toMatchObject({
      state: "delivery_uncertain",
      replay: true,
      thread: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("contains a matching thread when the provision becomes stale during delivery", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-stale-during-spawn",
      serverSource: claimPluginServerSource("authority-stale-during-spawn"),
      hostSource: `export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "https://bb.example.test" });
    const api = requireApi(service, "stale-during-spawn");
    callPluginHost.mockImplementationOnce(async (call) =>
      currentClaimResult(call.input),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        db.update(environments).set({ status: "error" }).run();
        return new Response(
          JSON.stringify({
            id: "thread-stale-during-spawn",
            projectId: "project-1",
            environmentId: "environment-1",
            providerId: "codex",
            status: "pending",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

    await expect(
      api.experimental_effects.experimental_spawnClaimed(
        claimedThreadSpawnArgs(
          "authority-stale-during-spawn",
          "claim-stale-during-spawn",
          "attempt-stale-during-spawn",
          "contain a stale result",
        ),
      ),
    ).resolves.toMatchObject({
      state: "delivery_uncertain",
      replay: false,
      thread: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("serves the current public app URL without the SDK bind gate", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-app-url",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    const api = requireApi(service, "app-url");

    expect(api.server.experimental_appUrl).toBe("https://bb.example.test");
    appUrl = null;
    expect(api.server.experimental_appUrl).toBeNull();
  });

  it("marks a plugin error when its factory touches bb.sdk at load time", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-eager",
      serverSource: `
        export default function plugin(bb: any) {
          bb.sdk.threads.spawn({});
        }
      `,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      "bb.sdk is not available until the server is listening",
    );
  });

  it("delivers shared-port declarations through the server control plane", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-shares",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    const api = requireApi(service, "shares");

    await expect(api.hosts.ensureSharedPortTunnel("host-1")).resolves.toEqual({
      label: "sawyer-air",
      baseDomain: "getbb.app",
    });
    api.hosts.declareSharedPorts("host-1", [8080, 3000]);

    expect(ensureSharedPortTunnel).toHaveBeenCalledWith("host-1");

    expect(sharedPorts.declareSharedPorts).toHaveBeenCalledWith({
      ownerId: "shares",
      hostId: "host-1",
      ports: [8080, 3000],
    });

    await service.stop();
    expect(sharedPorts.clearDeclarationsForOwner).toHaveBeenCalledWith(
      "shares",
    );
  });

  it("binds typed host calls and ignores worker exits from stale generations", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-host-client",
      serverSource: `export default function plugin() {}`,
      hostSource: `
        const schema = { "~standard": { validate(value) { return { value }; } } };
        export default {
          experimental_apiVersion: 1,
          contract: { ping: { input: schema, output: schema } },
          experimental_signals: { changed: { payload: schema } },
          handlers: { ping: (input) => input },
        };
      `,
    });
    await service.installPath(rootDir);
    const api = requireApi(service, "host-client");
    const contract = defineRpcContract({
      ping: {
        input: z.object({ value: z.string() }).strict(),
        output: z.object({ pong: z.boolean() }).strict(),
      },
    });
    const experimental_signals = {
      changed: {
        payload: z.object({ sequence: z.number().int() }).strict(),
      },
    };
    const client = api.hosts.experimental_client({
      contract,
      experimental_signals,
    });

    await expect(
      client.call("ping", { value: "hello" }, { hostId: "host-1" }),
    ).resolves.toEqual({ pong: true });
    expect(callPluginHost).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "host-client",
        method: "ping",
        input: { value: "hello" },
        hostId: "host-1",
        artifact: expect.objectContaining({
          digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          byteLength: expect.any(Number),
          generation: expect.any(String),
        }),
      }),
    );

    const workerExitHandler = vi.fn();
    const signalHandler = vi.fn();
    client.experimental_onWorkerExit(workerExitHandler);
    client.experimental_onSignal("changed", signalHandler);
    const artifact = callPluginHost.mock.calls[0]?.[0].artifact;
    if (artifact === undefined) throw new Error("missing host artifact call");
    const servedArtifact = pluginHostArtifacts.get("host-client");
    if (servedArtifact === undefined)
      throw new Error("missing served artifact");
    expect(servedArtifact.digest).toBe(artifact.digest);
    expect(servedArtifact.byteLength).toBe(artifact.byteLength);
    expect(
      createHash("sha256")
        .update(await readFile(servedArtifact.path))
        .digest("hex"),
    ).toBe(artifact.digest);
    service.handleHostWorkerExit({
      authenticatedHostId: "host-1",
      pluginId: "host-client",
      generation: "stale-generation",
    });
    service.handleHostSignal({
      authenticatedHostId: "host-1",
      pluginId: "host-client",
      generation: "stale-generation",
      signal: "changed",
      payload: { sequence: 1 },
    });
    service.handleHostSignal({
      authenticatedHostId: "host-1",
      pluginId: "host-client",
      generation: artifact.generation,
      signal: "changed",
      payload: { sequence: 2 },
    });
    service.handleHostWorkerExit({
      authenticatedHostId: "host-1",
      pluginId: "host-client",
      generation: artifact.generation,
    });
    await vi.waitFor(() => expect(workerExitHandler).toHaveBeenCalledOnce());
    expect(workerExitHandler).toHaveBeenCalledWith({ hostId: "host-1" });
    await vi.waitFor(() => expect(signalHandler).toHaveBeenCalledOnce());
    expect(signalHandler).toHaveBeenCalledWith({
      hostId: "host-1",
      payload: { sequence: 2 },
    });
    expect(service.listHostArtifactGenerations()).toEqual([
      { pluginId: "host-client", generation: artifact.generation },
    ]);
  });

  it("rejects host calls during candidate factory registration", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-eager-host-client",
      serverSource: `
        import { defineRpcContract } from "@get-bb/plugin-sdk";
        const schema = { "~standard": { validate(value: unknown) { return { value }; } } };
        const contract = defineRpcContract({ ping: { input: schema, output: schema } });
        export default async function plugin(bb: any) {
          await bb.hosts.experimental_client({ contract }).call(
            "ping",
            {},
            { hostId: "host-1" },
          );
        }
      `,
      hostSource: `
        const schema = { "~standard": { validate(value) { return { value }; } } };
        export default {
          experimental_apiVersion: 1,
          contract: { ping: { input: schema, output: schema } },
          handlers: { ping: (input) => input },
        };
      `,
    });

    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      "host plugin calls are unavailable during factory registration",
    );
    expect(callPluginHost).not.toHaveBeenCalled();
  });

  it("does not publish candidate host declarations when reload fails", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-atomic-shares",
      serverSource: `
        export default function plugin(bb: any) {
          bb.hosts.declareSharedPorts("host-1", [3000]);
        }
      `,
    });
    await service.installPath(rootDir);
    const previousApi = requireApi(service, "atomic-shares");
    expect(sharedPorts.replaceDeclarationsForOwner).toHaveBeenCalledWith(
      "atomic-shares",
      [{ hostId: "host-1", ports: [3000] }],
    );
    sharedPorts.replaceDeclarationsForOwner.mockClear();

    await writeFile(
      join(rootDir, "server.ts"),
      `
        export default function plugin(bb: any) {
          bb.hosts.declareSharedPorts("host-1", [4000]);
          throw new Error("candidate failed");
        }
      `,
    );
    await service.reload("atomic-shares");

    expect(service.getApi("atomic-shares")).toBe(previousApi);
    expect(sharedPorts.replaceDeclarationsForOwner).not.toHaveBeenCalled();
  });
});

describe("plugin bb.sdk against a running server", () => {
  it("binds a public provision result through claim, spawn, and replay", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "bb-claimed-spawn-public-"));
    try {
      const { host, session } = seedHostSession(server.deps, {
        id: "host-claimed-spawn-public",
      });
      registerTestHostRpcCapture(server, {
        hostId: host.id,
        sessionId: session.id,
      });
      const environmentPath = "/tmp/bb-claimed-spawn-public";
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: environmentPath,
      });
      const provisionRequest = {
        schema: "bb.environment-provision-request/v1",
        requestId: "provision-claimed-spawn-public",
        projectId: project.id,
        hostId: host.id,
        path: environmentPath,
        workspaceProvisionType: "unmanaged",
        isWorktree: false,
      } as const;
      const provisionPromise = server.app.request(
        "/api/v1/environment-provisions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(provisionRequest),
        },
      );
      const attach = await waitForQueuedCommand(
        server,
        ({ command }) => command.type === "environment.attach",
      );
      await reportQueuedCommandSuccess(server, attach, {
        path: environmentPath,
        isGitRepo: false,
        isWorktree: false,
        branchName: null,
        defaultBranch: null,
        transcript: [],
      });
      const provisionResponse = await provisionPromise;
      expect(provisionResponse.status).toBe(201);
      const provision = (await provisionResponse.json()) as {
        requestId: string;
        requestSha256: string;
        environment: { id: string };
      };

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-claimed-spawn-public",
        serverSource: claimPluginServerSource(
          "authority-claimed-spawn-public",
          host.id,
        ),
        hostSource: `
          const schema = { "~standard": { validate(value) { return { value }; } } };
          export default {
            experimental_apiVersion: 1,
            contract: { claim: { input: schema, output: schema } },
            handlers: { claim: (input) => input },
          };
        `,
      });
      await server.pluginService.installPath(rootDir);
      const api = requireApi(server.pluginService, "claimed-spawn-public");
      const args: ExperimentalClaimedThreadSpawnArgs = {
        bindingVersion: 2,
        authorityId: "authority-claimed-spawn-public",
        authorizationId: "authorization-claimed-spawn-public",
        claimId: "claim-claimed-spawn-public",
        attemptId: "attempt-claimed-spawn-public",
        environmentBinding: {
          type: "reuse",
          environmentId: provision.environment.id,
          projectId: project.id,
          hostId: host.id,
          canonicalPath: environmentPath,
          workspaceProvisionType: "unmanaged",
          isWorktree: false,
          provisionRequestId: provision.requestId,
          provisionRequestSha256: provision.requestSha256,
        },
        request: {
          schema: "bb.thread-spawn-request/v2",
          projectId: project.id,
          environment: {
            type: "reuse",
            environmentId: provision.environment.id,
          },
          prompt: "Execute the exact claimed request",
          title: null,
          providerId: "codex",
          model: null,
          reasoningLevel: null,
          permissionMode: "accept-edits",
          serviceTier: null,
        },
      };
      const spawnPromise =
        api.experimental_effects.experimental_spawnClaimed(args);
      const claim = await waitForQueuedCommand(
        server,
        ({ command }) =>
          command.type === "plugin.host.call" &&
          command.pluginId === "claimed-spawn-public" &&
          command.method === "claim",
      );
      if (claim.command.type !== "plugin.host.call") {
        throw new Error("Expected plugin.host.call command");
      }
      await reportQueuedCommandSuccess(server, claim, {
        output: currentClaimResult(claim.command.input),
      });

      const first = await spawnPromise;
      expect(first).toMatchObject({
        state: "completed",
        replay: false,
        thread: {
          projectId: project.id,
          environmentId: provision.environment.id,
          providerId: "codex",
        },
      });
      await expect(
        api.experimental_effects.experimental_spawnClaimed(args),
      ).resolves.toEqual({ ...first, replay: true });
      expect(server.db.select().from(claimedThreadSpawns).all()).toHaveLength(
        1,
      );
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });

  it("returns the server-side Standard Schema output after the host JSON wire", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-host-transform-"));
    try {
      const { host } = seedHostSession(server.deps, {
        id: "host-plugin-transform",
      });
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-host-transform",
        serverSource: `export default function plugin() {}`,
        hostSource: `
          const schema = { "~standard": { validate(value) { return { value }; } } };
          export default {
            experimental_apiVersion: 1,
            contract: { parseDate: { input: schema, output: schema } },
            handlers: { parseDate: (input) => input },
          };
        `,
      });
      await server.pluginService.installPath(rootDir);
      const inputDate = z.string().transform((value) => new Date(value));
      const outputDate = z.string().transform((value) => new Date(value));
      const contract = defineRpcContract({
        parseDate: {
          input: z.object({ when: inputDate }).strict(),
          output: outputDate,
        },
      });
      const client = requireApi(
        server.pluginService,
        "host-transform",
      ).hosts.experimental_client({ contract });
      const iso = "2026-08-16T12:34:56.000Z";

      const resultPromise = client.call(
        "parseDate",
        { when: iso },
        { hostId: host.id },
      );
      const command = await waitForQueuedCommand(
        server,
        ({ command }) =>
          command.type === "plugin.host.call" &&
          command.pluginId === "host-transform" &&
          command.method === "parseDate",
      );
      expect(command.command).toMatchObject({
        input: { when: iso },
        timeoutMs: 30_000,
      });
      expect(command.command).not.toHaveProperty("deadlineUnixMs");
      await reportQueuedCommandSuccess(server, command, { output: iso });

      await expect(resultPromise).resolves.toEqual(new Date(iso));
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });

  it("covers live plugin metadata routes, namespace validation, and lifecycle guards", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-metadata-live-"));
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-meta-owner",
        serverSource: `export default function plugin() {}`,
      });
      await server.pluginService.installPath(rootDir);
      const api = requireApi(server.pluginService, "meta-owner");
      const thread = createThread(server.db, server.deps.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "idle",
        originPluginId: "meta-owner",
      });
      const other = createThread(server.db, server.deps.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "idle",
        originPluginId: "meta-owner",
      });
      await expect(
        api.sdk.threads.getPluginMetadata({ threadId: thread.id }),
      ).resolves.toEqual({});
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { a: 1, nested: { old: true } },
        }),
      ).resolves.toEqual({ a: 1, nested: { old: true } });
      await expect(
        api.sdk.threads.getPluginMetadata({
          threadId: thread.id,
          pluginId: "cross",
        }),
      ).resolves.toEqual({});
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          pluginId: "cross",
          set: { b: 2 },
        }),
      ).resolves.toEqual({ b: 2 });
      await expect(
        api.sdk.threads.getPluginMetadata({ threadId: thread.id }),
      ).resolves.toEqual({ a: 1, nested: { old: true } });
      await expect(
        api.sdk.threads.getPluginMetadata({
          threadId: thread.id,
          pluginId: "cross",
        }),
      ).resolves.toEqual({ b: 2 });
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { nested: { next: true } },
          remove: ["a"],
        }),
      ).resolves.toEqual({ nested: { next: true } });
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { nullable: null },
        }),
      ).resolves.toEqual({ nested: { next: true }, nullable: null });
      await expect(
        api.sdk.threads.updatePluginMetadata({ threadId: thread.id }),
      ).resolves.toEqual({ nested: { next: true }, nullable: null });
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          remove: ["nested", "nullable"],
        }),
      ).resolves.toEqual({});
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { toJSON: "data", nested: { toJSON: 1 } },
        }),
      ).resolves.toEqual({ toJSON: "data", nested: { toJSON: 1 } });
      await expect(
        api.sdk.threads.getPluginMetadata({ threadId: thread.id }),
      ).resolves.toEqual({ toJSON: "data", nested: { toJSON: 1 } });
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          remove: ["toJSON", "nested"],
        }),
      ).resolves.toEqual({});
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { x: 1 },
          remove: ["x"],
        }),
      ).rejects.toMatchObject({
        name: "BbHttpError",
        status: 400,
        code: "invalid_request",
        message: expect.stringContaining("set and remove overlap"),
      });
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          remove: ["x", "x"],
        }),
      ).rejects.toMatchObject({
        name: "BbHttpError",
        status: 400,
        code: "invalid_request",
        message: expect.stringContaining("remove contains duplicate keys"),
      });
      const nearLimit = "x".repeat(262_100);
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { stable: true, nearLimit },
        }),
      ).resolves.toEqual({ stable: true, nearLimit });
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { smallAdditionalValue: "valid" },
        }),
      ).rejects.toMatchObject({
        name: "BbHttpError",
        status: 413,
        code: "invalid_request",
      });
      await expect(
        api.sdk.threads.getPluginMetadata({ threadId: thread.id }),
      ).resolves.toEqual({ stable: true, nearLimit });
      for (const status of ["active", "stopping"] as const) {
        const candidate = createThread(server.db, server.deps.hub, {
          projectId: project.id,
          environmentId: environment.id,
          providerId: "codex",
          status,
          originPluginId: "meta-owner",
        });
        await expect(
          api.sdk.threads.updatePluginMetadata({
            threadId: candidate.id,
            set: { status },
          }),
        ).resolves.toEqual({ status });
      }
      const archived = createThread(server.db, server.deps.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "idle",
        originPluginId: "meta-owner",
      });
      archiveThread(server.db, server.deps.hub, archived.id);
      await expect(
        api.sdk.threads.updatePluginMetadata({
          threadId: archived.id,
          set: { status: "archived" },
        }),
      ).resolves.toEqual({ status: "archived" });
      await expect(
        api.sdk.threads.getPluginMetadata({
          threadId: other.id,
          pluginId: "missing",
        }),
      ).resolves.toEqual({});
      markThreadDeleted(server.db, server.deps.hub, { threadId: other.id });
      await expect(
        api.sdk.threads.getPluginMetadata({ threadId: other.id }),
      ).rejects.toMatchObject({
        name: "BbHttpError",
        status: 404,
        code: "thread_not_found",
      });
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });

  it("fans out frozen metadata without restarting an active turn", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(
      join(tmpdir(), "bb-plugin-metadata-configure-"),
    );
    const observationGlobal = globalThis as typeof globalThis & {
      __bbMetadataSeen?: Record<string, unknown>[];
    };
    const takeObservations = () => {
      const observations = observationGlobal.__bbMetadataSeen ?? [];
      delete observationGlobal.__bbMetadataSeen;
      return observations;
    };
    try {
      const { host } = seedHostSession(server.deps);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const thread = createThread(server.db, server.deps.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "active",
      });
      const context = agentConfigurationContext(thread.id);
      const make = (name: string) =>
        writePlugin(workDir, {
          name: `bb-plugin-${name}`,
          serverSource: `
            function deepFrozen(value) {
              return value === null || typeof value !== "object" || (Object.isFrozen(value) && Object.values(value).every(deepFrozen));
            }
            export default function plugin(bb) {
              bb.agents.configure((context) => {
                globalThis.__bbMetadataSeen = globalThis.__bbMetadataSeen || [];
                globalThis.__bbMetadataSeen.push({ plugin: "${name}", metadata: context.pluginMetadata, deepFrozen: deepFrozen(context.pluginMetadata) });
                return { tools: [], skills: [] };
              });
            }
          `,
        });
      await server.pluginService.installPath(await make("alpha"));
      await server.pluginService.installPath(await make("beta"));
      await server.pluginService.installPath(await make("gamma"));
      await server.pluginService.installPath(
        await writePlugin(workDir, {
          name: "bb-plugin-delta",
          serverSource: `export default function plugin() {}`,
        }),
      );
      const alphaMetadata = {
        alpha: {
          own: true,
          levels: { deeper: { items: [{ leaf: "value" }, ["nested"]] } },
        },
      };
      insertThreadPluginMetadata(server.db, {
        threadId: thread.id,
        pluginId: "alpha",
        metadata: alphaMetadata,
      });
      insertThreadPluginMetadata(server.db, {
        threadId: thread.id,
        pluginId: "beta",
        metadata: { beta: { own: true } },
      });
      const result = await server.pluginService.resolveAgentConfiguration({
        context,
        skillIdsByPlugin: new Map(),
      });
      expect(result.tools).toEqual([]);
      const seen = takeObservations();
      expect(seen).toEqual([
        { plugin: "alpha", metadata: alphaMetadata, deepFrozen: true },
        {
          plugin: "beta",
          metadata: { beta: { own: true } },
          deepFrozen: true,
        },
        { plugin: "gamma", metadata: {}, deepFrozen: true },
      ]);
      const activeTurnSnapshot = seen[0]?.metadata;

      const alphaApi = requireApi(server.pluginService, "alpha");
      await expect(
        alphaApi.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { alpha: { own: false }, updated: true },
        }),
      ).resolves.toEqual({ alpha: { own: false }, updated: true });
      expect(observationGlobal.__bbMetadataSeen).toBeUndefined();
      expect(getThread(server.db, thread.id)?.status).toBe("active");
      expect(activeTurnSnapshot).toEqual(alphaMetadata);

      await server.pluginService.resolveAgentConfiguration({
        context,
        skillIdsByPlugin: new Map(),
      });
      expect(takeObservations()).toEqual(
        expect.arrayContaining([
          {
            plugin: "alpha",
            metadata: { alpha: { own: false }, updated: true },
            deepFrozen: true,
          },
        ]),
      );

      const secretMarker = "sk-live-SECRET-token-value";
      const writeCorruptRow = server.db.$client.prepare(
        "INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json) VALUES (?, ?, ?) ON CONFLICT (thread_id, plugin_id) DO UPDATE SET metadata_json = excluded.metadata_json",
      );
      for (const pluginId of ["alpha", "delta", "not-loaded"]) {
        writeCorruptRow.run(thread.id, pluginId, secretMarker);
      }
      const warn = vi.spyOn(server.deps.logger, "warn");
      try {
        const afterCorruption =
          await server.pluginService.resolveAgentConfiguration({
            context,
            skillIdsByPlugin: new Map(),
          });
        expect(afterCorruption).toEqual(result);
        expect(takeObservations()).toEqual([
          { plugin: "alpha", metadata: {}, deepFrozen: true },
          {
            plugin: "beta",
            metadata: { beta: { own: true } },
            deepFrozen: true,
          },
          { plugin: "gamma", metadata: {}, deepFrozen: true },
        ]);
        expect(warn.mock.calls).toEqual([
          [
            `Ignoring corrupt plugin metadata for thread ${thread.id}, plugin alpha`,
          ],
        ]);
        expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-live");
      } finally {
        warn.mockRestore();
      }

      await expect(
        alphaApi.sdk.threads.getPluginMetadata({ threadId: thread.id }),
      ).resolves.toEqual({});
      await expect(
        alphaApi.sdk.threads.updatePluginMetadata({
          threadId: thread.id,
          set: { repaired: true },
        }),
      ).resolves.toEqual({ repaired: true });
    } finally {
      delete observationGlobal.__bbMetadataSeen;
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });

  it("defers a configure provider registered during a pass to the next pass with its stored metadata", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(
      join(tmpdir(), "bb-plugin-metadata-late-configure-"),
    );
    const lateGlobal = globalThis as typeof globalThis & {
      __bbLateConfigureSeen?: unknown[];
      __bbRegisterLateConfigure?: () => void;
    };
    try {
      const { host } = seedHostSession(server.deps);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = createThread(server.db, server.deps.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "idle",
      });
      await server.pluginService.installPath(
        await writePlugin(workDir, {
          name: "bb-plugin-aaa-trigger",
          serverSource: `
            export default function plugin(bb) {
              bb.agents.configure(() => {
                Promise.resolve().then(() => globalThis.__bbRegisterLateConfigure?.());
                return { tools: [], skills: [] };
              });
            }
          `,
        }),
      );
      await server.pluginService.installPath(
        await writePlugin(workDir, {
          name: "bb-plugin-bbb-late",
          serverSource: `
            export default function plugin(bb) {
              globalThis.__bbRegisterLateConfigure = () => {
                delete globalThis.__bbRegisterLateConfigure;
                bb.agents.configure((context) => {
                  globalThis.__bbLateConfigureSeen = globalThis.__bbLateConfigureSeen || [];
                  globalThis.__bbLateConfigureSeen.push(context.pluginMetadata);
                  return { tools: [], skills: [] };
                });
              };
            }
          `,
        }),
      );
      insertThreadPluginMetadata(server.db, {
        threadId: thread.id,
        pluginId: "bbb-late",
        metadata: { own: true },
      });
      const context = agentConfigurationContext(thread.id);

      await server.pluginService.resolveAgentConfiguration({
        context,
        skillIdsByPlugin: new Map(),
      });
      expect(lateGlobal.__bbRegisterLateConfigure).toBeUndefined();
      expect(lateGlobal.__bbLateConfigureSeen).toBeUndefined();

      await server.pluginService.resolveAgentConfiguration({
        context,
        skillIdsByPlugin: new Map(),
      });
      expect(lateGlobal.__bbLateConfigureSeen).toEqual([{ own: true }]);
    } finally {
      delete lateGlobal.__bbLateConfigureSeen;
      delete lateGlobal.__bbRegisterLateConfigure;
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });

  it("keeps hidden plugin threads attributed and directly operable by id", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-live-"));
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/plugin-sdk-live-source",
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/plugin-sdk-live-source",
      });

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-spawner",
        serverSource: `export default function plugin() {}`,
      });
      const entry = await server.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");
      const api = requireApi(server.pluginService, "spawner");

      const projects = await api.sdk.projects.list();
      expect(projects.map((p) => p.id)).toContain(project.id);
      expect(projects.map((p) => p.id)).not.toContain(PERSONAL_PROJECT_ID);
      const projectsWithoutPersonal = await api.sdk.projects.list({
        includePersonal: false,
      });
      expect(projectsWithoutPersonal.map((p) => p.id)).toEqual([project.id]);

      const projectsWithPersonal = await api.sdk.projects.list({
        includePersonal: true,
      });
      expect(projectsWithPersonal.map((p) => p.id)).toEqual([
        PERSONAL_PROJECT_ID,
        project.id,
      ]);
      expect(
        await api.sdk.projects.get({ projectId: PERSONAL_PROJECT_ID }),
      ).toEqual(projectsWithPersonal[0]);
      const projectsWithThreadsAndPersonal = await api.sdk.projects.list({
        include: "threads",
        includePersonal: true,
      });
      expect(projectsWithThreadsAndPersonal.map((p) => p.id)).toEqual([
        PERSONAL_PROJECT_ID,
        project.id,
      ]);
      expect(projectsWithThreadsAndPersonal).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: PERSONAL_PROJECT_ID, threads: [] }),
          expect.objectContaining({ id: project.id, threads: [] }),
        ]),
      );

      const launchMarker = "plugin-metadata-private-marker";
      const thread = await api.sdk.threads.spawn({
        projectId: project.id,
        prompt: "spawned from a plugin",
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: "/tmp/plugin-sdk-live-source" },
        },
        origin: "sdk",
        originPluginId: "forged-plugin",
        pluginMetadata: {
          marker: launchMarker,
          nested: { attempt: 1 },
        },
        visibility: "hidden",
      });
      expect(thread.originPluginId).toBe("spawner");
      expect(thread.visibility).toBe("hidden");
      expect(thread).not.toHaveProperty("pluginMetadata");
      expect(getThread(server.db, thread.id)).toMatchObject({
        originPluginId: "spawner",
        visibility: "hidden",
      });
      await expect(
        api.sdk.threads.getPluginMetadata({ threadId: thread.id }),
      ).resolves.toEqual({ marker: launchMarker, nested: { attempt: 1 } });
      const pluginThread = await api.sdk.threads.get({ threadId: thread.id });
      expect(pluginThread).toMatchObject({
        id: thread.id,
        visibility: "hidden",
      });
      expect(JSON.stringify(pluginThread)).not.toContain(launchMarker);
      await expect(
        api.sdk.threads.wait({
          threadId: thread.id,
          status: "starting",
          timeoutMs: 100,
        }),
      ).resolves.toMatchObject({ matched: true, threadId: thread.id });
      await expect(
        api.sdk.threads.list({ projectId: project.id }),
      ).resolves.not.toContainEqual(expect.objectContaining({ id: thread.id }));
      const allThreads = await api.sdk.threads.list({
        projectId: project.id,
        includeHidden: true,
      });
      expect(allThreads).toContainEqual(
        expect.objectContaining({ id: thread.id }),
      );
      expect(JSON.stringify(allThreads)).not.toContain(launchMarker);

      const operable = createThread(server.db, server.deps.hub, {
        environmentId: environment.id,
        originPluginId: "spawner",
        pluginMetadata: {
          pluginId: "spawner",
          metadata: { marker: "source-plugin-metadata" },
        },
        projectId: project.id,
        providerId: "codex",
        status: "idle",
        visibility: "hidden",
      });
      seedThreadRuntimeState(server.deps, {
        environmentId: environment.id,
        inputText: "Initial turn",
        providerThreadId: "provider-hidden-plugin-thread",
        threadId: operable.id,
      });
      const forkMarker = "plugin-fork-context-private-marker";
      const fork = await api.sdk.threads.fork({
        sourceThreadId: operable.id,
        origin: "sdk",
        originPluginId: "forged-plugin",
        pluginMetadata: { marker: forkMarker, nested: { attempt: 2 } },
      });
      expect(fork).toMatchObject({
        originKind: "fork",
        originPluginId: "spawner",
        sourceThreadId: operable.id,
      });
      expect(fork).not.toHaveProperty("pluginMetadata");
      await expect(
        api.sdk.threads.getPluginMetadata({ threadId: fork.id }),
      ).resolves.toEqual({ marker: forkMarker, nested: { attempt: 2 } });
      const forkWithoutContext = await api.sdk.threads.fork({
        sourceThreadId: operable.id,
      });
      await expect(
        api.sdk.threads.getPluginMetadata({ threadId: forkWithoutContext.id }),
      ).resolves.toEqual({});
      await expect(
        api.sdk.threads.wait({
          threadId: operable.id,
          status: "idle",
          timeoutMs: 100,
        }),
      ).resolves.toMatchObject({ matched: true });
      await expect(
        api.sdk.threads.send({
          threadId: operable.id,
          mode: "auto",
          input: [{ type: "text", text: "Continue", mentions: [] }],
        }),
      ).resolves.toEqual({ ok: true, delivery: "sent" });
      const stopPromise = api.sdk.threads.stop({ threadId: operable.id });
      const stop = await waitForQueuedCommand(
        server,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === operable.id,
      );
      await reportQueuedCommandSuccess(server, stop, {
        providerCheckpointId: null,
      });
      await expect(stopPromise).resolves.toEqual({ ok: true });
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });
});

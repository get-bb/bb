import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProviderForId } from "./provider-registry.js";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import type { AgentRuntimeBridgeLaunch } from "./types.js";

const dynamicAcpLaunchSpec: HostDaemonAcpLaunchSpec = {
  displayName: "Custom ACP",
  command: "custom-agent",
  args: ["serve"],
  env: { CUSTOM_AGENT_TOKEN: "token" },
  cwd: "/agent-home",
  modelCli: {
    listArgs: ["models", "list"],
    selectFlag: "--model",
    primaryModels: ["model-a"],
  },
};

/** What the server sends for any acp-* id: the ACP plugin's artifact plus the
 * shared ACP tier capabilities. */
const ACP_BRIDGE_LAUNCH: AgentRuntimeBridgeLaunch = {
  pluginId: "provider-fixture",
  dataDir: "/data/plugins/provider-fixture/bridge-data",
  source: {
    kind: "artifact",
    digest: "e".repeat(64),
    artifactPath: "/data/provider-bridges/acp.mjs",
  },
  providerOptions: {
    acpLaunchSpec: {
      displayName: "Cursor",
      command: "cursor-agent",
      args: ["acp"],
      env: {},
    },
  },
  envPassthrough: [],
  capabilities: {
    experimental_providerInstallation: false,
    supportsServiceTier: true,
    permissionModes: ["accept-edits", "full"],
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "tip",
  },
};

/** What the server sends for Pi: the bridge inside the daemon's own bundle,
 * plus Pi's declared capabilities. */
const PI_BRIDGE_LAUNCH: AgentRuntimeBridgeLaunch = {
  pluginId: "provider-fixture",
  dataDir: "/data/plugins/provider-fixture/bridge-data",
  source: { kind: "daemon-bundled", id: "pi" },
  providerOptions: {},
  envPassthrough: [],
  capabilities: {
    experimental_providerInstallation: false,
    supportsServiceTier: false,
    permissionModes: ["full"],
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "checkpoint",
  },
};

/**
 * A bridge is never spawned directly any more: the runtime runs the bootstrap
 * and passes it the bridge module plus the plugin scope it must hand the
 * bridge. Assert that shape once, so each test states only what differs.
 */
function expectBridgeSpawn(
  provider: { process: { args: string[] } },
  expected: { module: string | RegExp; bundleDir?: string },
): void {
  const args = provider.process.args;
  expect(args.slice(-2)).toEqual([
    "provider-fixture",
    "/data/plugins/provider-fixture/bridge-data",
  ]);
  const moduleArg = args.at(-3) ?? "";
  if (typeof expected.module === "string") {
    expect(moduleArg).toBe(expected.module);
  } else {
    expect(moduleArg).toMatch(expected.module);
  }
  const workerArgs = args.slice(0, -3);
  if (expected.bundleDir === undefined) {
    expect(workerArgs.slice(0, 3)).toEqual([
      "--conditions=source",
      "--import",
      import.meta.resolve("tsx"),
    ]);
    expect(workerArgs.at(-1)).toMatch(/bridge-worker-entry\.ts$/u);
  } else {
    expect(workerArgs).toEqual([
      `${expected.bundleDir}/bb-provider-bridge-worker.mjs`,
    ]);
  }
}

describe("provider registry", () => {
  it("carries environment write roots to the acp bridge via provider options", () => {
    const provider = createProviderForId("acp-cursor", {
      additionalWorkspaceWriteRoots: ["/extra-root"],
      bridgeLaunch: ACP_BRIDGE_LAUNCH,
    });
    const plan = provider.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        providerOptions: {},
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      kind: "request",
      method: "thread/start",
      params: {
        options: {
          providerOptions: {
            additionalWorkspaceWriteRoots: ["/extra-root"],
          },
        },
      },
    });
  });

  it("passes the configured bridge bundle directory to bundled providers", () => {
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
      bridgeLaunch: PI_BRIDGE_LAUNCH,
    });

    expectBridgeSpawn(piProvider, {
      module: "/tmp/bb-pi-bridge.mjs",
      bundleDir: "/tmp",
    });
  });

  it("passes the configured bridge node runtime to bundled providers", () => {
    const bridgeNodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: PI_BRIDGE_LAUNCH,
      bridgeNodeEnv,
      bridgeNodeExecutablePath: "/Applications/bb.app/Contents/MacOS/bb",
    });
    const acpProvider = createProviderForId("acp-cursor", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: ACP_BRIDGE_LAUNCH,
      bridgeNodeEnv,
      bridgeNodeExecutablePath: "/Applications/bb.app/Contents/MacOS/bb",
    });

    expect(piProvider.process.command).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(piProvider.process.env).toEqual(bridgeNodeEnv);
    expect(acpProvider.process.command).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(acpProvider.process.env).toEqual(bridgeNodeEnv);
  });

  it("creates pi provider with expected process config", () => {
    const provider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: PI_BRIDGE_LAUNCH,
    });
    expect(provider.id).toBe("pi");
    expect(provider.process.command).toBe("node");
    expectBridgeSpawn(provider, {
      module: /agent-runtime\/src\/pi\/bridge\/bridge\.ts$/u,
    });
    expect(existsSync(provider.process.args.at(-3) ?? "")).toBe(true);
  });

  it("passes the requested workspace to Pi model listing", () => {
    const provider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: PI_BRIDGE_LAUNCH,
    });

    expect(
      provider.buildCommandPlan({
        type: "model/list",
        cwd: "/tmp/project",
      }),
    ).toEqual({
      kind: "request",
      method: "model/list",
      params: { cwd: "/tmp/project" },
    });
  });

  it("runs every acp id on the acp plugin's verified artifact", () => {
    // Only `acp-cursor` is plugin-declared; known and custom ACP agents are
    // resolved from launch specs at request time and never registered. The
    // server serves the ACP plugin's artifact for all of them, so the daemon
    // must route each one onto the generic artifact adapter.
    for (const providerId of ["acp-cursor", "acp-opencode", "acp-custom"]) {
      const provider = createProviderForId(providerId, {
        additionalWorkspaceWriteRoots: [],
        acpLaunchSpec: dynamicAcpLaunchSpec,
        bridgeLaunch: ACP_BRIDGE_LAUNCH,
      });
      expect(provider.id).toBe(providerId);
      expectBridgeSpawn(provider, {
        module: "/data/provider-bridges/acp.mjs",
      });
      // The declared "tip" ladder projects onto fork-yes / rewind-no.
      expect(provider.capabilities).toMatchObject({
        supportsServiceTier: true,
        supportsFork: true,
        supportsSessionRewind: false,
        permissionModes: ["accept-edits", "full"],
      });
    }
  });

  it("carries the plugin-declared cursor launch spec to the acp bridge", () => {
    const provider = createProviderForId("acp-cursor", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: ACP_BRIDGE_LAUNCH,
    });
    const plan = provider.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        providerOptions: {},
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      kind: "request",
      method: "thread/start",
      params: {
        options: {
          providerOptions: {
            acpLaunchSpec: {
              displayName: "Cursor",
              command: "cursor-agent",
              args: ["acp"],
            },
          },
        },
      },
    });
  });

  it("creates a dynamic acp provider from a launch spec", () => {
    const provider = createProviderForId("acp-custom", {
      additionalWorkspaceWriteRoots: ["/extra-root"],
      acpLaunchSpec: dynamicAcpLaunchSpec,
      bridgeLaunch: ACP_BRIDGE_LAUNCH,
    });

    expect(provider.id).toBe("acp-custom");
    // Model listing has no session, so the bridge only sees the static
    // provider options; the launch spec must ride them too.
    expect(provider.buildCommandPlan({ type: "model/list" })).toMatchObject({
      kind: "request",
      method: "model/list",
      params: {
        providerOptions: { acpLaunchSpec: dynamicAcpLaunchSpec },
      },
    });

    const startPlan = provider.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        providerOptions: {},
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
        envVars: { BB_THREAD_ID: "thread-1" },
      },
      instructionMode: "append",
    });
    expect(startPlan).toMatchObject({
      kind: "request",
      method: "thread/start",
      params: {
        options: {
          providerOptions: {
            acpLaunchSpec: dynamicAcpLaunchSpec,
            additionalWorkspaceWriteRoots: ["/extra-root"],
          },
        },
      },
    });
  });

  // Pi is the last bridge bb delivers in the daemon bundle: its launch names
  // that bundled bridge instead of carrying an artifact hash.
  it("routes pi to its bundled canonical bridge", () => {
    const provider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: PI_BRIDGE_LAUNCH,
    });

    expect(provider.process.command).toBe("node");
    const bridgeEntry = provider.process.args.at(-3) ?? "";
    expect(bridgeEntry).toMatch(/agent-runtime\/src\/pi\/bridge\/bridge\.ts$/u);
    expect(existsSync(bridgeEntry)).toBe(true);
  });

  // Every bridge-bound command carries a launch, so a missing one means the
  // caller has no bridge for this provider at all — not a lookup miss.
  it("rejects a provider with no bridge launch", () => {
    expect(() => createProviderForId("pi-mono")).toThrow(
      'Unsupported provider "pi-mono"',
    );
  });

  it("routes a plugin-delivered bridge artifact onto the generic adapter", () => {
    const provider = createProviderForId("echo-agent", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: {
        pluginId: "provider-fixture",
        dataDir: "/data/plugins/provider-fixture/bridge-data",
        providerOptions: {},
        envPassthrough: [],
        source: {
          kind: "artifact",
          digest: "a".repeat(64),
          artifactPath: "/data/provider-bridges/artifact.mjs",
        },
        capabilities: {
          experimental_providerInstallation: false,
          supportsServiceTier: false,
          permissionModes: ["full"],
          supportsThreadArchive: false,
          supportsThreadRename: false,
          fork: "none",
        },
      },
    });

    expect(provider.id).toBe("echo-agent");
    expect(provider.process.command).toBe("node");
    expectBridgeSpawn(provider, {
      module: "/data/provider-bridges/artifact.mjs",
    });
  });

  // Codex graduated onto this route, where its environment-level write roots
  // and its declared thread capabilities have to survive: both used to come
  // from the bundled-bridge branch this replaced. The write roots are a
  // host-local fact the server cannot supply at all, so the registry adds
  // them to the bridge's static provider options.
  it("carries environment write roots and declared capabilities onto an artifact bridge", () => {
    const provider = createProviderForId("codex", {
      additionalWorkspaceWriteRoots: ["/extra-root"],
      bridgeLaunch: {
        pluginId: "provider-fixture",
        dataDir: "/data/plugins/provider-fixture/bridge-data",
        providerOptions: {},
        envPassthrough: [],
        source: {
          kind: "artifact",
          digest: "b".repeat(64),
          artifactPath: "/data/provider-bridges/codex.mjs",
        },
        capabilities: {
          experimental_providerInstallation: false,
          supportsServiceTier: true,
          permissionModes: ["accept-edits", "auto", "full"],
          supportsThreadArchive: true,
          supportsThreadRename: true,
          fork: "checkpoint",
        },
      },
    });

    expect(provider.capabilities).toMatchObject({
      supportsThreadArchive: true,
      supportsThreadRename: true,
      supportsFork: true,
      supportsSessionRewind: true,
      supportsServiceTier: true,
      permissionModes: ["accept-edits", "auto", "full"],
    });
    const plan = provider.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        providerOptions: {},
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      kind: "request",
      method: "thread/start",
      params: {
        options: {
          providerOptions: {
            additionalWorkspaceWriteRoots: ["/extra-root"],
          },
        },
      },
    });
  });

  it("runs plugin bridge artifacts under the configured bridge node runtime", () => {
    const bridgeNodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
    const provider = createProviderForId("echo-agent", {
      additionalWorkspaceWriteRoots: [],
      bridgeNodeEnv,
      bridgeNodeExecutablePath: "/Applications/bb.app/Contents/MacOS/bb",
      bridgeLaunch: {
        pluginId: "provider-fixture",
        dataDir: "/data/plugins/provider-fixture/bridge-data",
        source: {
          kind: "artifact",
          digest: "b".repeat(64),
          artifactPath: "/data/provider-bridges/artifact.mjs",
        },
        providerOptions: {},
        envPassthrough: [],
        capabilities: {
          experimental_providerInstallation: false,
          supportsServiceTier: false,
          permissionModes: ["full"],
          supportsThreadArchive: false,
          supportsThreadRename: false,
          fork: "none",
        },
      },
    });
    expect(provider.process.command).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(provider.process.env).toEqual(bridgeNodeEnv);
  });

  // The launch source, not the provider id, decides which binary runs: the
  // server states the delivery path and the runtime obeys it. A first-party id
  // is no longer a special case here — reservation of first-party ids is
  // server-side policy, and the daemon has already verified the artifact bytes.
  it("runs the artifact a launch names even for a first-party id", () => {
    const provider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
      bridgeLaunch: {
        pluginId: "provider-fixture",
        dataDir: "/data/plugins/provider-fixture/bridge-data",
        source: {
          kind: "artifact",
          digest: "c".repeat(64),
          artifactPath: "/data/provider-bridges/graduated-pi.mjs",
        },
        providerOptions: {},
        envPassthrough: [],
        capabilities: PI_BRIDGE_LAUNCH.capabilities,
      },
    });
    expectBridgeSpawn(provider, {
      module: "/data/provider-bridges/graduated-pi.mjs",
      bundleDir: "/tmp",
    });
  });

  it("refuses a bundled bridge id the daemon does not ship", () => {
    expect(() =>
      createProviderForId("pi", {
        additionalWorkspaceWriteRoots: [],
        bridgeLaunch: {
          pluginId: "provider-fixture",
          dataDir: "/data/plugins/provider-fixture/bridge-data",
          providerOptions: {},
          envPassthrough: [],
          source: { kind: "daemon-bundled", id: "not-bundled" },
          capabilities: PI_BRIDGE_LAUNCH.capabilities,
        },
      }),
    ).toThrow(/"not-bundled" is not a bridge this daemon bundles/u);
  });

  it("honors a verified bridge launch for an id the registry does not know", () => {
    // The hash-verified artifact is its own routing authority: the server only
    // attaches a bridgeLaunch to providers it has routed onto the bridge
    // protocol, and the daemon has already verified the artifact bytes.
    const provider = createProviderForId("echo-agent", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: {
        pluginId: "provider-fixture",
        dataDir: "/data/plugins/provider-fixture/bridge-data",
        source: {
          kind: "artifact",
          digest: "d".repeat(64),
          artifactPath: "/data/provider-bridges/artifact.mjs",
        },
        providerOptions: {},
        envPassthrough: [],
        capabilities: {
          experimental_providerInstallation: false,
          supportsServiceTier: true,
          permissionModes: ["accept-edits", "full"],
          supportsThreadArchive: false,
          supportsThreadRename: false,
          fork: "none",
        },
      },
    });
    expectBridgeSpawn(provider, {
      module: "/data/provider-bridges/artifact.mjs",
    });
    // The transported declaration capabilities drive execution checks.
    expect(provider.capabilities.supportsServiceTier).toBe(true);
    expect(provider.capabilities.permissionModes).toEqual([
      "accept-edits",
      "full",
    ]);
  });
});

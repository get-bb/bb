import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProviderForId } from "./provider-registry.js";
import type { AgentRuntimeBridgeLaunch } from "./types.js";

const dynamicAcpLaunchSpec = {
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
    providerInstallation: false,
    supportsServiceTier: true,
    permissionModes: ["accept-edits", "full"],
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "tip",
  },
};

/** What the server sends for Pi: the provider-pi plugin's artifact, plus
 * Pi's declared capabilities. */
const PI_BRIDGE_LAUNCH: AgentRuntimeBridgeLaunch = {
  pluginId: "provider-fixture",
  dataDir: "/data/plugins/provider-fixture/bridge-data",
  source: {
    kind: "artifact",
    digest: "b".repeat(64),
    artifactPath: "/data/provider-bridges/pi.mjs",
  },
  providerOptions: {},
  envPassthrough: [],
  capabilities: {
    providerInstallation: false,
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

  it("runs the packaged bootstrap from the configured bridge bundle directory", () => {
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
      bridgeLaunch: PI_BRIDGE_LAUNCH,
    });

    expectBridgeSpawn(piProvider, {
      module: "/data/provider-bridges/pi.mjs",
      bundleDir: "/tmp",
    });
  });

  it("runs the bridge under the configured bridge node runtime", () => {
    const bridgeNodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
    const provider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: PI_BRIDGE_LAUNCH,
      bridgeNodeEnv,
      bridgeNodeExecutablePath: "/Applications/bb.app/Contents/MacOS/bb",
    });

    expect(provider.process.command).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(provider.process.env).toEqual(bridgeNodeEnv);
  });

  // A first-party id is no longer a special case here — reservation of
  // first-party ids is server-side policy, and the daemon has already
  // verified the artifact bytes.
  it("creates pi provider with expected process config", () => {
    const provider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: PI_BRIDGE_LAUNCH,
    });
    expect(provider.id).toBe("pi");
    expect(provider.process.command).toBe("node");
    expectBridgeSpawn(provider, { module: "/data/provider-bridges/pi.mjs" });
    expect(existsSync(provider.process.args.at(-4) ?? "")).toBe(true);
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
    // Every ACP agent — bb's known list and the ones a user configures in the
    // plugin's settings — is registered by the ACP plugin and carries that
    // plugin's artifact, so the daemon routes each one onto the generic
    // artifact adapter.
    for (const providerId of ["acp-cursor", "acp-opencode", "acp-custom"]) {
      const provider = createProviderForId(providerId, {
        additionalWorkspaceWriteRoots: [],
        bridgeLaunch: {
          ...ACP_BRIDGE_LAUNCH,
          providerOptions: { acpLaunchSpec: dynamicAcpLaunchSpec },
        },
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

  // A user-configured agent is a registration like any other: its launch
  // spec is declared bridge options, beside the host-local write roots.
  it("carries a configured acp agent's declared launch spec", () => {
    const provider = createProviderForId("acp-custom", {
      additionalWorkspaceWriteRoots: ["/extra-root"],
      bridgeLaunch: {
        ...ACP_BRIDGE_LAUNCH,
        providerOptions: { acpLaunchSpec: dynamicAcpLaunchSpec },
      },
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
          providerInstallation: false,
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

  // The launch source, not the provider id, decides which binary runs: the
  // server states the delivery path and the runtime obeys it.
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
          providerInstallation: false,
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

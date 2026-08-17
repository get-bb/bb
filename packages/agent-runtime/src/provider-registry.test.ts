import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
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
  sha256: "e".repeat(64),
  artifactPath: "/data/provider-bridges/acp.mjs",
  capabilities: {
    supportsServiceTier: true,
    supportedPermissionModes: ["accept-edits", "full"],
    supportsArchive: false,
    supportsRename: false,
    fork: "tip",
  },
};

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
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
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
    });

    expect(piProvider.process.args[0]).toBe("/tmp/bb-pi-bridge.mjs");
  });

  it("passes the configured bridge node runtime to bundled providers", () => {
    const bridgeNodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
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
    const provider = createProviderForId("pi");
    expect(provider.id).toBe("pi");
    expect(provider.process.command).toBe("node");
    expect(provider.process.args.slice(0, 3)).toEqual([
      "--conditions=source",
      "--import",
      import.meta.resolve("tsx"),
    ]);
    expect(provider.process.args.at(-1)).toMatch(
      /agent-runtime\/src\/pi\/bridge\/bridge\.ts$/,
    );
    expect(existsSync(provider.process.args.at(-1) ?? "")).toBe(true);
  });

  it("passes the requested workspace to Pi model listing", () => {
    const provider = createProviderForId("pi");

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
      expect(provider.process.args).toEqual(["/data/provider-bridges/acp.mjs"]);
      // The declared "tip" ladder projects onto fork-yes / rewind-no.
      expect(provider.capabilities).toMatchObject({
        supportsServiceTier: true,
        supportsFork: true,
        supportsSessionRewind: false,
        supportedPermissionModes: ["accept-edits", "full"],
      });
    }
  });

  it("carries the built-in cursor launch spec to the acp bridge", () => {
    // The server resolves launch specs only for configured and known ACP
    // agents; bb's own cursor provider has none, so the registry's built-in
    // table is the only thing that tells the bridge what to spawn — and it has
    // to survive the move onto the generic artifact route.
    const provider = createProviderForId("acp-cursor", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: ACP_BRIDGE_LAUNCH,
    });
    const plan = provider.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
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
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
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

  // Pi is the last bridge bb delivers in the daemon bundle: with no
  // bridgeLaunch it must still route to its canonical bridge source.
  it("routes pi to its bundled canonical bridge", () => {
    const provider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
    });

    expect(provider.process.command).toBe("node");
    const bridgeEntry = provider.process.args.at(-1) ?? "";
    expect(bridgeEntry).toMatch(/agent-runtime\/src\/pi\/bridge\/bridge\.ts$/);
    expect(existsSync(bridgeEntry)).toBe(true);
  });

  it("rejects unsupported adapters", () => {
    expect(() => createProviderForId("pi-mono")).toThrow(
      'Unsupported provider "pi-mono"',
    );
  });

  it("routes a plugin-delivered bridge artifact onto the generic adapter", () => {
    const provider = createProviderForId("echo-agent", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: {
        sha256: "a".repeat(64),
        artifactPath: "/data/provider-bridges/artifact.mjs",
        providerOptions: { echoPrefix: "echo:" },
        capabilities: {
          supportsServiceTier: false,
          supportedPermissionModes: ["full"],
          supportsArchive: false,
          supportsRename: false,
          fork: "none",
        },
      },
    });

    expect(provider.id).toBe("echo-agent");
    expect(provider.process.command).toBe("node");
    expect(provider.process.args).toEqual([
      "/data/provider-bridges/artifact.mjs",
    ]);

    // The plugin's static option bag rides every session command.
    const plan = provider.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
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
        options: { providerOptions: { echoPrefix: "echo:" } },
      },
    });
  });

  // Codex graduated onto this route, where its environment-level write roots
  // and its declared thread capabilities have to survive: both used to come
  // from the bundled-bridge branch this replaced. The write roots are a
  // host-local fact the server cannot put in providerOptions, so the registry
  // merges them in beside the plugin's own bag.
  it("carries environment write roots and declared capabilities onto an artifact bridge", () => {
    const provider = createProviderForId("codex", {
      additionalWorkspaceWriteRoots: ["/extra-root"],
      bridgeLaunch: {
        sha256: "b".repeat(64),
        artifactPath: "/data/provider-bridges/codex.mjs",
        capabilities: {
          supportsServiceTier: true,
          supportedPermissionModes: ["accept-edits", "auto", "full"],
          supportsArchive: true,
          supportsRename: true,
          fork: "checkpoint",
        },
      },
    });

    expect(provider.capabilities).toMatchObject({
      supportsArchive: true,
      supportsRename: true,
      supportsFork: true,
      supportsSessionRewind: true,
      supportsServiceTier: true,
      supportedPermissionModes: ["accept-edits", "auto", "full"],
    });
    const plan = provider.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
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
        sha256: "b".repeat(64),
        artifactPath: "/data/provider-bridges/artifact.mjs",
        capabilities: {
          supportsServiceTier: false,
          supportedPermissionModes: ["full"],
          supportsArchive: false,
          supportsRename: false,
          fork: "none",
        },
      },
    });
    expect(provider.process.command).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(provider.process.env).toEqual(bridgeNodeEnv);
  });

  it("keeps first-party bundled bridges untouched even when a bridge launch rides along", () => {
    const provider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
      bridgeLaunch: {
        sha256: "c".repeat(64),
        artifactPath: "/data/provider-bridges/never-used.mjs",
        capabilities: {
          supportsServiceTier: false,
          supportedPermissionModes: ["full"],
          supportsArchive: false,
          supportsRename: false,
          fork: "none",
        },
      },
    });
    expect(provider.process.args[0]).toBe("/tmp/bb-pi-bridge.mjs");
  });

  it("honors a verified bridge launch for an id the registry does not know", () => {
    // The hash-verified artifact is its own routing authority: the server only
    // attaches a bridgeLaunch to providers it has routed onto the bridge
    // protocol, and the daemon has already verified the artifact bytes.
    const provider = createProviderForId("echo-agent", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: {
        sha256: "d".repeat(64),
        artifactPath: "/data/provider-bridges/artifact.mjs",
        capabilities: {
          supportsServiceTier: true,
          supportedPermissionModes: ["accept-edits", "full"],
          supportsArchive: false,
          supportsRename: false,
          fork: "none",
        },
      },
    });
    expect(provider.process.args).toEqual([
      "/data/provider-bridges/artifact.mjs",
    ]);
    // The transported declaration capabilities drive execution checks.
    expect(provider.capabilities.supportsServiceTier).toBe(true);
    expect(provider.capabilities.supportedPermissionModes).toEqual([
      "accept-edits",
      "full",
    ]);
  });
});

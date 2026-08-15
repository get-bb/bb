import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import { createProviderForId } from "./provider-registry.js";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";

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

describe("provider registry", () => {
  it("passes the configured bridge bundle directory to the codex bridge", () => {
    const provider = createProviderForId("codex", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
    });
    expect(provider.process.args[0]).toBe("/tmp/bb-codex-bridge.mjs");
  });

  it("carries environment write roots to the codex bridge via provider options", () => {
    const provider = createProviderForId("codex", {
      additionalWorkspaceWriteRoots: ["/extra-root"],
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

  // Both providers are graduated, so neither needs an enabled prefix to reach
  // the canonical bridge.
  it.each([{ providerId: "claude-code" }, { providerId: "acp-cursor" }])(
    "carries environment write roots to the $providerId bridge via provider options",
    ({ providerId }) => {
      const provider = createProviderForId(providerId, {
        additionalWorkspaceWriteRoots: ["/extra-root"],
        bridgeProtocolProviderPrefixes: [],
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
    },
  );

  // The deleted legacy adapter was the only pin on what claude-code
  // advertises. The registry now hands the catalog entry straight to the
  // generic bridge adapter, and the server reads these to decide which
  // commands it may even send, so an accidental flip is silent.
  it("advertises the claude-code capability set on the canonical adapter", () => {
    expect(createProviderForId("claude-code").capabilities).toEqual({
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: true,
      supportsFork: true,
      supportedPermissionModes: ["accept-edits", "auto", "full"],
    });
  });

  it("creates claude-code provider with expected process config", () => {
    const provider = createProviderForId("claude-code");
    expect(provider.id).toBe("claude-code");
    expect(provider.process.command).toBe("node");
    expect(provider.process.args.slice(0, 3)).toEqual([
      "--conditions=source",
      "--import",
      import.meta.resolve("tsx"),
    ]);
    expect(provider.process.args.at(-1)).toMatch(
      /agent-runtime\/src\/claude-code\/bridge\/bridge\.ts$/,
    );
    expect(existsSync(provider.process.args.at(-1) ?? "")).toBe(true);
  });

  it("passes the configured bridge bundle directory to bundled providers", () => {
    const claudeProvider = createProviderForId("claude-code", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
    });
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
    });

    expect(claudeProvider.process.args[0]).toBe(
      "/tmp/bb-claude-code-bridge.mjs",
    );
    expect(piProvider.process.args[0]).toBe("/tmp/bb-pi-bridge.mjs");
  });

  it("passes the configured bridge node runtime to bundled providers", () => {
    const bridgeNodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
    const claudeProvider = createProviderForId("claude-code", {
      additionalWorkspaceWriteRoots: [],
      bridgeNodeEnv,
      bridgeNodeExecutablePath: "/Applications/bb.app/Contents/MacOS/bb",
    });
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeNodeEnv,
      bridgeNodeExecutablePath: "/Applications/bb.app/Contents/MacOS/bb",
    });
    const acpProvider = createProviderForId("acp-cursor", {
      additionalWorkspaceWriteRoots: [],
      bridgeNodeEnv,
      bridgeNodeExecutablePath: "/Applications/bb.app/Contents/MacOS/bb",
    });

    expect(claudeProvider.process.command).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(claudeProvider.process.env).toEqual(bridgeNodeEnv);
    expect(piProvider.process.command).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(piProvider.process.env).toEqual(bridgeNodeEnv);
    expect(acpProvider.process.command).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(acpProvider.process.env).toEqual(bridgeNodeEnv);
  });

  // The claude-code legacy adapter was the only in-process consumer of the
  // runtime's turn id prefix; graduated providers mint bb turn ids in their
  // bridge from the prefix on the wire. `shared/turn-state.test.ts` covers the
  // minting itself, and `claude-code/event-translation.test.ts` covers the
  // translator honoring the prefix.

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

  it("creates the acp cursor provider with the bridge process config", () => {
    const provider = createProviderForId("acp-cursor");
    expect(provider.id).toBe("acp-cursor");
    expect(provider.process.command).toBe("node");
    expect(provider.process.args.at(-1)).toMatch(
      /agent-runtime\/src\/acp\/bridge\/bridge\.ts$/,
    );
    expect(existsSync(provider.process.args.at(-1) ?? "")).toBe(true);
  });

  it("passes the configured bridge bundle directory to the acp provider", () => {
    const provider = createProviderForId("acp-cursor", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
    });
    expect(provider.process.args[0]).toBe("/tmp/bb-acp-bridge.mjs");
  });

  it("carries the built-in cursor launch spec to the acp bridge", () => {
    // The server resolves launch specs only for configured and known ACP
    // agents; the bundled cursor provider has none, so the registry's built-in
    // table is the only thing that tells the bridge what to spawn.
    const provider = createProviderForId("acp-cursor");
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
    });

    expect(provider.id).toBe("acp-custom");
    expect(provider.displayName).toBe("Custom ACP");
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

  // Every provider is graduated: no legacy adapter remains, so an empty prefix
  // list must still route each bundled id to its canonical bridge. This is the
  // regression that would fire if the retired experiment gate came back.
  it.each([
    { providerId: "codex", bridgeDir: "codex" },
    { providerId: "claude-code", bridgeDir: "claude-code" },
    { providerId: "pi", bridgeDir: "pi" },
    { providerId: "acp-custom", bridgeDir: "acp" },
  ])(
    "routes $providerId canonically without an enabled bridge prefix",
    ({ providerId, bridgeDir }) => {
      const provider = createProviderForId(providerId, {
        additionalWorkspaceWriteRoots: [],
        acpLaunchSpec: dynamicAcpLaunchSpec,
        bridgeProtocolProviderPrefixes: [],
      });

      expect(provider.process.command).toBe("node");
      const bridgeEntry = provider.process.args.at(-1) ?? "";
      expect(bridgeEntry).toMatch(
        new RegExp(`agent-runtime/src/${bridgeDir}/bridge/bridge\\.ts$`),
      );
      expect(existsSync(bridgeEntry)).toBe(true);
    },
  );

  it("rejects unsupported adapters", () => {
    expect(() => createProviderForId("pi-mono")).toThrow(
      'Unsupported provider "pi-mono"',
    );
  });

  it("routes a plugin-delivered bridge artifact onto the generic adapter", () => {
    const provider = createProviderForId("echo-agent", {
      additionalWorkspaceWriteRoots: [],
      bridgeProtocolProviderPrefixes: ["echo-agent"],
      bridgeLaunch: {
        sha256: "a".repeat(64),
        artifactPath: "/data/provider-bridges/artifact.mjs",
        providerOptions: { echoPrefix: "echo:" },
        capabilities: {
          supportsServiceTier: false,
          supportedPermissionModes: ["full"],
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

  it("runs plugin bridge artifacts under the configured bridge node runtime", () => {
    const bridgeNodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
    const provider = createProviderForId("echo-agent", {
      additionalWorkspaceWriteRoots: [],
      bridgeProtocolProviderPrefixes: ["echo-agent"],
      bridgeNodeEnv,
      bridgeNodeExecutablePath: "/Applications/bb.app/Contents/MacOS/bb",
      bridgeLaunch: {
        sha256: "b".repeat(64),
        artifactPath: "/data/provider-bridges/artifact.mjs",
        capabilities: {
          supportsServiceTier: false,
          supportedPermissionModes: ["full"],
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
      bridgeProtocolProviderPrefixes: ["pi"],
      bridgeBundleDir: "/tmp",
      bridgeLaunch: {
        sha256: "c".repeat(64),
        artifactPath: "/data/provider-bridges/never-used.mjs",
        capabilities: {
          supportsServiceTier: false,
          supportedPermissionModes: ["full"],
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
      bridgeProtocolProviderPrefixes: [],
      bridgeLaunch: {
        sha256: "d".repeat(64),
        artifactPath: "/data/provider-bridges/artifact.mjs",
        capabilities: {
          supportsServiceTier: true,
          supportedPermissionModes: ["accept-edits", "full"],
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

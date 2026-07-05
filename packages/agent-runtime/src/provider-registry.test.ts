import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  turnScope,
} from "@bb/domain";
import {
  createProviderForId,
  listAvailableProviderInfos,
} from "./provider-registry.js";
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
  it("creates codex provider with expected process config", () => {
    const provider = createProviderForId("codex");
    expect(provider.id).toBe("codex");
    expect(provider.process.command).toBe("codex");
    expect(provider.process.args).toMatchObject(["app-server"]);
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

  it("passes the configured turn id prefix to bundled providers", () => {
    const claudeProvider = createProviderForId("claude-code", {
      additionalWorkspaceWriteRoots: [],
      turnIdPrefix: "turn_runtime_",
    });
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      turnIdPrefix: "turn_runtime_",
    });

    const claudeEvents = claudeProvider.translateEvent({
      type: "assistant",
      message: {},
    });
    const piEvents = piProvider.translateEvent({
      type: "agent_start",
    });

    expect(claudeEvents).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn_runtime_1"),
      }),
    );
    expect(piEvents).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn_runtime_1"),
      }),
    );
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

  it("binds the acp cursor provider to its agent launch command", () => {
    const provider = createProviderForId("acp-cursor");
    const plan = provider.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
        permissionMode: "full",
        permissionEscalation: null,
      },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      kind: "request",
      method: "thread/start",
      params: {
        agent: { command: "agent", args: ["acp"] },
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
    const modelListPlan = provider.buildCommandPlan({ type: "model/list" });
    expect(modelListPlan).toMatchObject({
      kind: "request",
      method: "model/list",
      params: {
        listCommand: {
          command: "custom-agent",
          args: ["models", "list"],
          cwd: "/agent-home",
          envVars: { CUSTOM_AGENT_TOKEN: "token" },
        },
        primaryModels: ["model-a"],
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
        permissionEscalation: null,
        envVars: { BB_THREAD_ID: "thread-1" },
      },
      instructionMode: "append",
    });
    expect(startPlan).toMatchObject({
      kind: "request",
      method: "thread/start",
      params: {
        cwd: "/agent-home",
        agent: { command: "custom-agent", args: ["serve"] },
        envVars: {
          CUSTOM_AGENT_TOKEN: "token",
          BB_THREAD_ID: "thread-1",
        },
        workspaceWriteRoots: ["/agent-home", "/extra-root"],
      },
    });
  });

  it.each<[string, HostDaemonAcpLaunchSpec["modelCli"]]>([
    ["no model cli", undefined],
    [
      "empty model cli",
      { listArgs: [], selectFlag: "--model", primaryModels: ["model-a"] },
    ],
  ])(
    "uses ACP-native discovery and selection when a launch spec has %s",
    (_name, modelCli) => {
      const provider = createProviderForId("acp-custom", {
        additionalWorkspaceWriteRoots: [],
        acpLaunchSpec: {
          displayName: "Custom ACP",
          command: "custom-agent",
          args: ["serve"],
          env: {},
          ...(modelCli !== undefined ? { modelCli } : {}),
        },
      });

      const modelListPlan = provider.buildCommandPlan({ type: "model/list" });
      expect(modelListPlan).toEqual({
        kind: "request",
        method: "model/list",
        params: {
          agent: { command: "custom-agent", args: ["serve"] },
          primaryModels: [],
        },
      });

      const params =
        modelListPlan.kind === "request" ? modelListPlan.params : {};
      expect(params).not.toHaveProperty("listCommand");

      const startPlan = provider.buildCommandPlan({
        type: "thread/start",
        threadId: "thread-1",
        cwd: "/workspace",
        options: {
          claudeCodeMockCliTraffic:
            DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
          model: "requested-model",
        },
        instructionMode: "append",
      });
      expect(startPlan).toMatchObject({
        kind: "request",
        method: "thread/start",
        params: {
          agent: { command: "custom-agent", args: ["serve"] },
          modelSelection: { modelId: "requested-model" },
        },
      });
    },
  );

  it("rejects unsupported adapters", () => {
    expect(() => createProviderForId("pi-mono")).toThrow(
      'Unsupported provider "pi-mono"',
    );
  });

  it("lists provider catalog", () => {
    expect(listAvailableProviderInfos()).toMatchObject([
      {
        id: "codex",
        displayName: "Codex",
        capabilities: {
          supportsArchive: true,
          supportsRename: true,
          supportsServiceTier: true,
          supportsUserQuestion: false,
          supportsFork: true,
          supportedPermissionModes: ["full", "workspace-write", "readonly"],
        },
        available: true,
      },
      {
        id: "claude-code",
        displayName: "Claude Code",
        capabilities: {
          supportsArchive: false,
          supportsRename: false,
          supportsServiceTier: false,
          supportsUserQuestion: true,
          supportsFork: true,
          supportedPermissionModes: ["full", "workspace-write", "readonly"],
        },
        available: true,
      },
      {
        id: "pi",
        displayName: "Pi",
        capabilities: {
          supportsArchive: false,
          supportsRename: false,
          supportsServiceTier: false,
          supportsUserQuestion: false,
          supportsFork: true,
          supportedPermissionModes: ["full"],
        },
        available: true,
      },
      { id: "acp-cursor", displayName: "Cursor", available: true },
    ]);
  });
});

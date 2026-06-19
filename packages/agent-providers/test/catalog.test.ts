import { describe, expect, it } from "vitest";
import {
  getBuiltInAgentProviderInfo,
  getBuiltInAgentProviderServerCapabilities,
  isAcpAgentProviderId,
  listBuiltInAgentProviderInfos,
  PI_DEFAULT_MODEL_PER_PROVIDER,
  resolvePiDefaultModelId,
} from "../src/index.js";

describe("agent provider catalog", () => {
  it("lists built-in providers with shared display metadata", () => {
    expect(listBuiltInAgentProviderInfos()).toEqual([
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
        composerActions: [
          { kind: "skills", trigger: "/" },
          {
            kind: "plan",
            command: { trigger: "/", name: "plan", trailingText: " " },
          },
          {
            kind: "goal",
            command: { trigger: "/", name: "goal", trailingText: " " },
          },
        ],
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
        composerActions: [
          { kind: "skills", trigger: "/" },
          {
            kind: "plan",
            command: { trigger: "/", name: "plan", trailingText: " " },
          },
        ],
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
        composerActions: [],
        available: true,
      },
      {
        id: "acp-cursor",
        displayName: "Cursor",
        capabilities: {
          supportsArchive: false,
          supportsRename: false,
          supportsServiceTier: false,
          supportsUserQuestion: false,
          supportsFork: false,
          supportedPermissionModes: ["full", "workspace-write", "readonly"],
        },
        composerActions: [],
        available: true,
      },
    ]);
  });

  it("classifies ACP provider ids", () => {
    expect(isAcpAgentProviderId("acp-cursor")).toBe(true);
    expect(isAcpAgentProviderId("codex")).toBe(false);
    expect(isAcpAgentProviderId("claude-code")).toBe(false);
    expect(isAcpAgentProviderId("pi")).toBe(false);
  });

  it("declares the backend-only server capability facts per provider", () => {
    expect(getBuiltInAgentProviderServerCapabilities("codex")).toEqual({
      supportsWorkflows: false,
      supportsExecutionOverride: false,
      backsHostDaemonAiServices: true,
      reasoningLevels: ["low", "medium", "high", "xhigh"],
    });
    expect(getBuiltInAgentProviderServerCapabilities("claude-code")).toEqual({
      supportsWorkflows: true,
      supportsExecutionOverride: true,
      backsHostDaemonAiServices: false,
      reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
    });
    expect(getBuiltInAgentProviderServerCapabilities("pi")).toEqual({
      supportsWorkflows: false,
      supportsExecutionOverride: false,
      backsHostDaemonAiServices: false,
      reasoningLevels: ["low", "medium", "high", "xhigh"],
    });
    expect(getBuiltInAgentProviderServerCapabilities("acp-cursor")).toEqual({
      supportsWorkflows: false,
      supportsExecutionOverride: false,
      backsHostDaemonAiServices: false,
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    });
  });

  it("returns cloned catalog entries", () => {
    const provider = getBuiltInAgentProviderInfo("codex");
    provider.displayName = "Mutated";
    provider.capabilities.supportedPermissionModes.push("full");
    provider.composerActions.push({
      kind: "goal",
      command: { trigger: "/", name: "mutated", trailingText: " " },
    });
    const skillsAction = provider.composerActions.find(
      (action) => action.kind === "skills",
    );
    if (!skillsAction) {
      throw new Error("Expected codex to declare a skills action");
    }
    skillsAction.trigger = "/";

    expect(getBuiltInAgentProviderInfo("codex")).toMatchObject({
      displayName: "Codex",
      capabilities: {
        supportedPermissionModes: ["full", "workspace-write", "readonly"],
      },
      composerActions: [
        { kind: "skills", trigger: "/" },
        {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: " " },
        },
        {
          kind: "goal",
          command: { trigger: "/", name: "goal", trailingText: " " },
        },
      ],
    });
  });

  it("exposes pi default model declarations", () => {
    expect(PI_DEFAULT_MODEL_PER_PROVIDER["openai-codex"]).toBe("gpt-5.5");
    expect(resolvePiDefaultModelId("anthropic")).toBe("claude-opus-4-8");
    expect(resolvePiDefaultModelId("amazon-bedrock")).toBe(
      "us.anthropic.claude-opus-4-8",
    );
    expect(resolvePiDefaultModelId("vercel-ai-gateway")).toBe(
      "anthropic/claude-opus-4.8",
    );
  });
});

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

    expect(getBuiltInAgentProviderInfo("codex").displayName).toBe("Codex");
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

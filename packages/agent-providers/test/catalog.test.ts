import { describe, expect, it } from "vitest";
import {
  getBuiltInAgentProviderInfo,
  getBuiltInAgentProviderServerCapabilities,
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
          supportedPermissionModes: ["full"],
        },
        available: true,
      },
    ]);
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

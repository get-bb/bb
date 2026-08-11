import { describe, expect, it } from "vitest";
import {
  buildAcpProviderInfo,
  getAcpProviderServerCapabilities,
  getAgentProviderServerCapabilities,
  getBuiltInAgentProviderInfo,
  getBuiltInAgentProviderServerCapabilities,
  isAcpAgentProviderId,
  isAcpProviderId,
  supportsManualCompaction,
} from "../src/index.js";

describe("agent provider catalog", () => {
  it("classifies ACP provider ids", () => {
    expect(isAcpAgentProviderId("acp-cursor")).toBe(true);
    expect(isAcpAgentProviderId("codex")).toBe(false);
    expect(isAcpAgentProviderId("claude-code")).toBe(false);
    expect(isAcpAgentProviderId("pi")).toBe(false);

    expect(isAcpProviderId("acp-cursor")).toBe(true);
    expect(isAcpProviderId("acp-my-agent")).toBe(true);
    expect(isAcpProviderId("codex")).toBe(false);
  });

  it("advertises manual compaction only for providers with a concrete control", () => {
    expect(supportsManualCompaction("codex")).toBe(true);
    expect(supportsManualCompaction("claude-code")).toBe(true);
    expect(supportsManualCompaction("pi")).toBe(true);
    expect(supportsManualCompaction("acp-cursor")).toBe(false);
    expect(supportsManualCompaction("acp-custom")).toBe(false);
    expect(supportsManualCompaction("acp-opencode")).toBe(true);
  });

  it("synthesizes dynamic ACP provider metadata with shared ACP policy", () => {
    expect(
      buildAcpProviderInfo({
        id: "acp-my-agent",
        displayName: "My Agent",
        logoUrl: null,
      }),
    ).toEqual({
      id: "acp-my-agent",
      displayName: "My Agent",
      logoUrl: null,
      capabilities: {
        supportsArchive: false,
        supportsRename: false,
        supportsServiceTier: true,
        supportsUserQuestion: false,
        supportsFork: false,
        supportedPermissionModes: ["accept-edits", "full"],
      },
      composerActions: [{ kind: "skills", trigger: "/" }],
      available: true,
    });

    expect(getAcpProviderServerCapabilities("acp-my-agent")).toEqual({
      supportsWorkflows: false,
      supportsExecutionOverride: false,
      backsHostDaemonAiServices: false,
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(getAgentProviderServerCapabilities("acp-my-agent")).toEqual(
      getAcpProviderServerCapabilities("acp-my-agent"),
    );
    expect(getAgentProviderServerCapabilities("not-a-provider")).toBeNull();
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
        supportedPermissionModes: ["accept-edits", "auto", "full"],
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

  it("keeps built-in accessors built-in-only", () => {
    expect(() => getBuiltInAgentProviderInfo("acp-my-agent" as never)).toThrow(
      /Unsupported agent provider/u,
    );
    expect(() =>
      getBuiltInAgentProviderServerCapabilities("acp-my-agent" as never),
    ).toThrow(/Unsupported agent provider/u);
  });
});

import { describe, expect, it } from "vitest";
import {
  formatCustomAcpAgentProviderId,
  parseBbAppManagedConfig,
} from "../src/bb-app-managed-config.js";

function parseWithWarnings(rawConfig: unknown) {
  const warnings: Record<string, unknown>[] = [];
  const parsed = parseBbAppManagedConfig(rawConfig, {
    logger: {
      warn(fields): void {
        warnings.push(fields);
      },
    },
  });
  return { parsed, warnings };
}

describe("parseBbAppManagedConfig", () => {
  it("parses shared user and project skill roots", () => {
    expect(
      parseBbAppManagedConfig({
        sharedSkillRoots: {
          user: [".agents/skills"],
          project: [".agents/skills"],
        },
      }).sharedSkillRoots,
    ).toEqual({
      user: [".agents/skills"],
      project: [".agents/skills"],
    });
  });

  it("parses custom models with a known provider", () => {
    const parsed = parseBbAppManagedConfig({
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-example-preview[1m]",
          displayName: "Example Preview (1M)",
        },
        { providerId: "pi", model: "anthropic/claude-example-preview" },
      ],
    });

    expect(parsed.customModels).toHaveLength(2);
    expect(parsed.customModels?.[0]?.providerId).toBe("claude-code");
    expect(parsed.customModels?.[1]?.displayName).toBeUndefined();
  });

  it("parses custom models with dynamic ACP provider ids", () => {
    const parsed = parseBbAppManagedConfig({
      customModels: [
        {
          providerId: "acp-opencode",
          model: "my-proxy/custom-model",
          displayName: "My Proxy Custom Model",
        },
        { providerId: "acp-my-agent", model: "provider/model" },
      ],
    });

    expect(parsed.customModels).toHaveLength(2);
    expect(parsed.customModels?.[0]?.providerId).toBe("acp-opencode");
    expect(parsed.customModels?.[1]?.providerId).toBe("acp-my-agent");
  });

  it("drops malformed acp-* custom model provider ids with a warning", () => {
    for (const providerId of ["acp-", "acp-Bad-Agent", "acp--x"]) {
      const { parsed, warnings } = parseWithWarnings({
        customModels: [{ providerId, model: "provider/model" }],
      });
      expect(parsed.customModels).toEqual([]);
      expect(warnings).toHaveLength(1);
    }
  });

  it("drops invalid custom model entries with warnings at the config boundary", () => {
    const { parsed, warnings } = parseWithWarnings({
      customModels: [
        { providerId: "acp-opencode", model: "my-proxy/custom-model" },
        { providerId: "not-a-provider", model: "other-model" },
        { providerId: "claude-code", model: "" },
      ],
    });

    expect(parsed.customModels).toEqual([
      { providerId: "acp-opencode", model: "my-proxy/custom-model" },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.index)).toEqual([1, 2]);
  });

  it("drops custom models with an unknown provider", () => {
    const { parsed, warnings } = parseWithWarnings({
      customModels: [
        { providerId: "not-a-provider", model: "claude-example-preview" },
      ],
    });

    expect(parsed.customModels).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.index).toBe(0);
    expect(warnings[0]?.error).toMatch(/"providerId"/u);
  });

  it("drops custom models with an empty model id", () => {
    const { parsed, warnings } = parseWithWarnings({
      customModels: [{ providerId: "claude-code", model: "" }],
    });

    expect(parsed.customModels).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("parses custom ACP agents, applies local defaults, and drops empty modelCli", () => {
    const parsed = parseBbAppManagedConfig({
      customAcpAgents: [
        {
          id: "my-agent",
          displayName: "My Agent",
          command: "my-agent",
          modelCli: {},
        },
      ],
    });

    expect(parsed.customAcpAgents).toEqual([
      {
        id: "my-agent",
        displayName: "My Agent",
        command: "my-agent",
        args: [],
        env: {},
        supportsManualCompaction: false,
      },
    ]);
    expect(formatCustomAcpAgentProviderId("my-agent")).toBe("acp-my-agent");
  });

  it("keeps non-empty custom ACP modelCli config", () => {
    const parsed = parseBbAppManagedConfig({
      customAcpAgents: [
        {
          id: "my-agent",
          displayName: "My Agent",
          command: "my-agent",
          modelCli: {
            listArgs: ["models"],
            selectFlag: "--model",
            primaryModels: ["model-a"],
          },
        },
      ],
    });

    expect(parsed.customAcpAgents?.[0]).toEqual({
      id: "my-agent",
      displayName: "My Agent",
      command: "my-agent",
      args: [],
      env: {},
      supportsManualCompaction: false,
      modelCli: {
        listArgs: ["models"],
        selectFlag: "--model",
        primaryModels: ["model-a"],
      },
    });
  });

  it("keeps a supported custom ACP logo path", () => {
    const parsed = parseBbAppManagedConfig({
      customAcpAgents: [
        {
          id: "my-agent",
          displayName: "My Agent",
          command: "my-agent",
          logo: "agent-logos/my-agent.svg",
        },
      ],
    });

    expect(parsed.customAcpAgents?.[0]?.logo).toBe("agent-logos/my-agent.svg");
  });

  it("drops a custom ACP agent with an unsupported logo format", () => {
    const { parsed, warnings } = parseWithWarnings({
      customAcpAgents: [
        {
          id: "my-agent",
          displayName: "My Agent",
          command: "my-agent",
          logo: "agent-logos/my-agent.gif",
        },
      ],
    });

    expect(parsed.customAcpAgents).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("keeps custom ACP reasoningCli config", () => {
    const parsed = parseBbAppManagedConfig({
      customAcpAgents: [
        {
          id: "my-agent",
          displayName: "My Agent",
          command: "my-agent",
          reasoningCli: {
            flag: "--reasoning-effort",
            supportedLevels: ["low", "medium", "high"],
            levelValues: { max: "high" },
            defaultLevel: "high",
          },
        },
      ],
    });

    expect(parsed.customAcpAgents?.[0]).toEqual({
      id: "my-agent",
      displayName: "My Agent",
      command: "my-agent",
      args: [],
      env: {},
      supportsManualCompaction: false,
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { max: "high" },
        defaultLevel: "high",
      },
    });
  });

  it("keeps custom ACP nativeReasoning config", () => {
    const parsed = parseBbAppManagedConfig({
      customAcpAgents: [
        {
          id: "my-agent",
          displayName: "My Agent",
          command: "my-agent",
          nativeReasoning: {
            configId: "reasoning_effort",
            supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
            defaultLevel: "medium",
          },
        },
      ],
    });

    expect(parsed.customAcpAgents?.[0]).toEqual({
      id: "my-agent",
      displayName: "My Agent",
      command: "my-agent",
      args: [],
      env: {},
      supportsManualCompaction: false,
      nativeReasoning: {
        configId: "reasoning_effort",
        supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultLevel: "medium",
      },
    });
  });

  it("keeps portable custom ACP native skill roots", () => {
    const parsed = parseBbAppManagedConfig({
      customAcpAgents: [
        {
          id: "amp",
          displayName: "Amp",
          command: "amp-acp",
          nativeSkillRoots: {
            user: [".agents/skills"],
            project: [".agents/skills", ".amp/skills"],
          },
        },
      ],
    });

    expect(parsed.customAcpAgents?.[0]?.nativeSkillRoots).toEqual({
      user: [".agents/skills"],
      project: [".agents/skills", ".amp/skills"],
    });
  });

  it("drops custom ACP agents with unsafe native skill roots", () => {
    for (const root of ["/tmp/skills", "../skills", "skills/../other"]) {
      const { parsed, warnings } = parseWithWarnings({
        customAcpAgents: [
          {
            id: "amp",
            displayName: "Amp",
            command: "amp-acp",
            nativeSkillRoots: { user: [root] },
          },
        ],
      });
      expect(parsed.customAcpAgents).toEqual([]);
      expect(warnings).toHaveLength(1);
    }
  });

  it("refuses the removed `absolute` side by name on sharedSkillRoots and on a custom ACP agent", () => {
    expect(() =>
      parseBbAppManagedConfig({
        sharedSkillRoots: { user: [], project: [], absolute: ["/srv/skills"] },
      }),
    ).toThrow(/Unrecognized key/u);

    const { parsed, warnings } = parseWithWarnings({
      customAcpAgents: [
        {
          id: "amp",
          displayName: "Amp",
          command: "amp-acp",
          nativeSkillRoots: {
            user: [".amp/skills"],
            absolute: ["/srv/skills"],
          },
        },
      ],
    });
    expect(parsed.customAcpAgents).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.index).toBe(0);
    expect(warnings[0]?.error).toMatch(/Unrecognized key: \\"absolute\\"/u);
  });

  it("drops custom ACP reasoningCli defaults outside supported levels", () => {
    const { parsed, warnings } = parseWithWarnings({
      customAcpAgents: [
        {
          id: "my-agent",
          displayName: "My Agent",
          command: "my-agent",
          reasoningCli: {
            flag: "--reasoning-effort",
            supportedLevels: ["low", "medium"],
            defaultLevel: "high",
          },
        },
      ],
    });

    expect(parsed.customAcpAgents).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("drops custom ACP agents with invalid ids, missing commands, collisions, and duplicates", () => {
    const { parsed, warnings } = parseWithWarnings({
      customAcpAgents: [
        { id: "Bad-Agent", displayName: "Bad", command: "bad" },
        { id: "missing-command", displayName: "Missing" },
        { id: "cursor", displayName: "Cursor Collision", command: "agent" },
        { id: "one", displayName: "One", command: "one" },
        { id: "one", displayName: "Duplicate", command: "duplicate" },
      ],
    });

    expect(parsed.customAcpAgents?.map((agent) => agent.displayName)).toEqual([
      "One",
    ]);
    expect(warnings.map((warning) => warning.index)).toEqual([0, 1, 2, 4]);
  });

  it("drops invalid custom ACP agent entries with warnings at the config boundary", () => {
    const { parsed, warnings } = parseWithWarnings({
      customAcpAgents: [
        { id: "good", displayName: "Good", command: "good" },
        { id: "bad id", displayName: "Bad", command: "bad" },
        { id: "good", displayName: "Duplicate", command: "duplicate" },
        { id: "cursor", displayName: "Cursor Collision", command: "agent" },
      ],
    });

    expect(parsed.customAcpAgents).toEqual([
      {
        id: "good",
        displayName: "Good",
        command: "good",
        args: [],
        env: {},
        supportsManualCompaction: false,
      },
    ]);
    expect(warnings).toHaveLength(3);
    expect(warnings.map((warning) => warning.index)).toEqual([1, 2, 3]);
  });
});

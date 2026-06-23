import { describe, expect, it } from "vitest";
import {
  bbAppManagedConfigSchema,
  formatCustomAcpAgentProviderId,
  parseBbAppManagedConfig,
} from "../src/bb-app-managed-config.js";

describe("bbAppManagedConfigSchema", () => {
  it("parses custom models with a known provider", () => {
    const parsed = bbAppManagedConfigSchema.parse({
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

  it("rejects custom models with an unknown provider", () => {
    const result = bbAppManagedConfigSchema.safeParse({
      customModels: [
        { providerId: "not-a-provider", model: "claude-example-preview" },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        "customModels",
        0,
        "providerId",
      ]);
    }
  });

  it("rejects custom models with an empty model id", () => {
    const result = bbAppManagedConfigSchema.safeParse({
      customModels: [{ providerId: "claude-code", model: "" }],
    });

    expect(result.success).toBe(false);
  });

  it("parses custom ACP agents, applies local defaults, and drops empty modelCli", () => {
    const parsed = bbAppManagedConfigSchema.parse({
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
      },
    ]);
    expect(formatCustomAcpAgentProviderId("my-agent")).toBe("acp-my-agent");
  });

  it("keeps non-empty custom ACP modelCli config", () => {
    const parsed = bbAppManagedConfigSchema.parse({
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
      modelCli: {
        listArgs: ["models"],
        selectFlag: "--model",
        primaryModels: ["model-a"],
      },
    });
  });

  it("rejects custom ACP agents with invalid ids, missing commands, collisions, and duplicates", () => {
    expect(
      bbAppManagedConfigSchema.safeParse({
        customAcpAgents: [
          { id: "Bad-Agent", displayName: "Bad", command: "bad" },
        ],
      }).success,
    ).toBe(false);
    expect(
      bbAppManagedConfigSchema.safeParse({
        customAcpAgents: [{ id: "missing-command", displayName: "Missing" }],
      }).success,
    ).toBe(false);
    expect(
      bbAppManagedConfigSchema.safeParse({
        customAcpAgents: [
          { id: "cursor", displayName: "Cursor Collision", command: "agent" },
        ],
      }).success,
    ).toBe(false);
    expect(
      bbAppManagedConfigSchema.safeParse({
        customAcpAgents: [
          { id: "one", displayName: "One", command: "one" },
          { id: "one", displayName: "Duplicate", command: "duplicate" },
        ],
      }).success,
    ).toBe(false);
  });

  it("drops invalid custom ACP agent entries with warnings at the config boundary", () => {
    const warnings: Record<string, unknown>[] = [];
    const parsed = parseBbAppManagedConfig(
      {
        customAcpAgents: [
          { id: "good", displayName: "Good", command: "good" },
          { id: "bad id", displayName: "Bad", command: "bad" },
          { id: "good", displayName: "Duplicate", command: "duplicate" },
          { id: "cursor", displayName: "Cursor Collision", command: "agent" },
        ],
      },
      {
        logger: {
          warn(fields): void {
            warnings.push(fields);
          },
        },
      },
    );

    expect(parsed.customAcpAgents).toEqual([
      {
        id: "good",
        displayName: "Good",
        command: "good",
        args: [],
        env: {},
      },
    ]);
    expect(warnings).toHaveLength(3);
    expect(warnings.map((warning) => warning.index)).toEqual([1, 2, 3]);
  });
});

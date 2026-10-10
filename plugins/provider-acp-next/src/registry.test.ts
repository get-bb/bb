import { describe, expect, it } from "vitest";
import { parseCustomAcpAgents } from "./agents.js";
import {
  describeRegistryAgents,
  parseAcpRegistry,
  registryAgentCustomEntry,
  settingWithRegistryAgent,
  settingWithoutAgent,
} from "./registry.js";

const REGISTRY = {
  version: "1.0.0",
  agents: [
    {
      id: "claude-acp",
      name: "Claude Agent",
      version: "0.88.0",
      description: "ACP wrapper for Anthropic's Claude",
      repository: "https://github.com/agentclientprotocol/claude-agent-acp",
      authors: ["Anthropic"],
      license: "proprietary",
      distribution: {
        npx: { package: "@agentclientprotocol/claude-agent-acp@0.88.0" },
      },
    },
    {
      id: "auggie",
      name: "Auggie CLI",
      version: "0.36.0",
      distribution: {
        npx: {
          package: "@augmentcode/auggie@0.36.0",
          args: ["--acp"],
          env: { AUGMENT_DISABLE_AUTO_UPDATE: "1" },
        },
      },
    },
    {
      id: "fast-agent",
      name: "fast-agent",
      version: "0.4.0",
      distribution: { uvx: { package: "fast-agent-acp==0.4.0", args: ["-x"] } },
    },
    {
      id: "codex-bin",
      name: "Codex binary",
      version: "1.0.0",
      distribution: {
        binary: {
          "linux-x86_64": { archive: "https://example.test/a.tgz", cmd: "./a" },
          "darwin-aarch64": {
            archive: "https://example.test/b.tgz",
            cmd: "./b",
          },
        },
      },
    },
    { id: "Not A Slug", name: "Bad id", version: "1.0.0", distribution: {} },
    { id: "auggie", name: "Duplicate", version: "9.9.9", distribution: {} },
    {
      id: "bad-env",
      name: "Bad env",
      version: "1.0.0",
      distribution: { npx: { package: "x", env: { "NOT VALID": "1" } } },
    },
    "garbage",
  ],
};

function agent(id: string) {
  const found = parseAcpRegistry(REGISTRY).agents.find(
    (candidate) => candidate.id === id,
  );
  if (found === undefined) {
    throw new Error(`fixture has no ${id}`);
  }
  return found;
}

describe("ACP registry", () => {
  it("keeps well-formed agents and skips malformed, duplicate and unsafe entries one by one", () => {
    const parsed = parseAcpRegistry(REGISTRY);
    expect(parsed.agents.map((entry) => entry.id)).toEqual([
      "claude-acp",
      "auggie",
      "fast-agent",
      "codex-bin",
    ]);
    expect(parsed.skipped).toBe(4);
    expect(agent("codex-bin")).toMatchObject({
      launch: null,
      binaryPlatforms: ["darwin-aarch64", "linux-x86_64"],
    });
    expect(() => parseAcpRegistry({ nope: true })).toThrow(
      "not a registry document",
    );
  });

  it("turns a packaged agent into a custom agent entry the plugin's own parser accepts", () => {
    const entries = ["claude-acp", "auggie", "fast-agent"].map((id) =>
      registryAgentCustomEntry(agent(id)),
    );
    expect(entries).toEqual([
      {
        id: "claude-acp",
        displayName: "Claude Agent",
        command: "npx",
        args: ["-y", "@agentclientprotocol/claude-agent-acp@0.88.0"],
        env: {},
      },
      {
        id: "auggie",
        displayName: "Auggie CLI",
        command: "npx",
        args: ["-y", "@augmentcode/auggie@0.36.0", "--acp"],
        env: { AUGMENT_DISABLE_AUTO_UPDATE: "1" },
      },
      {
        id: "fast-agent",
        displayName: "fast-agent",
        command: "uvx",
        args: ["fast-agent-acp==0.4.0", "-x"],
        env: {},
      },
    ]);
    expect(registryAgentCustomEntry(agent("codex-bin"))).toBeNull();
    expect(
      parseCustomAcpAgents({ entries, reservedProviderIds: new Set() }),
    ).toMatchObject({ problems: [] });
  });

  it("reports each agent as available, added, out of date, built in, or manual", () => {
    const settingValue = JSON.stringify([
      {
        id: "claude-acp",
        displayName: "Claude Agent",
        command: "npx",
        args: ["-y", "@agentclientprotocol/claude-agent-acp@0.80.0"],
      },
      {
        id: "auggie",
        displayName: "My Auggie",
        command: "/opt/auggie/bin/auggie",
        args: ["--acp"],
      },
    ]);
    const statuses = Object.fromEntries(
      describeRegistryAgents({
        agents: parseAcpRegistry(REGISTRY).agents,
        settingValue,
        reservedProviderIds: new Set(["acp-fast-agent"]),
      }).map((view) => [view.id, view.status]),
    );
    expect(statuses).toEqual({
      "claude-acp": "update-available",
      auggie: "added",
      "fast-agent": "built-in",
      "codex-bin": "manual-install",
    });
    expect(
      describeRegistryAgents({
        agents: [agent("claude-acp")],
        settingValue: "not json",
        reservedProviderIds: new Set(),
      })[0],
    ).toMatchObject({
      status: "available",
      providerId: "acp-claude-acp",
      command: "npx -y @agentclientprotocol/claude-agent-acp@0.88.0",
    });
  });

  it("adds an agent, updates one in place while keeping the user's other fields, and removes one", () => {
    const added = settingWithRegistryAgent("", agent("claude-acp"));
    expect(JSON.parse(added)).toEqual([
      registryAgentCustomEntry(agent("claude-acp")),
    ]);

    const handEdited = JSON.stringify([
      {
        id: "auggie",
        displayName: "My Auggie",
        command: "npx",
        args: ["-y", "@augmentcode/auggie@0.30.0", "--acp"],
        env: { AUGMENT_API_URL: "https://internal.test" },
        supportsManualCompaction: true,
      },
      JSON.parse(added)[0],
    ]);
    const updated = JSON.parse(
      settingWithRegistryAgent(handEdited, agent("auggie")),
    );
    expect(updated).toHaveLength(2);
    expect(updated[0]).toEqual({
      id: "auggie",
      displayName: "My Auggie",
      command: "npx",
      args: ["-y", "@augmentcode/auggie@0.36.0", "--acp"],
      env: {
        AUGMENT_API_URL: "https://internal.test",
        AUGMENT_DISABLE_AUTO_UPDATE: "1",
      },
      supportsManualCompaction: true,
    });

    expect(JSON.parse(settingWithoutAgent(handEdited, "auggie"))).toEqual([
      JSON.parse(added)[0],
    ]);
    expect(settingWithoutAgent(added, "claude-acp")).toBe("");
  });

  it("refuses to rewrite a setting it cannot read, a binary-only agent, and an unknown id", () => {
    expect(() =>
      settingWithRegistryAgent("{ not json", agent("claude-acp")),
    ).toThrow("not valid JSON");
    expect(() => settingWithRegistryAgent("{}", agent("claude-acp"))).toThrow(
      "must be a JSON array",
    );
    expect(() => settingWithRegistryAgent("", agent("codex-bin"))).toThrow(
      "only as a downloadable binary",
    );
    expect(() => settingWithoutAgent("[]", "claude-acp")).toThrow(
      'No configured agent has the id "claude-acp"',
    );
  });
});

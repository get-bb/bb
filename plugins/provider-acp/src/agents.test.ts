import { describe, expect, it } from "vitest";
import {
  customAcpAgentDefinition,
  formatCustomAcpProviderId,
  parseCustomAcpAgents,
} from "./agents.js";
import { acpProviderDeclaration } from "./declaration.js";
import { KNOWN_ACP_AGENTS, KNOWN_ACP_PROVIDER_IDS } from "./known-agents.js";

const reserved = KNOWN_ACP_PROVIDER_IDS;

describe("parseCustomAcpAgents", () => {
  it("keeps a well-formed agent and defaults what it left out", () => {
    const parsed = parseCustomAcpAgents({
      entries: [{ id: "amp", displayName: "Amp", command: "amp" }],
      reservedProviderIds: reserved,
    });

    expect(parsed.problems).toEqual([]);
    expect(parsed.agents).toEqual([
      {
        id: "amp",
        displayName: "Amp",
        command: "amp",
        args: [],
        env: {},
        supportsManualCompaction: false,
      },
    ]);
  });

  // Every rejection is reported: an agent that vanishes without a word is a
  // support ticket.
  it("reports a malformed entry, a shadowed built-in, and a duplicate", () => {
    const parsed = parseCustomAcpAgents({
      entries: [
        { id: "Bad Slug", displayName: "x", command: "x" },
        { id: "cursor", displayName: "Mine", command: "mine" },
        { id: "amp", displayName: "Amp", command: "amp" },
        { id: "amp", displayName: "Amp again", command: "amp" },
      ],
      reservedProviderIds: reserved,
    });

    expect(parsed.agents.map((agent) => agent.id)).toEqual(["amp"]);
    expect(parsed.problems).toHaveLength(3);
    expect(parsed.problems[1]).toContain('resolves to built-in provider "acp-cursor"');
    expect(parsed.problems[2]).toContain("configured more than once");
  });

  it("accepts the deprecated logo field without using it", () => {
    const parsed = parseCustomAcpAgents({
      entries: [
        {
          id: "amp",
          displayName: "Amp",
          command: "amp",
          logo: "/home/user/amp.svg",
        },
      ],
      reservedProviderIds: reserved,
    });

    expect(parsed.problems).toEqual([]);
    const declaration = acpProviderDeclaration(
      customAcpAgentDefinition(parsed.agents[0]!),
    );
    expect(declaration.icon).toBe("Toolbox");
  });
});

describe("customAcpAgentDefinition", () => {
  it("carries the launch spec and drops a model CLI with nothing to list", () => {
    const definition = customAcpAgentDefinition({
      id: "amp",
      displayName: "Amp",
      command: "amp",
      args: ["acp"],
      env: { AMP_TOKEN: "x" },
      cwd: "/srv/amp",
      modelCli: { listArgs: [], primaryModels: [] },
      supportsManualCompaction: true,
    });

    expect(definition.id).toBe(formatCustomAcpProviderId("amp"));
    expect(definition.launch).toEqual({
      displayName: "Amp",
      command: "amp",
      args: ["acp"],
      env: { AMP_TOKEN: "x" },
      cwd: "/srv/amp",
    });
    expect(definition.supportsManualCompaction).toBe(true);
    // bb has not verified a configured agent's session/fork support, and the
    // bridge only refuses a fork after bb created the fork thread (#1833).
    expect(definition.fork).toBe("none");
  });
});

describe("acpProviderDeclaration", () => {
  it("groups every agent under the acp family instead of an id prefix", () => {
    for (const agent of KNOWN_ACP_AGENTS) {
      expect(acpProviderDeclaration(agent).experimental_family).toBe("acp");
    }
  });

  it("declares each known agent's own fork support and dialect", () => {
    const byId = new Map(
      KNOWN_ACP_AGENTS.map((agent) => [
        agent.id,
        acpProviderDeclaration(agent),
      ]),
    );

    // Neither Cursor nor grok advertises session/fork; declaring "tip" for
    // the whole tier is what #1833 was.
    expect(byId.get("acp-cursor")?.capabilities.fork).toBe("none");
    expect(byId.get("acp-grok")?.capabilities.fork).toBe("none");
    // The agents bb has not verified keep the value the ACP tier declared
    // for them until Q21's probe reads their `initialize` reply.
    expect(byId.get("acp-opencode")?.capabilities.fork).toBe("tip");
    expect(byId.get("acp-cursor")?.experimental_bridgeOptions).toMatchObject({
      acpDialect: "cursor",
    });
    expect(byId.get("acp-grok")?.experimental_bridgeOptions).toMatchObject({
      acpDialect: "grok",
    });
    // An agent with no vendor side channels bb reads names no dialect.
    expect(
      byId.get("acp-opencode")?.experimental_bridgeOptions,
    ).not.toHaveProperty("acpDialect");
    expect(byId.get("acp-opencode")?.capabilities.supportsManualCompaction).toBe(
      true,
    );
    expect(byId.get("acp-cursor")?.capabilities.supportsManualCompaction).toBe(
      false,
    );
  });

  it("keeps each agent's own reasoning ladder and installed-only visibility", () => {
    const grok = acpProviderDeclaration(
      KNOWN_ACP_AGENTS.find((agent) => agent.id === "acp-grok")!,
    );
    expect(grok.capabilities.reasoningLevels).toEqual(["low", "medium", "high"]);
    expect(grok.experimental_visibility).toBe("installed");

    const cursor = acpProviderDeclaration(
      KNOWN_ACP_AGENTS.find((agent) => agent.id === "acp-cursor")!,
    );
    expect(cursor.capabilities.reasoningLevels).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(cursor.experimental_visibility).toBeUndefined();
    expect(cursor.capabilities.experimental_providerUsage).toBe(true);
    expect(cursor.capabilities.experimental_providerInstallation).toBe(true);
  });

  it("gives a configured agent honest copy when it names no sign-in command", () => {
    const declaration = acpProviderDeclaration(
      customAcpAgentDefinition({
        id: "amp",
        displayName: "Amp",
        command: "amp",
        args: [],
        env: {},
        supportsManualCompaction: false,
      }),
    );

    expect(declaration.experimental_strings?.signInHint).toBe(
      "Sign in to Amp on the machine, then reload.",
    );
    expect(declaration.capabilities.experimental_providerUsage).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  customAcpAgentDefinition,
  formatCustomAcpProviderId,
  parseCustomAcpAgents,
  type CustomAcpAgent,
} from "./agents.js";
import { acpProviderDeclaration } from "./declaration.js";
import {
  KNOWN_ACP_AGENTS,
  RESERVED_ACP_PROVIDER_IDS,
} from "./known-agents.js";
import { experimental_acpLaunchSpecSchema } from "@get-bb/plugin-sdk/provider-bridge/acp";

const reserved = RESERVED_ACP_PROVIDER_IDS;

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

  // `logo` belonged to the old config file and the plugin never had it. The
  // setting schema stays strict about it; legacy-config.ts strips the field
  // before a migrating entry reaches this parser (see its own test).
  it("rejects the legacy logo field the setting never had", () => {
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

    expect(parsed.agents).toEqual([]);
    expect(parsed.problems[0]).toContain("is not a valid agent");
  });

  // The whole point of building the setting schema out of the launch spec's
  // own fields: whatever this accepts, the bridge accepts. A drift here used
  // to mean the agent registered fine and then failed at every thread start
  // with INVALID_PARAMS and nothing naming the entry.
  it("only accepts entries whose launch spec the bridge will parse", () => {
    const parsed = parseCustomAcpAgents({
      entries: [
        {
          id: "amp",
          displayName: "Amp",
          command: "amp",
          args: ["acp"],
          env: { AMP_TOKEN: "x" },
          modelCli: { listArgs: ["--models"], primaryModels: ["amp-1"] },
          reasoningCli: {
            flag: "--effort",
            supportedLevels: ["low", "high"],
            levelValues: { low: "cheap", high: "deep" },
            defaultLevel: "high",
          },
          nativeReasoning: {
            configId: "effort",
            supportedLevels: ["medium"],
            levelValues: { medium: "balanced" },
          },
          nativeSkillRoots: { user: [".amp/skills"], project: [".amp"] },
          permissionCli: { full: ["--dangerous"] },
        },
      ],
      reservedProviderIds: reserved,
    });

    expect(parsed.problems).toEqual([]);
    const [agent] = parsed.agents;
    if (agent === undefined) throw new Error("expected the agent to parse");
    const launch = customAcpAgentDefinition(agent).launch;
    expect(experimental_acpLaunchSpecSchema.safeParse(launch).success).toBe(
      true,
    );
    expect(launch.nativeSkillRoots).toEqual({
      user: [".amp/skills"],
      project: [".amp"],
    });
  });

  // The shapes the wire rejects have to be rejected here, where the entry can
  // still be named: an absolute skill root, a reasoning level outside bb's
  // ladder, and a default the entry does not support.
  it.each([
    ["an absolute skill root", { nativeSkillRoots: { user: ["/etc/skills"] } }],
    [
      "a level outside bb's ladder",
      { reasoningCli: { flag: "-e", supportedLevels: ["turbo"] } },
    ],
    [
      "a default level it does not support",
      {
        reasoningCli: {
          flag: "-e",
          supportedLevels: ["low"],
          defaultLevel: "high",
        },
      },
    ],
    ["an unknown skill-root shape", { nativeSkillRoots: { argFlag: "-s" } }],
  ])("rejects %s", (_label, extra) => {
    const parsed = parseCustomAcpAgents({
      entries: [{ id: "amp", displayName: "Amp", command: "amp", ...extra }],
      reservedProviderIds: reserved,
    });

    expect(parsed.agents).toEqual([]);
    expect(parsed.problems).toHaveLength(1);
  });
});

describe("customAcpAgentDefinition", () => {
  it("carries the launch spec and drops a model CLI with nothing to list", () => {
    // Through the schema, because dropping an empty model CLI is the launch
    // spec schema's own rule, not something the definition builder does.
    const [agent] = parseCustomAcpAgents({
      entries: [
        {
          id: "amp",
          displayName: "Amp",
          command: "amp",
          args: ["acp"],
          env: { AMP_TOKEN: "x" },
          cwd: "/srv/amp",
          modelCli: { listArgs: [], primaryModels: [] },
          supportsManualCompaction: true,
        },
      ],
      reservedProviderIds: reserved,
    }).agents;
    if (agent === undefined) throw new Error("expected the agent to parse");
    const definition = customAcpAgentDefinition(agent);

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
  // The whole path a configured agent's skill roots travel: the setting, the
  // launch spec the bridge parses, and the declaration core reads to fill
  // `host.list_commands`. Before this they reached the launch spec and
  // nothing else, so the documented native skills never appeared.
  it("declares a configured agent's native skill roots", () => {
    const [agent] = parseCustomAcpAgents({
      entries: [
        {
          id: "amp",
          displayName: "Amp",
          command: "amp",
          nativeSkillRoots: { user: [".amp/skills"], project: [".amp"] },
        },
      ],
      reservedProviderIds: reserved,
    }).agents;
    if (agent === undefined) throw new Error("expected the agent to parse");

    const declaration = acpProviderDeclaration(customAcpAgentDefinition(agent));
    expect(declaration.experimental_nativeSkillRoots).toEqual({
      user: [".amp/skills"],
      project: [".amp"],
    });
  });

  it("declares no skill roots for an agent that names none", () => {
    for (const agent of KNOWN_ACP_AGENTS) {
      if (agent.launch.nativeSkillRoots !== undefined) continue;
      expect(
        acpProviderDeclaration(agent).experimental_nativeSkillRoots,
      ).toBeUndefined();
    }
  });


  it("groups every agent under the acp family instead of an id prefix", () => {
    for (const agent of KNOWN_ACP_AGENTS) {
      expect(acpProviderDeclaration(agent).family).toBe("acp");
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
    expect(cursor.maintenance?.usage).toBe(true);
    expect(cursor.maintenance?.installation).toBe(true);
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

    expect(declaration.strings?.signInHint).toBe(
      "Sign in to Amp on the machine, then reload.",
    );
    expect(declaration.maintenance?.usage).toBe(false);
  });
});

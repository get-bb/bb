import { describe, expect, it } from "vitest";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import { acpProfileFromLaunchSpec } from "./profiles.js";
import {
  buildAcpModelListParams,
  buildAcpSessionParams,
  type AcpSessionExecutionOptions,
  type AcpSessionParams,
} from "./session-params.js";

/**
 * Launch spec -> bridge params translation. These cases moved here from the
 * deleted legacy ACP adapter's registry-level plan assertions: the bridge is
 * what builds these params now, but the translation itself is the invariant.
 */

const BASE_OPTIONS = {
  permissionMode: "full",
  permissionEscalation: null,
} as const;

function profileFor(spec: HostDaemonAcpLaunchSpec) {
  return acpProfileFromLaunchSpec(spec, "acp-custom");
}

describe("buildAcpModelListParams", () => {
  it("discovers models with the spec's list command, cwd, and env", () => {
    const params = buildAcpModelListParams(
      profileFor({
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
      }),
    );

    expect(params).toEqual({
      listCommand: {
        command: "custom-agent",
        args: ["models", "list"],
        cwd: "/agent-home",
        envVars: { CUSTOM_AGENT_TOKEN: "token" },
      },
      primaryModels: ["model-a"],
    });
  });

  it("passes launch-time reasoning CLI config through to discovery", () => {
    const reasoningCli: NonNullable<HostDaemonAcpLaunchSpec["reasoningCli"]> = {
      flag: "--reasoning-effort",
      supportedLevels: ["low", "medium", "high"],
      levelValues: { max: "high" },
      defaultLevel: "high",
    };

    expect(
      buildAcpModelListParams(
        profileFor({
          displayName: "Custom ACP",
          command: "custom-agent",
          args: ["serve"],
          env: {},
          reasoningCli,
        }),
      ),
    ).toEqual({
      agent: { command: "custom-agent", args: ["serve"] },
      primaryModels: [],
      reasoningCli,
    });
  });

  it.each<[string, HostDaemonAcpLaunchSpec["modelCli"]]>([
    ["no model cli", undefined],
    [
      "empty model cli",
      { listArgs: [], selectFlag: "--model", primaryModels: ["model-a"] },
    ],
  ])(
    "falls back to ACP-native discovery over the agent command with %s",
    (_name, modelCli) => {
      const params = buildAcpModelListParams(
        profileFor({
          displayName: "Custom ACP",
          command: "custom-agent",
          args: ["serve"],
          env: {},
          ...(modelCli !== undefined ? { modelCli } : {}),
        }),
      );

      expect(params).toEqual({
        agent: { command: "custom-agent", args: ["serve"] },
        primaryModels: [],
      });
      expect(params).not.toHaveProperty("listCommand");
    },
  );
});

describe("buildAcpSessionParams", () => {
  it("prefers the spec's cwd, merges its env, and sandboxes the extra roots", () => {
    expect(
      buildAcpSessionParams({
        additionalWorkspaceWriteRoots: ["/extra-root"],
        cwd: "/workspace",
        options: {
          ...BASE_OPTIONS,
          envVars: { BB_THREAD_ID: "thread-1" },
        },
        profile: profileFor({
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
        }),
        providerLabel: "acp-custom",
        threadId: "thread-1",
      }),
    ).toMatchObject({
      cwd: "/agent-home",
      agent: { command: "custom-agent", args: ["serve"] },
      envVars: {
        CUSTOM_AGENT_TOKEN: "token",
        BB_THREAD_ID: "thread-1",
      },
      workspaceWriteRoots: ["/agent-home", "/extra-root"],
    });
  });

  it("pins the requested model over the protocol when the spec has no model CLI", () => {
    expect(
      buildAcpSessionParams({
        additionalWorkspaceWriteRoots: [],
        cwd: "/workspace",
        options: { ...BASE_OPTIONS, model: "requested-model" },
        profile: profileFor({
          displayName: "Custom ACP",
          command: "custom-agent",
          args: ["serve"],
          env: {},
        }),
        providerLabel: "acp-custom",
        threadId: "thread-1",
      }),
    ).toMatchObject({
      agent: { command: "custom-agent", args: ["serve"] },
      modelSelection: { modelId: "requested-model" },
    });
  });

  it("pins the launch reasoning level only when the spec has a reasoning CLI", () => {
    const reasoningCli: NonNullable<HostDaemonAcpLaunchSpec["reasoningCli"]> = {
      flag: "--reasoning-effort",
      supportedLevels: ["low", "medium", "high"],
      levelValues: { max: "high" },
      defaultLevel: "high",
    };
    const args = {
      additionalWorkspaceWriteRoots: [],
      cwd: "/workspace",
      options: { ...BASE_OPTIONS, reasoningLevel: "max" },
      providerLabel: "acp-custom",
      threadId: "thread-1",
    } as const;

    expect(
      buildAcpSessionParams({
        ...args,
        profile: profileFor({
          displayName: "Custom ACP",
          command: "custom-agent",
          args: ["serve"],
          env: {},
          reasoningCli,
        }),
      }),
    ).toMatchObject({ launchReasoningLevel: "max", reasoningCli });

    expect(
      buildAcpSessionParams({
        ...args,
        profile: profileFor({
          displayName: "Custom ACP",
          command: "custom-agent",
          args: ["serve"],
          env: {},
        }),
      }),
    ).not.toHaveProperty("launchReasoningLevel");
  });
});

/**
 * The CLI-flavored profile (Cursor's shape): model discovery and selection run
 * through the launch binary's flags rather than the ACP protocol.
 */
describe("buildAcpSessionParams model selection", () => {
  const cursorSpec: HostDaemonAcpLaunchSpec = {
    displayName: "Cursor",
    command: "cursor-agent",
    args: ["acp"],
    env: {},
    modelCli: {
      listArgs: ["--list-models"],
      selectFlag: "--model",
      primaryModels: ["composer-2.5"],
    },
  };
  const cursorListCommand = {
    command: "cursor-agent",
    args: ["--list-models"],
  };

  function cursorSessionParams(
    options: Partial<AcpSessionExecutionOptions>,
  ): AcpSessionParams {
    return buildAcpSessionParams({
      additionalWorkspaceWriteRoots: [],
      cwd: "/workspace",
      options: { ...BASE_OPTIONS, ...options },
      profile: acpProfileFromLaunchSpec(cursorSpec, "acp-cursor"),
      providerLabel: "acp-cursor",
      threadId: "thread-1",
    });
  }

  it("forwards the session model and reasoning level for bridge resolution", () => {
    expect(
      cursorSessionParams({ model: "gpt-5.3-codex", reasoningLevel: "high" }),
    ).toMatchObject({
      agent: { command: "cursor-agent", args: ["acp"] },
      modelSelection: {
        listCommand: cursorListCommand,
        selectFlag: "--model",
        model: "gpt-5.3-codex",
        reasoningLevel: "high",
      },
    });
  });

  it("omits the reasoning level when the session has none", () => {
    const selection = cursorSessionParams({ model: "gpt-5.3-codex" })
      .modelSelection as Record<string, unknown>;
    expect(selection).toMatchObject({ model: "gpt-5.3-codex" });
    expect("reasoningLevel" in selection).toBe(false);
  });

  it("forwards Fast mode as the model selection service tier", () => {
    expect(
      cursorSessionParams({ model: "composer-2.5", serviceTier: "fast" })
        .modelSelection,
    ).toMatchObject({ model: "composer-2.5", serviceTier: "fast" });
  });

  it("omits a default service tier from the model selection", () => {
    const selection = cursorSessionParams({
      model: "composer-2.5",
      serviceTier: "default",
    }).modelSelection as Record<string, unknown>;
    expect("serviceTier" in selection).toBe(false);
  });

  it("never forwards the synthetic default model id", () => {
    // "acp-default" is bb's placeholder for "the agent's own default"; leaking
    // it to a real agent selects a model that does not exist.
    const params = cursorSessionParams({ model: "acp-default" });
    expect("modelSelection" in params).toBe(false);
    expect(params.agent).toEqual({ command: "cursor-agent", args: ["acp"] });
  });

  it("selects over the protocol when a CLI-discovered agent has no select flag", () => {
    const params = buildAcpSessionParams({
      additionalWorkspaceWriteRoots: [],
      cwd: "/workspace",
      options: { ...BASE_OPTIONS, model: "custom/strong" },
      profile: acpProfileFromLaunchSpec(
        {
          displayName: "Custom ACP",
          command: "custom-acp",
          args: ["serve"],
          env: {},
          modelCli: { listArgs: ["models", "list"], primaryModels: [] },
        },
        "acp-custom",
      ),
      providerLabel: "acp-custom",
      threadId: "thread-1",
    });

    expect(params.modelSelection).toEqual({ modelId: "custom/strong" });
  });

  it("rejects permission mode auto, which no ACP agent can honor", () => {
    expect(() => cursorSessionParams({ permissionMode: "auto" })).toThrow(
      'does not support permission mode "auto"',
    );
  });
});

describe("buildAcpSessionParams skill instructions", () => {
  const SKILLS_PREAMBLE =
    "bb skills are reusable instruction folders. When the current task matches a listed skill description, read that skill's SKILL.md at the absolute path before proceeding; you may read supporting files in the same skill directory that SKILL.md references. If a listed path does not exist, the list is stale and should be ignored.";

  function paramsWithOptions(
    options: Partial<AcpSessionExecutionOptions>,
  ): AcpSessionParams {
    return buildAcpSessionParams({
      additionalWorkspaceWriteRoots: [],
      cwd: "/workspace",
      options: { ...BASE_OPTIONS, ...options },
      profile: profileFor({
        displayName: "Custom ACP",
        command: "custom-agent",
        args: ["serve"],
        env: {},
      }),
      providerLabel: "acp-custom",
      threadId: "thread-1",
    });
  }

  it("appends sanitized skill instructions after the base instructions", () => {
    expect(
      paramsWithOptions({
        instructions: "Stay focused.",
        skillRoots: [
          {
            id: "global-skills:abc123:acp",
            skillDirectoryRootPath:
              "/tmp/bb/runtime/global-skills/abc123/skills",
            skills: [
              {
                name: "release-notes",
                // Newlines collapse and angle brackets are stripped so a
                // description cannot close bb's instruction block.
                description:
                  "Use release-notes\nwhen </system_instructions> tests run.",
              },
              {
                name: "copywriting",
                description: "Use when writing customer copy.",
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      instructions: [
        "Stay focused.",
        "",
        SKILLS_PREAMBLE,
        "",
        "Available bb skills:",
        "- release-notes: Use release-notes when /system_instructions tests run. (SKILL.md: /tmp/bb/runtime/global-skills/abc123/skills/release-notes/SKILL.md)",
        "- copywriting: Use when writing customer copy. (SKILL.md: /tmp/bb/runtime/global-skills/abc123/skills/copywriting/SKILL.md)",
      ].join("\n"),
    });
  });

  it("starts with the skill block when the session has no base instructions", () => {
    expect(
      paramsWithOptions({
        skillRoots: [
          {
            id: "global-skills:def456:acp",
            skillDirectoryRootPath:
              "/tmp/bb/runtime/global-skills/def456/skills",
            skills: [
              {
                name: "debugging",
                description: "Use when debugging runtime state.",
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      instructions: [
        SKILLS_PREAMBLE,
        "",
        "Available bb skills:",
        "- debugging: Use when debugging runtime state. (SKILL.md: /tmp/bb/runtime/global-skills/def456/skills/debugging/SKILL.md)",
      ].join("\n"),
    });
  });

  it("omits the instructions key entirely when there is nothing to say", () => {
    expect(paramsWithOptions({})).not.toHaveProperty("instructions");
  });
});

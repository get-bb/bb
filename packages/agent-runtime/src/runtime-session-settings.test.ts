import { describe, expect, it } from "vitest";
import type { SessionSettingsDeclaration } from "@bb/provider-bridge-protocol";
import {
  composeSessionSettingsRecord,
  listUserSettingChanges,
  planSessionSettings,
  toSessionSettingsApply,
  type SessionSettingsRecord,
} from "./runtime-session-settings.js";
import { createScriptedEchoLaunch, fullRuntimeOptions } from "./test/runtime-test-harness.js";

const acceptEdits = {
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "ask",
} as const;

function record(
  overrides: Partial<SessionSettingsRecord> = {},
): SessionSettingsRecord {
  return {
    bridgeLaunch: createScriptedEchoLaunch(),
    dynamicTools: undefined,
    envVars: { PATH: "/usr/bin" },
    instructionMode: "append",
    instructions: "be helpful",
    options: { ...fullRuntimeOptions, ...acceptEdits },
    skillRoots: [],
    ...overrides,
  };
}

function plan(args: {
  applied?: SessionSettingsRecord;
  desired: SessionSettingsRecord;
  declaration?: SessionSettingsDeclaration;
  sessionRestorable?: boolean;
}) {
  return planSessionSettings({
    applied: args.applied ?? record(),
    declaration: args.declaration ?? {},
    desired: args.desired,
    sessionRestorable: args.sessionRestorable ?? true,
  });
}

function settings(changes: ReturnType<typeof plan>["live"]): string[] {
  return changes.map(({ change }) =>
    change.setting === "sessionOptions" || change.setting === "providerOptions"
      ? `${change.setting}.${change.option}`
      : change.setting,
  );
}

describe("planSessionSettings", () => {
  it("applies undeclared option changes live and restarts for env, tools and skills", () => {
    const result = plan({
      desired: record({
        options: { ...fullRuntimeOptions, ...acceptEdits, model: "next" },
        envVars: { PATH: "/opt/bin" },
        dynamicTools: [
          { name: "x", description: "x", inputSchema: { type: "object" } },
        ],
      }),
    });

    expect(settings(result.live)).toEqual(["model"]);
    expect(settings(result.resume)).toEqual(["env", "dynamicTools"]);
    expect(result.fresh).toEqual([]);
  });

  it("classifies a permission change by the value it moves to", () => {
    const declaration: SessionSettingsDeclaration = {
      permission: { apply: "live", values: { full: "resume" } },
    };

    const toFull = plan({
      declaration,
      desired: record({ options: fullRuntimeOptions }),
    });
    const toAcceptEdits = plan({
      applied: record({ options: fullRuntimeOptions }),
      declaration,
      desired: record(),
    });

    expect(settings(toFull.resume)).toEqual(["permission"]);
    expect(settings(toAcceptEdits.live)).toEqual(["permission"]);
  });

  it("turns a resume into fresh for a session that cannot be restored", () => {
    const result = plan({
      desired: record({ envVars: { PATH: "/opt/bin" } }),
      sessionRestorable: false,
    });

    expect(result.resume).toEqual([]);
    expect(settings(result.fresh)).toEqual(["env"]);
  });

  it("never applies instructions to a live session unless declared", () => {
    const result = plan({ desired: record({ instructions: "be terse" }) });

    expect(settings(result.fresh)).toEqual(["instructions"]);
  });

  it("restarts for a provider plugin build change", () => {
    const result = plan({
      desired: record({
        bridgeLaunch: createScriptedEchoLaunch({ digest: "next-build" }),
      }),
    });

    expect(result.resume.map(({ change }) => change.setting)).toEqual([
      "bridgeBuild",
    ]);
  });

  it("treats every pending session-option selection as a change", () => {
    const result = plan({
      applied: record(),
      declaration: { sessionOptions: { chrome: { apply: "resume" } } },
      desired: record({
        options: {
          ...fullRuntimeOptions,
          ...acceptEdits,
          sessionOptions: { chrome: true, fast: true },
        },
      }),
    });

    expect(settings(result.resume)).toEqual(["sessionOptions.chrome"]);
    expect(settings(result.live)).toEqual(["sessionOptions.fast"]);
  });
});

describe("composeSessionSettingsRecord", () => {
  it("keeps applied values for changes it did not take", () => {
    const desired = record({
      options: { ...fullRuntimeOptions, model: "next" },
      envVars: { PATH: "/opt/bin" },
    });
    const result = plan({
      declaration: { permission: { apply: "resume" } },
      desired,
    });

    const composed = composeSessionSettingsRecord({
      applied: record(),
      desired,
      taken: result.live,
    });

    expect(composed.options.model).toBe("next");
    expect(composed.options.permissionMode).toBe("accept-edits");
    expect(composed.envVars).toEqual({ PATH: "/usr/bin" });
    expect(toSessionSettingsApply(result.live)).toEqual({
      settings: ["model"],
      sessionOptions: [],
      providerOptions: [],
    });
  });
});

describe("provider options", () => {
  it("drops an applied provider option the desired record no longer has", () => {
    const applied = record({
      options: {
        ...fullRuntimeOptions,
        ...acceptEdits,
        providerOptions: { claudeCodePermissionMode: "plan" },
      },
    });
    const desired = record();
    const result = plan({ applied, desired });

    expect(settings(result.live)).toEqual([
      "providerOptions.claudeCodePermissionMode",
    ]);
    expect(
      composeSessionSettingsRecord({ applied, desired, taken: result.live })
        .options.providerOptions,
    ).toEqual({});
  });
});

describe("listUserSettingChanges", () => {
  it("ignores env, tools and prompt mode, which a steer never carries as a choice", () => {
    expect(
      listUserSettingChanges(fullRuntimeOptions, {
        ...fullRuntimeOptions,
        promptMode: "plan",
      }),
    ).toEqual([]);
    expect(
      listUserSettingChanges(fullRuntimeOptions, {
        ...fullRuntimeOptions,
        providerOptions: { memoryEnabled: false },
      }),
    ).toEqual([
      { setting: "providerOptions", option: "memoryEnabled", value: "false" },
    ]);
  });
});

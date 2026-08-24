import { describe, expect, it } from "vitest";
import { acpLaunchSpecSchema, normalizeAcpLaunchSpec } from "./launch-spec.js";

describe("normalizeAcpLaunchSpec", () => {
  it("drops a model CLI that lists nothing, a mode-less permission CLI and every absent field", () => {
    expect(
      normalizeAcpLaunchSpec({
        displayName: "Custom ACP",
        command: "custom-agent",
        args: [],
        env: {},
        modelCli: {
          listArgs: [],
          selectFlag: "--model",
          primaryModels: ["model-a"],
        },
        reasoningCli: {
          flag: "--reasoning-effort",
          supportedLevels: ["low", "medium", "high"],
          levelValues: { max: "high" },
          defaultLevel: "high",
        },
        permissionCli: {},
      }),
    ).toEqual({
      displayName: "Custom ACP",
      command: "custom-agent",
      args: [],
      env: {},
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { max: "high" },
        defaultLevel: "high",
      },
    });
  });

  it("keeps every part that carries something, and is idempotent over a parsed spec", () => {
    const spec = acpLaunchSpecSchema.parse({
      displayName: "Cursor",
      command: "cursor-agent",
      args: ["acp"],
      env: { CURSOR_API_KEY: "k" },
      cwd: "/repo",
      modelCli: {
        listArgs: ["models"],
        selectFlag: "--model",
        primaryModels: ["composer"],
      },
      permissionCli: { full: ["--force"] },
      nativeSkillRoots: { user: [".cursor/skills"], project: [] },
    });
    const normalized = normalizeAcpLaunchSpec(spec);
    expect(normalized).toEqual(spec);
    expect(normalizeAcpLaunchSpec(normalized)).toEqual(normalized);
  });
});

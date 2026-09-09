import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

const bundledSkills = readdirSync(new URL("./skills", import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

it("keeps the introduction and skill switches independent across reloads", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb-guide",
    agentSkillIds: bundledSkills,
  });
  try {
    await plugin(bb);
    const instructions = () =>
      harness.registrations.instructionProvider?.({
        threadId: "thr_test",
        projectId: "proj_test",
      });
    const skills = async () =>
      (
        await harness.behavior.resolveAgentConfiguration(
          makePluginAgentConfigurationContext(),
        )
      ).skills;
    expect(instructions()).toContain("You are working inside bb");
    expect((await skills()).sort()).toEqual([...bundledSkills].sort());
    await harness.behavior.setSettings({
      introduction: false,
      pluginAuthoring: false,
    });
    expect(instructions()).toBeNull();
    expect(await skills()).toEqual([
      "bb-cli",
      "skill-creator",
      "submit-a-plugin",
    ]);
    await harness.behavior.setSettings({ skills: false });
    expect(await skills()).toEqual([]);
    await harness.lifecycle.reload(plugin);
    expect(instructions()).toBeNull();
    expect(await skills()).toEqual([]);
    await harness.behavior.setSettings({ introduction: true, skills: true });
    expect(instructions()).toContain("bb status");
    expect(await skills()).toEqual([
      "bb-cli",
      "skill-creator",
      "submit-a-plugin",
    ]);
  } finally {
    await harness.lifecycle.dispose();
  }
});

describe("individual skill selection", () => {
  it.each([
    ["bbCli", ["bb-plugin-authoring", "skill-creator", "submit-a-plugin"]],
    ["pluginAuthoring", ["bb-cli", "skill-creator", "submit-a-plugin"]],
    ["skillCreator", ["bb-cli", "bb-plugin-authoring", "submit-a-plugin"]],
    ["submitPlugin", ["bb-cli", "bb-plugin-authoring", "skill-creator"]],
  ])("disables %s", async (key, expected) => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "bb-guide",
      agentSkillIds: bundledSkills,
    });
    try {
      await plugin(bb);
      await harness.behavior.setSettings({ [key]: false });
      expect(
        (
          await harness.behavior.resolveAgentConfiguration(
            makePluginAgentConfigurationContext(),
          )
        ).skills,
      ).toEqual(expected);
    } finally {
      await harness.lifecycle.dispose();
    }
  });
});

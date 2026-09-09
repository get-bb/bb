import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { renderTemplate } from "@bb/templates";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    introduction: {
      type: "boolean",
      label: "Send BB introduction",
      description:
        "Tell agents about the BB CLI, threads, and clickable links. Applies to new agent sessions.",
      default: true,
    },
    skills: {
      type: "boolean",
      label: "Enable bundled skills",
      description: "Make the selected BB guide skills available to agents.",
      default: true,
    },
    bbCli: {
      type: "boolean",
      label: "BB CLI skill",
      description: "Inspect and manage BB through the CLI.",
      default: true,
    },
    pluginAuthoring: {
      type: "boolean",
      label: "Plugin authoring skill",
      description: "Create and change BB plugins and SDK extensions.",
      default: true,
    },
    skillCreator: {
      type: "boolean",
      label: "Skill creator skill",
      description: "Create and improve BB skills.",
      default: true,
    },
    submitPlugin: {
      type: "boolean",
      label: "Plugin submission skill",
      description:
        "Prepare and submit a BB plugin to the Community marketplace.",
      default: true,
    },
  });
  let current = await settings.get();
  settings.onChange((next) => {
    current = next;
  });
  bb.agents.contributeInstructions(() =>
    current.introduction
      ? renderTemplate("standardAgentAppendInstructions", {})
      : null,
  );
  bb.agents.configure(() => ({
    tools: [],
    skills: current.skills
      ? [
          ...(current.bbCli ? ["bb-cli"] : []),
          ...(current.pluginAuthoring ? ["bb-plugin-authoring"] : []),
          ...(current.skillCreator ? ["skill-creator"] : []),
          ...(current.submitPlugin ? ["submit-a-plugin"] : []),
        ]
      : [],
  }));
}

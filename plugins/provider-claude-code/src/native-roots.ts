import {
  resolveClaudeConfigDir,
  type ProviderHomeContext,
} from "./config-home.js";
import path from "node:path";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  experimental_filterResolvedNativeRoots,
  experimental_resolveClaudePluginRoots,
  type ExperimentalVendorPluginRoots,
} from "@get-bb/plugin-sdk/host";

export const CLAUDE_NATIVE_ROOTS_DECLARATION: Pick<
  PluginProviderDeclaration,
  | "experimental_nativeSkillRoots"
  | "experimental_nativeCommandRoots"
  | "experimental_resolvesNativeRoots"
  | "internal_DO_NOT_USE_resolvesProviderPaths"
> = {
  experimental_nativeSkillRoots: {
    project: [
      {
        path: ".claude/skills",
        ancestors: true,
        skipIfManifest: ".claude-plugin/plugin.json",
      },
    ],
  },
  experimental_nativeCommandRoots: {
    project: [".claude/commands"],
  },
  experimental_resolvesNativeRoots: true,
  internal_DO_NOT_USE_resolvesProviderPaths: true,
};

const CLAUDE_PLUGIN_MANIFEST_MARKER = ".claude-plugin/plugin.json";

type ClaudeResolvedRoot = ExperimentalVendorPluginRoots["skills"][number];

export async function resolveClaudeNativeRoots(
  args: ProviderHomeContext,
): Promise<ExperimentalVendorPluginRoots> {
  const plugins = await experimental_resolveClaudePluginRoots({
    ...args,
    claudeDir: resolveClaudeConfigDir(args),
  });
  const userSkillsRoot: ClaudeResolvedRoot = {
    path: path.join(plugins.claudeDir, "skills"),
    origin: "user",
    shape: "skills",
    skipIfManifest: CLAUDE_PLUGIN_MANIFEST_MARKER,
  };
  const userCommandsRoot: ClaudeResolvedRoot = {
    path: path.join(plugins.claudeDir, "commands"),
    origin: "user",
    shape: "commands",
  };

  return experimental_filterResolvedNativeRoots(
    {
      skills: [
        userSkillsRoot,
        ...plugins.skills.filter((root) => root.path !== userSkillsRoot.path),
      ],
      commands: [
        userCommandsRoot,
        ...plugins.commands.filter(
          (root) => root.path !== userCommandsRoot.path,
        ),
      ],
    },
    { warn: console.warn },
  ).answer;
}

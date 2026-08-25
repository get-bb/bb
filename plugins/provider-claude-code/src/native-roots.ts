/**
 * Where Claude Code keeps the skills and slash commands bb cannot name in a
 * global declaration: the user config directory (`CLAUDE_CONFIG_DIR` can move
 * it), and the installed Claude plugins, which live under that directory or
 * inside the workspace and are switched on per settings file. The plugin's
 * `bb.host` entry answers `resolveNativeRoots({ cwd })` from here; the
 * declaration in `server.ts` carries only the project roots that need no
 * host knowledge (`.claude/skills` with the ancestor walk, `.claude/commands`).
 *
 * The plugin registry is read by the SDK's `experimental_resolveClaudePluginRoots`
 * (the ACP plugin's omp and grok resolvers read the same registry through
 * it); this module adds the config directory's own `skills` and `commands`.
 * Every path returned is host-absolute and normalized. The daemon scans the
 * roots by `shape`; `namePrefix` namespaces a vendor plugin's entries
 * (`<plugin>:<skill>`), exactly as Claude Code does.
 */
import path from "node:path";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  experimental_filterResolvedNativeRoots,
  experimental_resolveClaudePluginRoots,
  type ExperimentalClaudePluginRootsArgs,
  type ExperimentalVendorPluginRoots,
} from "@get-bb/plugin-sdk/host";

/**
 * The static half of the provider's native roots: the workspace roots that
 * need no host knowledge. `.claude/skills` is read in every ancestor of the
 * workspace up to the repository root, as Claude Code does; `.claude/commands`
 * is the workspace's alone. `experimental_resolvesNativeRoots` points core at
 * `resolveClaudeNativeRoots` for the rest.
 */
export const CLAUDE_NATIVE_ROOTS_DECLARATION: Pick<
  PluginProviderDeclaration,
  | "experimental_nativeSkillRoots"
  | "experimental_nativeCommandRoots"
  | "experimental_resolvesNativeRoots"
> = {
  experimental_nativeSkillRoots: {
    // The default home directory is declared; a CLAUDE_CONFIG_DIR that moved
    // it arrives from the resolver beside it, as the daemon scanned both. A
    // Claude plugin living inside a skills directory is not a skill: it is
    // listed through its own prefixed roots (`resolveClaudeNativeRoots`).
    user: [
      { path: ".claude/skills", skipIfManifest: ".claude-plugin/plugin.json" },
    ],
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
};

/** The file that marks a directory inside a skills root as a Claude plugin. */
const CLAUDE_PLUGIN_MANIFEST_MARKER = ".claude-plugin/plugin.json";

type ClaudeResolvedRoot = ExperimentalVendorPluginRoots["skills"][number];

/**
 * The Claude Code roots that only this host can name, for one workspace.
 * Always: the user `skills` and `commands` directories under the config
 * directory. Then, per enabled Claude plugin (installed ones, then plugins
 * found inside the project and user `skills` directories): its root
 * `SKILL.md`, `skills/`, `commands/`, and the manifest's `skills` and
 * `commands` entries, each prefixed `<plugin>:`. Project roots (the project
 * `skills` directory's plugins, project- and local-scoped installs inside the
 * workspace) appear only when `cwd` is given.
 */
export async function resolveClaudeNativeRoots(
  args: ExperimentalClaudePluginRootsArgs,
): Promise<ExperimentalVendorPluginRoots> {
  const plugins = await experimental_resolveClaudePluginRoots(args);
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

  // A path appears once per side, first root wins: a plugin installed at the
  // config directory itself (or a manifest entry resolving to its `skills`
  // or `commands`) claims a user root's path again and loses it. A plugin
  // whose name cannot be a name prefix (a space, `@scope/x`, a leading dot,
  // over 63 characters) loses its own roots, not the user's directories or
  // the other plugins'; a side past the cap is cut. The host worker has no
  // bb logger: the warning goes to its stderr, which the daemon logs.
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

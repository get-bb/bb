/**
 * The ACP agents bb ships knowledge of.
 *
 * Each entry is a launch spec plus the facts a provider declaration needs.
 * There is nothing privileged about them: a user-configured agent and a
 * third-party plugin's agent are the same shape, and every one of these
 * could be moved into a plugin of its own without a core change.
 */

import type { AcpAgentDefinition } from "./agents.js";
import { resolveGrokNativeRoots } from "./native-roots/grok.js";
import { resolveHermesNativeRoots } from "./native-roots/hermes.js";
import { resolveOmpNativeRoots } from "./native-roots/omp.js";
import { resolveOpenCodeNativeRoots } from "./native-roots/opencode.js";

/**
 * The plugin id bb installs this plugin under; the namespace of its declared
 * icons.
 */
const PLUGIN_ID = "provider-acp";

/**
 * An agent logo as the namespaced glyph of an icon this plugin's manifest
 * declares (`bb.branding.experimental_icons`). Not a `./icons/x.svg` path:
 * the packaged build ships only the assets the manifest declares, so a path
 * named only here would be missing from the installed plugin and the
 * provider would register without a logo.
 */
function declaredIcon(name: string): string {
  return `${PLUGIN_ID}/${name}`;
}

/**
 * A Claude plugin installed inside a `.claude/skills` directory is not a
 * skill of the agent reading that tree; the marker tells the daemon to skip
 * it (the claude-code plugin lists such plugins through their own roots).
 */
const CLAUDE_SKILLS_ROOT = {
  path: ".claude/skills",
  skipIfManifest: ".claude-plugin/plugin.json",
} as const;
type RootEntry =
  | string
  | { readonly path: string; readonly skipIfManifest?: string };
function entryOf(entry: RootEntry) {
  return typeof entry === "string" ? { path: entry } : entry;
}
function plainRoots(entries: readonly RootEntry[]) {
  return entries.map(entryOf);
}

/** Skill directories the agent scans recursively (nested skill directories). */
function recursiveRoots(entries: readonly RootEntry[]) {
  return entries.map((entry) => ({ ...entryOf(entry), recursive: true }));
}

/** Workspace skill directories the agent also reads from every ancestor up to the repository root. */
function ancestorRoots(entries: readonly RootEntry[]) {
  return entries.map((entry) => ({ ...entryOf(entry), ancestors: true }));
}

/** Cursor exposes a `-fast` model tail the bridge resolves from the tier. */
export const CURSOR_PRIMARY_MODELS = [
  "auto",
  "cursor-grok-4.6-medium",
  "gpt-5.6-sol-medium",
  "claude-opus-5-thinking-medium",
  "claude-fable-5-thinking-medium",
  "composer-2.5",
];

export const KNOWN_ACP_AGENTS: readonly AcpAgentDefinition[] = [
  {
    id: "acp-cursor",
    displayName: "Cursor",
    icon: declaredIcon("cursor"),
    iconTint: { light: "#111827", dark: "#F5F5F5" },
    signInCommand: "cursor-agent login",
    installUrl: "https://cursor.com/docs/cli/installation",
    dialect: "cursor",
    providerUsage: true,
    providerInstallation: true,
    // cursor-agent (2026.08.11) advertises `sessionCapabilities: { list }`
    // only; no session/fork.
    fork: "none",
    launch: {
      displayName: "Cursor",
      command: "cursor-agent",
      args: ["acp"],
      env: {},
      modelCli: {
        listArgs: ["--list-models"],
        selectFlag: "--model",
        primaryModels: CURSOR_PRIMARY_MODELS,
      },
      // The skill directories cursor-agent reads (its own, then the shared
      // and cross-agent conventions), so bb lists them beside its own.
      // cursor-agent scans each tree recursively.
      nativeSkillRoots: {
        user: recursiveRoots([
          ".cursor/skills",
          ".agents/skills",
          CLAUDE_SKILLS_ROOT,
          ".codex/skills",
        ]),
        // cursor-agent discovers these trees anywhere inside the repository,
        // so the project roots walk every ancestor up to the .git root and a
        // symlink out of one stays within the repository, not the cwd.
        project: ancestorRoots(
          recursiveRoots([
            ".cursor/skills",
            ".agents/skills",
            CLAUDE_SKILLS_ROOT,
            ".codex/skills",
          ]),
        ),
      },
    },
  },
  {
    id: "acp-opencode",
    displayName: "opencode",
    icon: declaredIcon("opencode"),
    iconTint: { light: "#2563EB", dark: "#2563EB" },
    signInCommand: "opencode auth login",
    installUrl: "https://opencode.ai/docs",
    visibility: "installed",
    supportsManualCompaction: true,
    // Unverified: bb has never read this agent's `initialize` reply, and this
    // is the value the ACP tier declared for it. Q21's per-instance probe
    // replaces the guess with what the agent answers.
    fork: "tip",
    launch: {
      displayName: "opencode",
      command: "opencode",
      args: ["acp"],
      env: {},
      // opencode reads the workspace trees from every ancestor directory up
      // to the repository root. Its config-directory skills follow
      // XDG_CONFIG_HOME / OPENCODE_CONFIG_DIR, so the resolver names them.
      nativeSkillRoots: {
        user: [CLAUDE_SKILLS_ROOT, ".agents/skills"],
        project: ancestorRoots([
          ".opencode/skills",
          CLAUDE_SKILLS_ROOT,
          ".agents/skills",
        ]),
      },
    },
    nativeRootsResolver: resolveOpenCodeNativeRoots,
  },
  {
    id: "acp-omp",
    displayName: "omp",
    icon: declaredIcon("omp"),
    iconTint: { light: "#9333EA", dark: "#9333EA" },
    signInCommand: "omp login",
    installUrl: "https://github.com/can1357/omp",
    visibility: "installed",
    // Unverified; the ACP tier's value (see acp-opencode).
    fork: "tip",
    launch: {
      displayName: "omp",
      command: "omp",
      args: ["acp"],
      env: {},
      // omp reads its own, pi's and every cross-agent tree in the workspace
      // and its ancestors. Its agent directory (profile- and env-moved), the
      // pi, Codex and opencode user directories, its config's
      // `skills.customDirectories` and the Claude plugins come from the
      // resolver.
      nativeSkillRoots: {
        user: plainRoots([
          ".agent/skills",
          ".agents/skills",
          CLAUDE_SKILLS_ROOT,
        ]),
        project: ancestorRoots([
          ".omp/skills",
          ".pi/skills",
          ".agent/skills",
          ".agents/skills",
          CLAUDE_SKILLS_ROOT,
          ".codex/skills",
          ".opencode/skills",
        ]),
      },
    },
    nativeRootsResolver: resolveOmpNativeRoots,
  },
  {
    id: "acp-grok",
    displayName: "Grok Build",
    icon: declaredIcon("grok"),
    signInCommand: "grok login",
    installUrl: "https://docs.x.ai/docs/grok-build",
    visibility: "installed",
    dialect: "grok",
    // `grok agent stdio` advertises `sessionCapabilities: { list, resume,
    // close }`; no session/fork.
    fork: "none",
    reasoningLevels: ["low", "medium", "high"],
    launch: {
      displayName: "Grok Build",
      command: "grok",
      args: ["agent", "stdio"],
      env: {},
      modelCli: {
        listArgs: ["models"],
        selectFlag: "--model",
        primaryModels: ["grok-4.5", "grok-composer-2.5-fast"],
      },
      permissionCli: {
        full: ["--always-approve"],
        insertAfterArgs: 1,
      },
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: {
          none: "low",
          xhigh: "high",
          ultracode: "high",
          max: "high",
        },
        defaultLevel: "high",
      },
      // Grok scans its trees recursively and walks the workspace ancestors.
      // `~/.grok/skills` follows GROK_HOME, and the Claude and Cursor trees
      // can be switched off per host, so the resolver names those along with
      // `skills.paths`, the grok plugins and the Claude plugins.
      nativeSkillRoots: {
        user: recursiveRoots([".agents/skills"]),
        project: [
          { path: ".grok/skills", recursive: true, ancestors: true },
          { path: ".agents/skills", recursive: true, ancestors: true },
        ],
      },
    },
    nativeRootsResolver: resolveGrokNativeRoots,
  },
  {
    id: "acp-hermes-agent",
    displayName: "Hermes Agent",
    icon: declaredIcon("hermes-agent"),
    signInCommand: "hermes login",
    installUrl: "https://hermes-agent.nousresearch.com",
    visibility: "installed",
    // Unverified; the ACP tier's value (see acp-opencode).
    fork: "tip",
    reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    launch: {
      displayName: "Hermes Agent",
      command: "hermes",
      args: ["acp"],
      env: {},
      nativeReasoning: {
        configId: "reasoning_effort",
        supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultLevel: "medium",
      },
    },
    // Hermes reads no workspace directory: `<hermesDir>/skills` (HERMES_HOME
    // aware) and its config's `skills.external_dirs` all come from the host.
    nativeRootsResolver: resolveHermesNativeRoots,
  },
];

/**
 * The provider ids a user-configured agent may not take.
 *
 * Only the always-listed agents are reserved. An installed-only agent is one
 * bb hides unless its CLI is present, and overriding it — with a different
 * command, extra args, a private build — is a documented thing to do, so a
 * configured agent with that id REPLACES the shipped registration instead of
 * being rejected. The always-listed ones stay reserved because a user who
 * shadowed them would lose the agent bb guarantees is there.
 */
export const RESERVED_ACP_PROVIDER_IDS: ReadonlySet<string> = new Set(
  KNOWN_ACP_AGENTS.filter(
    (agent) => (agent.visibility ?? "always") === "always",
  ).map((agent) => agent.id),
);

/**
 * The ACP agents bb ships knowledge of.
 *
 * Each entry is a launch spec plus the facts a provider declaration needs.
 * There is nothing privileged about them: a user-configured agent and a
 * third-party plugin's agent are the same shape, and every one of these
 * could be moved into a plugin of its own without a core change.
 */

import type { AcpAgentDefinition } from "./agents.js";

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
    icon: "./icons/cursor.svg",
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
    },
  },
  {
    id: "acp-opencode",
    displayName: "opencode",
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
    },
  },
  {
    id: "acp-omp",
    displayName: "omp",
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
    },
  },
  {
    id: "acp-grok",
    displayName: "Grok Build",
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
    },
  },
  {
    id: "acp-hermes-agent",
    displayName: "Hermes Agent",
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
  },
];

/** The provider ids a user-configured agent may not take. */
export const KNOWN_ACP_PROVIDER_IDS: ReadonlySet<string> = new Set(
  KNOWN_ACP_AGENTS.map((agent) => agent.id),
);

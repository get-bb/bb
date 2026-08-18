import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";

/**
 * Launch specs for the ACP providers bb bundles itself.
 *
 * Configured ACP agents (`customAcpAgents`) and known ACP agents both arrive
 * with a launch spec on the command; the bundled providers have no server-side
 * entry, so the registry falls back to this table when it packs the ACP
 * bridge's provider-scoped statics.
 */
export const BUILT_IN_ACP_LAUNCH_SPECS: Readonly<
  Record<string, HostDaemonAcpLaunchSpec>
> = {
  "acp-cursor": {
    displayName: "Cursor",
    // Cursor installs both `cursor-agent` and the generic `agent` alias. Use
    // the namespaced executable so another provider's `agent` binary earlier
    // on PATH cannot silently replace Cursor and collapse model discovery to
    // the synthetic fallback.
    command: "cursor-agent",
    // Global flags must precede the `acp` subcommand, matching the documented
    // `cursor-agent --api-key ... acp` form.
    args: ["acp"],
    env: {},
    modelCli: {
      listArgs: ["--list-models"],
      selectFlag: "--model",
      // Family ids (the default variant's raw id), not raw variant ids: the
      // catalog folds effort and the `-fast` tail into one entry per family.
      primaryModels: [
        "auto",
        "cursor-grok-4.6-medium",
        "gpt-5.6-sol-medium",
        "claude-opus-5-thinking-medium",
        "claude-fable-5-thinking-medium",
        // Composer is one family now; its `-fast` twin is the Fast-mode tier.
        "composer-2.5",
      ],
    },
  },
};

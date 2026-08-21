# ACP providers

First-party plugin for ACP (Agent Client Protocol) agent providers: Cursor,
opencode, omp, Grok Build and Hermes Agent.

The plugin has no bridge of its own. Every agent it registers runs on the
published ACP kit, `@get-bb/plugin-sdk/provider-bridge/acp`, which its
`bb.host` entry re-exports in one line (`src/host.ts`). That is the whole
point of the kit: a third-party plugin adds an ACP agent exactly the way this
one does, with no bb-side code, and `public-sdk-only.test.ts` proves this
plugin takes no shortcut — no file here may import a private `@bb/*` package.

What lives here:

- `server.ts` — the provider registrations: ids, display names, icons,
  capabilities, and the bridge options each agent launches with
  (`acpLaunchSpec`, and `acpDialect` for the agents whose vendor side
  channels the kit reads).
- `src/host.ts` — the `bb.host` artifact: one re-export of the kit's bridge.
- `icons/` — the provider logos.

The kit itself, including the ACP wire schema, the delta translation, the
per-agent dialects and the bridge process, is `packages/provider-bridge-acp`.

Still composed server-side, transitionally: the `customAcpAgents` server
config for user-configured agents.

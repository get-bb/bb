# ACP providers

First-party plugin for ACP (Agent Client Protocol) agent providers — phase 4
of `plans/agent-provider-plugin-surface.md`.

Today this plugin registers only the `acp-cursor` (Cursor) provider
declaration. The rest of BB's ACP surface — the known-agents list (opencode,
Grok, Hermes Agent, OMP, ...) and the `customAcpAgents` server config — stays
composed server-side transitionally. This plugin is destined to own the
Cursor profile, the known-agents list, and the `customAcpAgents` config
(which then finally gets a settings UI); until that migration lands, only the
Cursor declaration lives here and the server keeps composing the other ACP
providers into listings itself.

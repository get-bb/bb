# Fake ACP agent knobs

`fake-acp-agent.mjs` reads these environment variables. They are listed here instead of in the script.

- `FAKE_ACP_AUTH_FAILURE_ONCE=1` fails the first authenticate, then accepts it.
- `FAKE_ACP_AUTH_REJECT=invalid|expired` rejects an advertised method without a session.
- `FAKE_ACP_EXIT_ON_AUTHENTICATE=<code>` exits during authenticate, before any session.
- `FAKE_ACP_PROMPT_IMAGE=1` advertises `promptCapabilities.image`.
- `FAKE_ACP_PROMPT_EMBEDDED=1` advertises `promptCapabilities.embeddedContext`.
- `FAKE_ACP_GROK_SUBAGENT_NOTIFY_BEFORE_RESULT=1` emits subagent lifecycle notifications before the spawn tool result.
- `FAKE_ACP_GROK_SUBAGENT_SPAWN_RESULT_ON_TOOL_CALL=1` emits those notifications, then one completed `tool_call` carrying the spawn result.
- `FAKE_ACP_GROK_SUBAGENT_WRONG_TEXT=1` sends `WRONG` instead of the requested tell text.
- `FAKE_ACP_GROK_SUBAGENT_RESULT_ON_TOOL_CALL=1` puts the completed tool result on the first `tool_call`.
- `FAKE_ACP_CONFIG_DELAY_MS=<ms>` waits before answering `session/set_config_option` for `approach`.

Prompt text `advertise-commands` advertises the configured slash commands, twice.

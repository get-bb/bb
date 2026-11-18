# Fake ACP agent knobs

`fake-acp-agent.mjs` reads these environment variables. They are listed here instead of in the script.

- `FAKE_ACP_AUTH_FAILURE_ONCE=1` fails the first authenticate, then accepts it.
- `FAKE_ACP_AUTH_REJECT=invalid|expired` rejects an advertised method without a session.
- `FAKE_ACP_EXIT_ON_AUTHENTICATE=<code>` exits during authenticate, before any session.
- `FAKE_ACP_PROMPT_IMAGE=1` advertises `promptCapabilities.image`.
- `FAKE_ACP_PROMPT_EMBEDDED=1` advertises `promptCapabilities.embeddedContext`.
- `FAKE_ACP_GROK_SUBAGENT_NOTIFY_BEFORE_RESULT=1` emits subagent lifecycle notifications before the spawn tool result.

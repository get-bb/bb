# Recording redactor

`redact.mjs` prepares provider-bridge recordings so they can be committed. The script header stays the original usage note. This file describes the behavior that note does not.

- Environment maps are rewritten in full. `GROK_ACTIVE_AGENT_MESSAGES=1` and `FAKE_ACP_GROK_SUBAGENT_KEEP_RUNNING=1` are kept. The record-directory variable is dropped. `authMethods` is not treated as a secret field.
- Free-form user content is replaced. Long strings are trimmed on Unicode character boundaries.
- Grok spawn results for `child-alpha` and `child-beta` are kept, and `subagent_id`, `task_id`, and `delivery` stay on tool input. The synthetic tell text `CHILD_MESSAGE 😀 مراجعة` is kept on the request only when that body is the entire text, on the action prompt, and on the matching tool input. A longer tell that merely contains the phrase is replaced. Only the synthetic interject texts `INTERJECT_FIRST 😀`, `INTERJECT_SECOND مراجعة`, and `INTERJECT_FIRST 😀 مراجعة` are kept. Any other steering text is replaced.
- Output is written to a staging directory and published only after every file passes the survivor sweep. Malformed input or a surviving secret leaves the previous output directory in place.

# Converted Claude Code transcripts

Redacted Claude Agent SDK message streams converted from real
`~/.claude/projects` session transcripts with
`scripts/provider-recordings/convert-claude-transcript.mjs`. They drive the
translator's non-streaming paths in `src/transcript-fixtures.test.ts`:
assistant `tool_use` blocks, user `tool_result` blocks, subagent sidechains
(`parent_tool_use_id`), the synthesized `task_*` family, system notices
(`api_retry`, `model_refusal_fallback`, `compact_boundary`) and turn results.

`manifest.json` names every source session (id, human-prompt turn window,
message counts, which messages the converter synthesized). `expected.json` is
the pinned projection per fixture; rewrite it deliberately with
`UPDATE_TRANSCRIPT_EXPECTATIONS=1`.

The source sessions are private and never committed. To regenerate (the
session files must exist locally):

```sh
scripts/provider-recordings/convert-claude-transcripts-sample.sh <out-dir>
```

Each `<name>.ndjson` is one SDK message per line, the `loadSessionFixture`
format. The set stays under 2 MB after redaction; add a session by extending
the sample script, not by hand-editing a stream.

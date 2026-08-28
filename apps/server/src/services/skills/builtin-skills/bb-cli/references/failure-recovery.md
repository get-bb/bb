# Failure and interruption recovery

## Failures And Interruptions

- For failed threads, inspect `bb thread show <id> --json` and
  `bb thread log <id>` before deciding whether to retry, clarify, or update the
  user.
- For interrupted or stopped threads, inspect first. If the user stopped the
  thread, treat that as intentional unless they ask you to continue.
- Use `bb thread stop <id>` when a thread is stuck or no longer needed.
- `bb thread stop <id>` also releases an idle or stuck agent runtime. The
  command is idempotent and preserves thread history.
- Use `bb thread compact <id>` to send the built-in `/compact` command to an idle or errored thread. Completion or failure appears in the timeline. Codex, Claude Code, Pi, and OpenCode ACP support it; Cursor ACP does not expose compatible compaction through ACP.
- Use `bb thread cancel-plan <id>` to exit an active Plan turn without
  optimistically clearing its banner. Use `bb thread clear-goal <id>` to clear
  a Codex thread's durable active Goal. Both wait for provider confirmation.

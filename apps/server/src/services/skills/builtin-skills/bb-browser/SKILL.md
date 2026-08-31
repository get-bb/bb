---
name: bb-browser
description: Use this when an agent must inspect or interact with a web application in BB's visible Browser through reproducible CLI commands.
---

# BB Browser

Use `bb browser` for visible, user-stoppable web QA. Browser automation is an
internal experiment and works only when the owning thread is open in a compatible
BB desktop app on the same trusted host as the CLI.

## Safe workflow

1. Open a fresh owned target. Automation cannot adopt an existing user tab.
2. Wait for expected text, then take a snapshot.
3. Use only refs from the current snapshot with native click, type, press, and
   exact-value select actions.
4. Wait and snapshot again after navigation or any meaningful page change. Refs
   expire after navigation and snapshot generation changes. Snapshot, screenshot,
   and wait resynchronize after page-initiated navigation; ref actions never do.
5. Take a screenshot only when visual evidence matters.
6. Close the target in cleanup or a `finally` block. Verify `list` is empty.

```sh
target=$(bb browser open "https://example.test" --json | jq -r .targetId)
trap 'bb browser close "$target" --json >/dev/null 2>&1 || true' EXIT
bb browser wait "$target" --text "Welcome" --json
bb browser snapshot "$target" --json
bb browser click "$target" --ref e0g1r3 --json
bb browser snapshot "$target" --json
bb browser screenshot "$target" --json
bb browser close "$target" --json
trap - EXIT
bb browser list --json
```

`BB_THREAD_ID` supplies the owner by default; `--thread <id>` overrides it.
Every command supports `--json`. Targets accept only HTTP(S) URLs and are always
visible.

Only one command may run on a target at a time. A busy error means wait for the
current command to settle. Stale-ref errors mean take a new snapshot and use its
refs. The Browser tab's Stop button or cancellation can interrupt a command;
inspect the current state before retrying. Do not retry a typed action blindly.
`type` inserts at the target's current selection or caret; it does not clear an
existing value. Use `press --key PageDown` or `press --key PageUp` for viewport
scrolling, then snapshot again before using refs. Screenshots are returned as
metadata and materialized under
`$BB_THREAD_STORAGE/browser-screenshots/` when available, otherwise in the
current directory. Screenshot bytes and page data are never printed as base64.

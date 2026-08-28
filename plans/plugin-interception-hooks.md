# Dispatch gates and holds (historical stub)

**Superseded. Kept as a pointer, not a plan.**

This file was the merged design for letting plugins intercept thread creation
and follow-up turns: two primitives — **gates** (plugin decisions at named
dispatch stages `thread.create` / `turn.submit` / `turn.failed`) and **holds**
(durable deferred dispatches in a `dispatch_holds` table with a generic
`holder`). All three of its phases shipped, and then
[plans/dispatch-queue-rework.md](dispatch-queue-rework.md) replaced them with
one parking lot (`queued_thread_messages`) and one checkpoint (the dispatch
attempt). Read that document instead; it is the live one.

What the rework changed, in one line each:

- Four parking mechanisms (`dispatch_holds`, `deferred_thread_messages`, the
  reprovision-parked turn, the drain-only queue) collapsed into the queue.
- Three gate stages collapsed into one, `"dispatch"`, plus the post-hoc
  `"turn.failed"`.
- The `hold` verdict became `wait`, which parks an ordinary queued row.

Designs that were written here and have since been **deleted from the code**
live in git history, not in this file. If one of them is wanted again, recover
it from there rather than re-deriving it:

- Holds: the `dispatch_holds` table, hold service/routes, `threads.holds`,
  `bb thread holds`/`release`/`cancel-hold`, the `system/dispatch-hold` event.
- Gate amendments: `PluginDispatchAmendments`, the `proceed { amend }` arm,
  the per-attempt amendment windows, and the "chosen by <plugin>" chip.
- `clearWait` and the wait `report()` progress transcript.
- The `pluginInputs` side channel (`--plugin-input`,
  `useComposer().experimental_setPluginInput`, the `plugin_inputs` column).
- The `fulfill` verdict and the provisioner registry, which were never built.
- The "Dispatch gates" settings panel and the `dispatchGateOrder` setting.

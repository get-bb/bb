# bb-plugin-small-ux-pack

The "Small UX pack" hero plugin — host-rendered UI with zero frontend code.
No dependencies, no build step: the shipped BB app renders everything from
`GET /api/v1/plugins/contributions`. It demonstrates:

- **`bb.ui.registerThreadAction("Summarize thread")`** — a button in the
  thread header. Clicking it shows the declarative `confirm` dialog, then the
  handler runs server-side: it sends a follow-up prompt to the thread via
  `bb.sdk.threads.send` (mode `"auto"`, so it starts a turn on an idle thread
  and queues/steers on a running one) and returns a success toast.
- **`bb.ui.registerThreadAction("Copy status")`** — the error-toast path.
  Thread actions run on the server, which cannot reach your clipboard, so
  this handler fetches the thread via `bb.sdk.threads.get` and then throws an
  error carrying the thread's status. The host renders the rejection as an
  error toast at the click site.

## Install

Requires the "Plugins" experiment (Settings → Experiments).

```
bb plugin install ./examples/plugins/small-ux-pack
bb plugin list
```

## Try it

- Open any thread in the browser — "Summarize thread" and "Copy status"
  buttons appear in the thread header. Click "Summarize thread", confirm, and
  watch the agent reply; click "Copy status" for the demo error toast.

After editing sources, `bb plugin reload small-ux-pack`.

# bb-plugin-thread-chat-demo

Demonstrates the SDK's host-owned `ThreadChat` component and the
`messageAction` slot:

- **Nav panel "ThreadChat demo"** — enter any thread id and the panel renders
  that thread's full chat (`<ThreadChat variant="full" layout="contained" />`).
  The "Focus composer" button exercises `focusRequest`.
- **Targeted fixed tab "Compact thread"** — the nav-page button calls the
  generic `experimental_useAppPanel().openFixedTab(...)` primitive with the
  page-owned registration and a typed thread target. The tab validates,
  consumes, and renders that transient target without putting it in the URL or
  persisted panel state. "View source" also demonstrates imperative URL
  opening through BB's preference router.
- **Message action "Open in demo panel"** — appears on every chat message's
  action bar and in the assistant-message text-selection menu. It opens this
  plugin's own thread panel via `context.openPanel({ actionId, params })`,
  passing the anchored message text (or the exact selection) through `params`,
  and renders the current thread compactly with
  `<ThreadChat variant="compact" />`.

## Install

```
bb plugin install ./examples/plugins/thread-chat-demo
```

## Try it

- Sidebar → "ThreadChat demo": paste a `thr_…` id and chat with the thread
  from the panel. Drafts, queueing, and streaming are the host's real chat
  engine — the plugin only supplied the thread id.
- Open any thread, hover a message, and pick "Open in demo panel" (also
  available when selecting assistant text) to see the message-anchored panel.

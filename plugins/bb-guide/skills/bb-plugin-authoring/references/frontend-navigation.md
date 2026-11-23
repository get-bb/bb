# Opening and linking threads, messages, the New thread screen and settings

`useBbNavigate()` in components and `context.navigate` in callbacks have the
same members. Never push history state, dispatch `popstate`, or build
`/threads/…`, `#msg=` or `/settings/…` paths by hand: bb's routes change.

## A message in a thread

```ts
navigate.toThread(threadId, { messageSeq: seq });
navigate.toThread(threadId, { split: true, messageSeq: seq });
```

bb opens the thread at the message the way a message link does: it loads
older history, scrolls to the message and highlights it, or toasts "Message
not found". Calling it again reveals the message again. Take the seq from
`ThreadChatMessageReference.experimental_messageSeq` (message actions), a
message metadata component's `message.messageSeq`, or the
`messageSeq` of `useSdk().threads.timeline()` conversation rows. Do not page
or scroll the timeline DOM yourself. A seq that is not a non-negative integer
throws `RangeError`.

## The New thread screen

```ts
navigate.toCompose({ projectId, initialPrompt, focusPrompt: true });
navigate.toCompose({ projectId, focusPrompt: true, split: true }); // beside the caller
navigate.toCompose({ initialPrompt, experimental_replacePrompt: true }); // replace the draft
```

`initialPrompt` only seeds an empty draft; a draft with text keeps it and the
prompt is dropped. Pass `experimental_replacePrompt: true` from an explicit
"Edit via chat" or "Create from template" button to replace the draft, as
bb's own Create skill does.

`split: true` follows `toThread`'s split rules: a right split by default,
replace at the pane cap, plain navigation where splits are off. bb has one New
thread screen, so if it is already open in a pane, bb focuses that pane and
applies the other options there.

## Settings

```ts
navigate.experimental_toSettings(); // this plugin's settings page
navigate.experimental_toSettings({ section: "appearance" }); // a bb section
```

`section` is an `ExperimentalSettingsSection`; an unknown one throws
`RangeError`. Settings replaces the whole window, split panes included, and
Back returns to them.

## Hrefs

```tsx
<>
  <a href={navigate.experimental_threadHref(threadId, { messageSeq: seq })}>
    Open message
  </a>
  <a href={navigate.experimental_settingsHref()}>Settings</a>
</>
```

Each href builder takes the same arguments as the call it mirrors and
returns the app-relative location that call opens. bb routes a plain click
on it in place; Cmd/Ctrl-click opens a split and middle-click a new tab. A
thread whose project bb has not loaded gets `/threads/<id>`, which bb
redirects to the project route, keeping the message. For a URL to copy, use
`new URL(href, location.origin)`, as bb's Copy link does. A thread from
`experimental_useSidebarThreads` already carries `href`.

Experimental: see `docs/api_to_audit.md`.

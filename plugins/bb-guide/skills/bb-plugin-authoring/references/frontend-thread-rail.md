# The thread outline and the rail beside the conversation

Every thread pane that shows the full conversation has a rail at the
conversation's right edge. bb's thread outline sits at its top: ticks for your
prompts, and a popover listing prompts and agent replies. A plugin can replace
that outline, or add an item under it.

## Replacing bb's outline

`app.slots.experimental_threadRailOutline({ id, component })` draws the outline
instead of bb's. It is an exclusive slot (references/exclusive-slots.md): the
user's pick is `threadRail.outlineProvider` (Settings > Appearance >
Interface > Thread outline), which can also choose bb's (`__builtin__`).
bb's own outline is registered through this slot too. A crash shows bb's
outline for that thread.

```tsx
import {
  definePluginApp,
  experimental_useConversationOutline,
  experimental_useTimelineViewport,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadRailOutlineProps } from "@get-bb/plugin-sdk";

function Timeline({ threadId, visible }: ExperimentalThreadRailOutlineProps) {
  const prompts = experimental_useConversationOutline(threadId, "user", {
    enabled: visible,
  });
  const viewport = experimental_useTimelineViewport();
  const navigate = useBbNavigate();
  const inView = new Set(viewport?.visibleMessageIds ?? []);
  return (
    <ol>
      {prompts.items.map((item) => (
        <li key={item.id} aria-current={inView.has(item.id)}>
          <button
            onClick={() =>
              navigate.toThread(threadId, { messageSeq: item.messageSeq })
            }
          >
            {item.preview || "Attachment"}
          </button>
        </li>
      ))}
    </ol>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadRailOutline({
    id: "timeline",
    component: Timeline,
  });
});
```

Do not hide `[data-thread-toc]` with CSS to replace bb's outline; register an
outline and let the user pick it.

## Adding an item to the rail

`app.slots.experimental_threadRail({ id, order?, component })` adds an item
under the outline, such as a minimap. Items stack by `order` ascending (unset
last, ties in registration order). Return null to take no space. A crash
removes only that item for that thread.

## Props

Both components receive `ExperimentalThreadRailProps`: the header row's
`{ threadId, projectId, environment }` plus `visible`. The component mounts
once per visible thread pane, so keep per-thread state in the component.
`visible` is false while the pane is too narrow for a rail; bb keeps the item
mounted, hidden and inert then, so pass it as `enabled` to reads that only feed
what you draw. The rail does not show in side-panel or embedded transcripts.

## The thread's messages

`experimental_useConversationOutline(threadId, role, { enabled? })` returns
`{ status, items }` for `"user"` prompts or `"assistant"` replies, oldest
first, across the whole thread, including messages bb has not loaded or drawn.
While the thread is open in a pane, new prompts and streaming replies appear at
once. Each item has:

- `id`: the message's id, as in `ThreadChatMessageReference.id` and the
  viewport's `visibleMessageIds`.
- `messageSeq`: pass it to `navigate.toThread` or
  `navigate.experimental_threadHref`. A reply still streaming reports its
  latest update's sequence until it completes, so read it again rather than
  keeping it.
- `preview`: up to 200 characters, whitespace collapsed, empty for an
  attachment-only message.
- `senderThreadId`: the thread that sent a user message, or null. Its
  `[bb message from thread:…]` prefix is already removed from `preview`; name
  the thread with `experimental_useThread(senderThreadId)`.
- `attachmentSummary`: `{ imageCount, fileCount }` or null.

`items` keeps its identity until an item changes: a user list changes when a
prompt is added, an assistant list with each update of a streaming reply. Read
`"assistant"` only while you show replies. With `enabled: false` bb makes no
request and `status` stays `loading`.

## What the pane shows

`experimental_useTimelineViewport()` returns `{ visibleMessageIds, atLatest }`
for the thread pane the component renders in (the rail, message metadata,
timeline renderers), or null elsewhere, including the thread header. It
updates once scrolling or resizing settles and re-renders only when the answer
changes. bb's outline marks the first visible prompt, or the last one when
`atLatest`.

## Revealing a message

`useBbNavigate().toThread(threadId, { messageSeq })` loads older history as
needed, scrolls to the message and highlights it, even when it is far outside
the rendered rows. When the focused pane already shows the thread, as after a
click in it, bb reveals in place and replaces the history entry. Do not scroll
the transcript yourself or send synthetic wheel events.

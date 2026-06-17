---
id: thread-forking-and-side-chats-e159
name: Thread Forking and Side Chats
status: approved
created_date: 2026-06-10
description: Fork a thread from any agent message into a new isolated thread, and spawn context-aware "side chats" as right-panel tabs, both surfaced as per-message actions in the timeline.
---

# Thread Forking and Side Chats

## Overview

Today a bb thread is a single linear conversation. To explore an alternative
direction, a user must start a brand-new thread from scratch and lose their place;
to ask a quick clarifying question they must interrupt the main conversation. Two
complementary affordances, both anchored on a specific **agent message** in the
timeline, fix this:

1. **Fork** (`TrendingUpDownIcon`) — branch a new isolated thread from the chosen
   agent message. The new thread opens with that message rendered as its anchor and
   the prompt box focused, so the user types a new direction. Returning to the
   source thread restores the scroll position the user left.
2. **Side chat** (`MessageAdd02Icon`) — open a lightweight child thread in a
   right-panel tab to ask questions about the current work. It can see the main
   thread's conversation context and hand a result back into it, without derailing
   the main conversation.

Both are exposed through a shared, hover-revealed **message action bar** beneath
each agent message — the third caller of the existing hover-copy pattern, which we
extract into one reusable component.

### Why now / prior art

Forking-from-a-message is now common and converges on a clear model: anchor on a
specific message, leave the original immutable, make lineage explicit. Side chats
("ephemeral but promotable") are the emerging answer to "let me ask a quick
question without losing my place."

- **ChatGPT "Branch in new chat"** (Sept 2025) — per-message `⋯` menu; new full
  conversation seeded with everything up to the branch point; original untouched.
  Documented weakness: **no parent↔child linkage** — branches orphan in the sidebar.
  *(Lesson: make lineage first-class.)*
- **Cursor "Duplicate Chat"** — per-message menu branch keeping context to a point;
  plus chat **tabs** (`⌘T`) and `@Past Chats` for explicit cross-chat context.
- **Claude Code `--fork-session` / `/branch`** — copy-on-write history into a new
  session id; original untouched. The cleanest "fork = copy into a new id" model.
- **Zed** — parallel threads + "New From Summary"; a community request articulates
  best-practice fork UX: instant, **visible lineage**, auto name `"Original (fork)"`.
- **Raycast Quick AI / Notion AI sidebar chat** — the side-chat model: lightweight
  entry, real multi-turn, one-keystroke **promote to a persistent chat**.

Full sourced research is summarized in *Future Considerations → Research notes*.

## Goals / Non-Goals

### Goals
- A **Fork** action on every agent message that creates a new thread, navigates to
  it, renders the originating agent message as the anchor, and focuses the composer
  **without triggering an agent turn** (the user steers next).
- The forked thread runs in a **fresh worktree branched from the source thread's
  current branch HEAD** (captures the source agent's committed work) and is **linked
  to the source** via `parentThreadId` + `childOrigin: "fork"`.
- **Scroll-position preservation**: leaving a thread saves its timeline position;
  returning restores it instead of snapping to the bottom.
- A **Side chat** action on every agent message that opens a **child thread inside a
  right-panel tab** (own tab icon + title) which **sees the main thread's
  conversation context** and can **hand a result back** to the main thread.
- A reusable **message action bar** (copy + fork + side chat) replacing the current
  inline single-button hover footer.
- Register `TrendingUpDownIcon` and `MessageAdd02Icon` in the icon system.

### Non-Goals
- **Full-transcript / context-faithful forking.** bb threads don't share provider
  sessions; v1 forks carry the single anchor message, not the whole prior context.
- **Side chats reading live code (v1).** Per product decision, v1 side chats answer
  from **conversation context only** — the `agent-only` snapshot is the main thread's
  conversation, never its worktree files. (Reading the *source* thread's files is a
  future enhancement.) Note this is about *context source*, not workspace: per the
  review fix, a side chat does run in its **own same-project readonly worktree** (a
  fresh isolated checkout), because a personal/no workspace is rejected outside the
  personal project. The side chat simply does not pull the source's files into its
  context.
- **Carrying uncommitted source edits into a fork (v1).** The fork branches from the
  source branch HEAD; uncommitted working-tree changes are not carried.
- **Conversation-tree visualization.** Lineage is a parent↔child link + back-nav,
  not a DAG/graph UI.
- **Editing/replacing the originating message** ("edit-branch" trees). The source is
  immutable; fork/side-chat only *read* from it.
- **A net-new ephemeral conversation engine.** A side chat is a real (child) thread,
  not an in-memory session with bespoke model plumbing.
- **Merge/diff of forked code branches**, **compaction / "summarize and restart"**,
  and **code-state checkpoints** — distinct concepts, explicitly out of scope.

## User Stories

1. *As a user mid-thread*, I hover an agent message, click **Fork**, and land in a
   new thread whose first row reads "Message from {source thread}" with the fork
   icon, composer focused — I type a different approach and continue. The forked
   agent does not respond until I send my direction.
2. *As a user who forked*, I click back to the original thread and find it scrolled
   to roughly where I left it, so I can keep reading or fork again from elsewhere.
3. *As a user*, I open the source thread's metadata and can navigate to its forks
   (and from a fork back to its source) — the lineage is visible, not orphaned.
4. *As a user with a question about the conversation*, I click **Side chat** under an
   agent message; a tab opens in the right panel; I ask "why did you take that
   approach?" and get an answer grounded in the main thread's discussion, without
   touching the main conversation. *(v1: answerable from conversation, not from
   reading live code.)*
5. *As a user with a useful side-chat result*, I click **Send to main thread** and
   the conclusion appears in the main conversation as a "Message from {side chat}".

## Architecture

### Where each piece attaches (grounded in current code)

| Concern | Existing anchor | Change |
|---|---|---|
| Per-message actions | `AssistantConversationMessage` footer `<div className="mt-1 flex justify-start">` with `CopyButton`, under the root `group` div (`ConversationMessageContent.tsx`) | Extract `MessageActionBar` (copy + fork + side chat); forward row identity into the component |
| Row identity plumbing | `ConversationRow` (`ThreadTimelineRows.tsx:654`) passes only display props | Forward `id`, `turnId`, `threadId`, `sourceSeqStart/End`, `text` into the assistant message props |
| Thread creation | `POST /threads` → `createThreadFromRequest` (`thread-create.ts:263`); contract `createThreadRequestSchema` (`api-types.ts:535`); requires `origin`, `input` (≥1), `environment` | Add `startedOnBehalfOf` (see Contract); creation stays server-lifecycle-owned |
| Turn initiator | thread-start turn dispatched in `thread-turn-dispatch.ts:35-139`, where `initiator`/`senderThreadId` are written | Thread `startedOnBehalfOf` through provisioning → thread-start dispatch (the real plumbing for the anchor) |
| Create→navigate→focus | `RootComposeView.submitPrompt:506` → `useCreateThread()` → `navigate(getThreadRoutePath(...))` | Reuse the *sequence*, with a fork-specific request body |
| Agent-initiated anchor render | `UserConversationMessage` routes `initiator==="agent"` → `GeneratedConversationMessage` → `ExpandableTimelineRow leadingIcon` (top-left) | Reuse as-is; supply the fork icon |
| Lineage link | `parentThreadId` (validated `thread-parent.ts:108`, depth ≤ 4, no cycles); parent link rendered in `ThreadMetadataContent.tsx:112` | Set on fork + side chat; add `childOrigin`; add a forks list to metadata |
| Right panel | Jotai per-thread tab state `fixedPanelTabsStateAtomFamily` (`fixed-panel-tabs.ts`); union `SecondaryFixedPanelTab` (`fixed-panel-tabs-state.ts:228`); per-kind icon/title in `ThreadDetailView.tsx:711`; keep-mounted **browser deck** precedent | Add a `side-chat` tab kind + lazy content host |
| Scroll persistence | `BottomAnchoredScrollBody` (`bottom-anchored-scroll-body.tsx`) exposes `captureScrollAnchor` / `scrollElementIntoView`; force-remounted via `key={threadId}` (`ThreadTimelinePane.tsx:170`), mounts at bottom | Add in-memory per-thread anchor atom; capture continuously, restore by row id |
| Cross-thread send | `thread-send.ts` (agent→thread message) | Reuse for "hand result back" |
| Icons | `ICON_MAP` in `icon.tsx` (e.g. `ArrowTurnForward: ArrowTurnForwardIcon`) | Register `Fork: TrendingUpDownIcon`, `SideChat: MessageAdd02Icon` |

### Reused primitives that keep this small
- **Agent-initiated user messages already exist.** A `client/turn/requested` event
  carries `initiator: "user" | "agent" | "system"` and `senderThreadId`
  (`thread-events.ts:36,92`; `senderThreadId` is `nullable`, non-null only when
  `initiator === "agent"`). `initiator === "agent"` renders via
  `GeneratedConversationMessage` as **"Message from {thread}"** with a top-left
  leading icon — the forked-anchor rendering, no new render path.
- **`agent-only` prompt-part visibility** (`shared-types.ts:46`) — parts sent to the
  runtime but not rendered. The mechanism for seeding a side chat with main-thread
  context the user doesn't see.
- **Cross-thread send** (`thread-send.ts`) — the existing agent→thread transport
  behind "hand a result back."

## Detailed Design

### Feature 1 — Fork

**Trigger.** `MessageActionBar` renders a hover-revealed `Fork` icon button
(`opacity-0 … group-hover:opacity-100 focus-visible:opacity-100`) under each agent
message. Disabled/hidden when the source thread is at the depth-4 hierarchy cap
(see *Depth guard*). Click → `forkThreadFromMessage({ sourceThreadId,
sourceMessageText, sourceTurnId })`.

**Request body.** Reuse the create→navigate→focus *sequence* from
`RootComposeView`, with a fork-specific `CreateThreadRequest`:
- `origin: "app"`, `projectId` = source's project.
- `input` = the forked agent message's text (single visible text part).
- `startedOnBehalfOf: { initiator: "agent", senderThreadId: <source thread id> }`
  → renders the anchor as "Message from {source}".
- `parentThreadId` = source thread id (lineage; passes depth/cycle guards).
- `environment` = fresh managed worktree branched from the source's **current
  branch HEAD**:
  `{ type: "host", hostId: <source's hostId>, workspace: { type: "managed-worktree",
  baseBranch: { kind: "named", name: <source thread's branch> } } }`.
  `hostId` and the branch name are resolved from the source thread's environment.
- `providerId` / `model` / `permissionMode` inherited from the source thread.

**Anchor must not auto-trigger a turn — KEY DESIGN DECISION.** A normal thread-start
turn runs the provider. For fork we must show the anchor row but **wait for the
user's first message** before the agent acts. Two candidate implementations:

- **A (preferred): immediate create, display-only anchor.** Create the thread with
  the anchor as the thread-start input + `startedOnBehalfOf`, flagged so the
  thread-start turn is **persisted/displayed but not dispatched to the provider**.
  The user's first message becomes the first executed (`initiator: "user"`) turn.
  Requires confirming/adding a "seed without run" capability in
  `thread-turn-dispatch.ts`. Matches the user story most literally (navigate to the
  new thread; it already exists).
- **B (fallback): deferred create.** Clicking fork navigates to a fork-compose
  surface (precedent: `useCreateThreadInWorktree` seeds env via `location.state`)
  showing the anchor preview + focused composer; the thread is created on first
  submit. Avoids the non-triggering problem but the thread doesn't exist until
  submit, so back-navigation and lineage are deferred.

This decision is load-bearing and must be resolved during planning by checking
whether bb can persist a thread-start turn without a provider run (Open Question 1).

**Navigate + focus.** On success, `navigate(getThreadRoutePath({ projectId,
threadId }))`. Focus the composer once the thread is interactive — creation is
async/lifecycle-owned (status `provisioning`), so **focus is deferred until the
thread is ready to accept input**, not assumed at navigate-time.

**Anchor icon.** The anchor row's leading icon is the **fork icon** (`Fork` /
`TrendingUpDownIcon`), for consistency with the fork button. *(The original request
named `MessageAdd02Icon` here, but that is the side-chat button icon; using the fork
icon avoids the collision.)*

**Lineage.** Source thread metadata gains a "Forks" list (children with
`childOrigin === "fork"`); the fork links back to its source via the existing
parent-thread link (`ThreadMetadataContent.tsx:112`). Forks auto-title
`"{source title} (fork)"`.

**Depth guard.** `parentThreadId` enforces depth ≤ 4 (`thread-parent.ts`). The
Fork **and** Side-chat actions are disabled (with a tooltip) when the source thread
is already at max depth, so the user never clicks into an opaque create failure.

### Feature 2 — Side chat

**Trigger.** `MessageActionBar` renders a hover-revealed `SideChat`
(`MessageAdd02Icon`) button (same depth guard). Click →
`openSideChat({ sourceThreadId, sourceMessageText })`, which opens a right-panel
tab. A side chat is always anchored to a message, so it is **not** added to the
generic "+" new-tab menu in v1.

**What it is.** A **child thread** (`parentThreadId` = main thread,
`childOrigin: "side-chat"`) rendered inside a right-panel tab, reusing the full
thread/provider/timeline stack. Persisted and promotable (navigate to it for a
full view). "Session" = a scoped child thread.

**Lazy creation.** The tab opens immediately with a focused composer; the child
thread is **created on the user's first submit** (avoids the "create requires
`input` ≥ 1" / premature-agent-turn problem). That first turn carries:
- `input` = the user's question (visible) + the **main-thread context snapshot** as
  `agent-only` parts.
- `parentThreadId` = main thread; `childOrigin: "side-chat"`.
- `environment` = a **same-project fresh managed worktree** branched off the source
  thread's host + branch (its own checkout), resolved by the shared
  `resolveChildThreadEnvironment` helper that also builds the fork's environment.
  It falls back to the **personal workspace** only when the source has **no host**
  (a personal-project source). **Forced decision (review fix):** routing a
  standard-project side chat into the personal workspace is *not* viable — the
  server rejects personal workspaces outside the personal project
  (`assertProjectWorkspaceCompatibility`), and personal-project routing would break
  both the same-project `parentThreadId` guard and the cross-project send-back. The
  side chat therefore always runs in **its own same-project readonly worktree**, not
  a personal/no-workspace environment. v1 still does not *use* the worktree files for
  context (the snapshot is conversation-only); the worktree is the side chat's own
  isolated checkout, not a window into the source's files.
- `permissionMode: "readonly"`.

**Context snapshot (decision: snapshot at creation, bounded window).** The
`agent-only` context is a one-time snapshot taken at first submit: the spawning agent
message + a bounded recent window of the main thread (the current turn and a few
preceding messages; window size `N` is a tunable, default small). It does **not**
refresh with later main-thread activity. Documented limitation; "re-seed latest
main-thread tail each turn" is a future enhancement. v1 reach is conversation only
— the side chat cannot read live worktree files (Non-Goals).

**Panel integration.** In `fixed-panel-tabs-state.ts`: add
`SideChatFixedPanelTab { kind: "side-chat"; id; threadId: string | null; title }`
(`threadId` null until lazily created) + Zod schema + factory; add to
`SecondaryFixedPanelTab` and closable `SecondaryFileFixedPanelTab`; handle in every
`switch (tab.kind)` (`useThreadFileTabs.ts:376`, `ThreadDetailView.tsx:711`,
`areFixedPanelTabsEquivalent`). Tab icon = `SideChat`, title derived from the source
message (then the child thread's title once created), set in the per-kind block of
`ThreadDetailView.tsx:711`. Content component `SideChatTabContent` in
`ThreadSecondaryPanelTabContent.tsx`, **kept mounted** like `BrowserTabDeck` so
streaming state survives tab switches.

**Composer reuse — to confirm during planning.** The side-chat composer should reuse
the low-level editor `PromptBoxInternal` (`apps/app/src/components/promptbox/
PromptBoxInternal.tsx`) rather than the heavyweight thread-specific
`FollowUpPromptBox`. Planning must confirm `PromptBoxInternal` can drive turns on a
thread that is **not** the route's active thread; if it can't, the side-chat
composer is a larger lift than implied here.

**Hand a result back.** A "Send to main thread" action in the side-chat composer
calls the existing cross-thread **send** hook directly (no bespoke wrapper): the
child posts into the main thread, rendering there as "Message from {side chat}".

### Feature 3 — Scroll-position preservation

**Problem (grounded).** The timeline scroll subtree is force-remounted on thread
switch (`key={threadId}` at `ThreadTimelinePane.tsx:170` and
`ThreadDetailSecondaryContent.tsx:254`); `BottomAnchoredScrollBody` initializes
`shouldStickToBottomRef = true` and runs `queueBottomRestore()` on mount, so a
returning thread lands at the **bottom** and the prior position is lost.

**Design (revised per review — anchor by row, capture continuously).**
- A per-thread **in-memory** anchor store
  `threadTimelineScrollAnchorAtomFamily` (`atomFamily(() => atom<ScrollAnchor | null>(null))`,
  no persistence — a stale pixel offset across reloads/content changes is fragile).
  `ScrollAnchor = { rowId: string; offsetWithinRow: number; atBottom: boolean }`.
- **Capture continuously**, not on unmount: a throttled `onScroll` handler in
  `BottomAnchoredScrollBody` writes the current top-most visible row id (from the
  existing `data-timeline-row-id` wrappers) + within-row offset + `atBottom` to the
  atom. This guarantees the value is current before the `key={threadId}` teardown
  (an unmount-time read races the remount and is unreliable).
- **Restore by row id** on mount: if a saved anchor exists and `atBottom` was false,
  use the existing `scrollElementIntoView` to bring `rowId` into view (plus the
  within-row offset) and **suppress** the mount-time `queueBottomRestore()` /
  `shouldStickToBottomRef = true`. If `atBottom` was true (common live-streaming
  case), keep stick-to-bottom. Anchoring to a row id (not a raw pixel offset)
  tolerates async hydration / differing row heights on remount; if the row isn't
  present yet, re-apply once after content settles, else fall back to bottom.

### Shared: `MessageActionBar`

Extract the footer into `MessageActionBar` (props: `messageText`, `onFork`,
`onSideChat`, `alignment`, `disabled`). Copy is currently the only action and
appears in two footers (agent + user, `ConversationMessageContent.tsx`); fork +
side chat make it the third+ caller — the AGENTS.md "reuse before duplicating"
threshold. The user footer keeps copy only; the agent footer gets copy + fork +
side chat. Same hover-reveal classes; small icon-only buttons styled like
`CopyButton`.

## API / Interface

### Contract change (`packages/server-contract`)
A single discriminated field on `createThreadRequestSchema` (not two loose
optionals — per AGENTS.md optional-field discipline), reconciled with the existing
`senderThreadId: z.string().nullable()` event invariant:
```ts
// "started on behalf of another thread/agent"; null/absent ⇒ normal user start.
startedOnBehalfOf: z
  .object({
    initiator: z.enum(["agent", "system"]),
    senderThreadId: z.string().min(1),
  })
  .nullable(),
```
Filled at the server boundary (default `null`), threaded through
`createThreadFromRequest` → provisioning context → the thread-start turn dispatch in
`thread-turn-dispatch.ts`, where `initiator`/`senderThreadId` are written onto the
`client/turn/requested` event. It must **not** be accepted-but-ignored; if the
plumbing can't be completed it is not a valid v1 contract addition.

### Thread record (`packages/domain`)
```ts
// distinguishes the two link origins for the Forks list + labels; nullable for
// threads created normally. Requires a thread-table migration.
childOrigin: "fork" | "side-chat" | null;
```

### Client hooks (`apps/app`)
```ts
forkThreadFromMessage(args: {
  sourceThreadId: string; sourceMessageText: string; sourceTurnId: string | null;
}): Promise<Thread>;                    // build fork request → create → navigate → (deferred) focus

openSideChat(args: {
  sourceThreadId: string; sourceMessageText: string;
}): void;                               // open panel tab; child thread created lazily on first submit
```
"Send to main thread" calls the existing cross-thread-send hook directly — no new
wrapper.

### Panel tab kind (`apps/app/src/lib/fixed-panel-tabs-state.ts`)
```ts
interface SideChatFixedPanelTab { kind: "side-chat"; id: string; threadId: string | null; title: string; }
// + schema, factory, union arms, switch arms
```

### Scroll store (`apps/app`)
```ts
interface ScrollAnchor { rowId: string; offsetWithinRow: number; atBottom: boolean; }
const threadTimelineScrollAnchorAtomFamily = atomFamily(() => atom<ScrollAnchor | null>(null));
```

### Icons (`apps/app/src/components/ui/icon.tsx`)
```ts
import { TrendingUpDownIcon, MessageAdd02Icon } from "@hugeicons/core-free-icons";
// ICON_MAP: Fork: TrendingUpDownIcon, SideChat: MessageAdd02Icon
```

## Data Model

- **No new persisted entity.** Forks and side chats are ordinary threads (`thr_*`)
  distinguished by `parentThreadId` + the new `childOrigin` field + the thread-start
  turn's `initiator`/`senderThreadId`.
- **`childOrigin`** is the explicit discriminator (inference from turn shape is
  ambiguous — fork and side-chat both produce `initiator: "agent"` starts). Adds a
  nullable thread column + migration.
- **Scroll anchor** is in-memory only (Jotai atom family), never persisted.
- **Panel tab state** (open side-chat tabs) persists in the existing per-thread
  `fixedPanelTabsStateAtomFamily` localStorage, like other tabs (with `threadId`
  null for a not-yet-submitted side chat).

## Future Considerations

- **Richer fork context** — attach prior conversation as `agent-only`, or a summary
  seed (Zed "New From Summary"), if the single-message anchor proves thin.
- **Carry uncommitted source edits into a fork** — auto-commit (or stash/apply) the
  source worktree's dirty state before branching.
- **Side chat reading live worktree files** — relax the reuse guard for read-only
  threads, or snapshot the workspace, so a side chat can inspect exact code.
- **Live side-chat context** — re-seed the latest main-thread tail each turn instead
  of a one-time snapshot.
- **Promote side chat → full thread** as a one-click affordance (Raycast model);
  already possible by navigating to the child thread.
- **Lineage visualization** beyond the flat parent↔child link.
- **Side chat from user messages / arbitrary points**, and a generic "+ new side
  chat" entry, once the message-anchored flow is validated.

### Research notes (sourced prior art)
- **Forking** is dominantly a per-message action that copies from a point and leaves
  the original immutable: ChatGPT *Branch in new chat*, Cursor *Duplicate Chat*,
  Claude Code `--fork-session`. The #1 documented failure is **orphaned forks with
  no lineage** (ChatGPT) — hence lineage is a goal here.
- **Side chats** ("ephemeral but promotable"): Raycast Quick AI, Notion AI sidebar
  (docked vs floating).
- **Keep distinct** from compaction (Zed/Cline/Continue/Replit "new session") and
  code-state checkpoints (Cursor/Windsurf/Cline/Replit) — different problems.

## Open Questions

1. **[RESOLVED — Approach A. Seed-without-run is feasible; implemented in S1.]**

   **Verdict: Approach A (immediate create, display-only anchor).** Deferred
   creation (B) is not required.

   **Evidence.** The thread-start "displayed turn" and the "provider run" are
   already two distinct steps in the create flow, so the anchor can be persisted
   and rendered without dispatching a run:

   - `requestThreadProvision` (`thread-provisioning.ts:147`) writes the persisted
     `client/turn/requested` thread-start event — the row the timeline renders.
     It does **not** dispatch a provider run. (Originally hardcoded
     `initiator: "user"`, `senderThreadId: null`; S1 makes both derive from
     `startedOnBehalfOf`.)
   - The provider run is dispatched later by
     `startThreadIfEnvironmentReady` (`thread-provisioning.ts:79`), which calls
     `requestThreadStart` (`thread-lifecycle.ts:942`) → `buildThreadStartCommand`
     + `dispatchThreadStartFromRequest`. That is the only place the host
     `thread.start` command is built/sent.

   `thread-turn-dispatch.ts` (originally cited) handles the *reprovision/tell*
   path, not first thread-start; the real thread-start dispatch seam is in
   `thread-provisioning.ts`. The thread-start displayed-turn write and the
   provider dispatch were already separable there.

   **Implementation (S1).** A `seedWithoutRun` flag rides the provision-context
   request payload (`threadProvisionCommonPayloadSchema`), set true when
   `startedOnBehalfOf` is non-null. When set, `startThreadIfEnvironmentReady`
   writes the workspace-ready event, then **skips `requestThreadStart`** and
   transitions the thread `provisioning → idle` (an already-allowed transition),
   leaving the agent waiting for the user's first message. The persisted
   thread-start `client/turn/requested` event carries
   `initiator = startedOnBehalfOf.initiator` (agent/system) and
   `senderThreadId = startedOnBehalfOf.senderThreadId`, so it renders as
   "Message from {source}". The field is honored end-to-end (route →
   `createThreadFromRequest` → `requestThreadProvision`), not accepted-but-ignored.

   *(Original wording, for the record: "Can bb persist/display a thread-start turn
   without dispatching a provider run (Fork approach A), or must fork use deferred
   creation (approach B)? Resolve by inspecting `thread-turn-dispatch.ts`.")*
2. **[TBD: context window size N]** How many preceding main-thread messages the
   side-chat `agent-only` snapshot includes (current turn only, last N, or the whole
   current turn's lead-up). Token-cost vs grounding.

   **[RESOLVED — side-chat workspace (review fix).]** The original "personal
   workspace (no worktree)" plan for the side-chat environment is **not viable**:
   the server rejects personal workspaces outside the personal project
   (`assertProjectWorkspaceCompatibility`), so a side chat spawned from a
   standard-project thread 400s on create. Personal-project routing is also
   rejected — it breaks the same-project `parentThreadId` guard and the
   cross-project send-back. **Decision:** a side chat runs in its **own
   same-project fresh managed worktree** (readonly), branched off the source's host
   + branch via the shared `resolveChildThreadEnvironment` resolver (the same one
   forks use), falling back to the personal workspace only when the source itself
   has no host (a personal-project source). This is a forced infrastructure
   decision; v1 reach into *context* stays conversation-only (Open Question 2's
   window), independent of the side chat now having its own checkout.
3. **[TBD: childOrigin migration]** Confirm the nullable `childOrigin` thread-column
   migration (default null for existing rows) and that no consumer treats absence as
   an error.
4. **[TBD: PromptBoxInternal reuse]** Confirm `PromptBoxInternal` can drive turns on
   a non-route (side-chat) thread; if not, scope the side-chat composer as a larger
   item.

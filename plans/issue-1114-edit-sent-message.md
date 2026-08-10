# Experimental Sent-Message Editing

Issue: [#1114 — No way to edit a sent message or undo the last turn](https://github.com/get-bb/bb/issues/1114)

## Goal

Let a user replace any completed user message in a Codex, Claude Code, or Pi
thread and rerun the conversation from that point.

Opening the editor must be entirely client-local. The thread, provider session,
timeline, and workspace change only after the user selects **Submit edit** and
the server has safely prepared the replacement provider history.

This version deliberately does not include undo.

## Status

Status (2026-08-10): the functional prototype is implemented behind the
default-off `editMessages` experiment. It includes arbitrary-message timeline
actions, the shared inline editor, provider checkpoints for Codex, Claude Code,
and Pi, atomic event-suffix replacement, realtime invalidation, SDK and CLI
surfaces, staged-provider cleanup, and generated daemon-contract artifacts. The
experiment uses the existing keyed
`system_experiments` table, so no schema migration is required.

Focused and package-wide automated validation is complete. The remaining work
before broadening the experiment is real-provider smoke testing proving that
each replacement turn cannot see the removed suffix.

## Product Contract

When `editMessages` is enabled:

- Every eligible completed root user message exposes **Edit message**.
- Selecting the action replaces only that message bubble with the compact
  inline editor. All later messages remain visible until submission succeeds.
- The editor reuses the queued-message editor frame and follow-up composer,
  labels the action **Submit edit**, uses the short header **Editing message**,
  and focuses the editor when it opens.
- Cancel is client-local and confirms only when it would discard changes.
- Submit atomically replaces the selected request and every later conversation
  event, then starts the edited turn.
- Existing workspace, git, terminal, process, child-thread, and external side
  effects are intentionally retained.
- Successful submission does not show a toast; the rewritten timeline is the
  confirmation.

This version does not provide:

- undo, redo, or standalone rewind;
- editing while a root turn, workflow, background agent, or background command
  is active;
- editing turns containing a steer or multiple accepted requests;
- editing one message inside a grouped multi-message request;
- ACP, OpenCode, or other provider support;
- filesystem or external-side-effect rollback;
- a generic history-truncation or plugin API.

## Experiment

`editMessages` is a required server-backed experiment field with a default of
`false`. It is persisted as the `editMessages` key in the existing
`system_experiments` key/value table and is exposed through:

- Settings → Experiments → **Edit messages**;
- `bb settings experiment editMessages <true|false>`;
- the system configuration API used by the app and SDK.

The app hides edit actions while the experiment is off. The server separately
rejects read and mutation requests while it is off, so direct CLI or SDK calls
cannot bypass the gate.

## UX Flow

### Open

Selecting **Edit message**:

1. Makes no server request.
2. Creates a separate in-memory edit session from the timeline row's visible
   `PromptInput[]` and request event sequence.
3. Leaves the ordinary persisted follow-up draft mounted and unchanged.
4. Replaces the selected bubble with the inline editor and focuses it.
5. Keeps the selected turn's response and the entire later timeline visible.

Remote image inputs that cannot be faithfully restored remain ineligible.
Agent-only context is excluded from the editor and is resolved again through
the normal submit pipeline.

### Cancel

Cancel or navigation clears only the client edit session. No provider or server
state changes. If the draft differs from the original, cancellation confirms
before discarding it.

### Submit

Normal and modifier submit both use the edit mutation, never ordinary send,
queue, or steer. While pending, the original timeline stays visible and the
editor is disabled.

On a pre-commit failure, the original timeline and draft remain. On success,
the client invalidates history-owning queries and realtime publishes a
`history-rewritten` change so every client replaces the old suffix directly
with the edited pending turn.

## Eligibility

The server is authoritative. A selected request is editable only when:

- the experiment is enabled;
- the thread is writable and idle;
- the provider is `codex`, `claude-code`, or `pi`;
- the request is user-initiated and targets a root thread start or root turn;
- exactly one `turn/input/accepted` event links the request to its root turn;
- that root turn completed successfully and contains no accepted steer or
  additional input;
- the request is not a grouped multi-message request;
- there is no queued message, pending interaction, workflow, background agent,
  or background command;
- the replacement provider history can be staged through the root turn
  preceding the selected request.

The app additionally suppresses actions during timeline loading, a competing
send/edit mutation, or an active local edit session. Submission always
revalidates the exact request sequence and current event high-water mark.

## Provider Checkpoints

Editing an earlier message needs a provider-native transcript boundary for the
turn immediately before it. bb stores that opaque boundary on
`turn/completed.providerCheckpointId`:

| Provider    | Persisted checkpoint                   | Rewind implementation                           |
| ----------- | -------------------------------------- | ----------------------------------------------- |
| Codex       | bb root turn id                        | `thread/fork.lastTurnId`                        |
| Claude Code | latest root `SDKAssistantMessage.uuid` | `forkSession(..., { upToMessageId })`           |
| Pi          | session manager leaf entry id          | `SessionManager.createBranchedSession(entryId)` |

Editing the first root turn needs no retained checkpoint and starts a fresh
provider session. For an existing Claude Code or Pi thread created before
checkpoints were recorded, editing after a legacy turn is rejected rather than
silently forking from the wrong context. A new turn records the checkpoint
needed for subsequent edits.

The server sends only opaque provider checkpoints across the daemon boundary:

```ts
{
  type: "thread.rewind.prepare";
  sourceProviderThreadId: string;
  retainThroughProviderCheckpoint: string;
  operationId: string;
}
```

The runtime stages an event-suppressed provider fork and returns its provider
thread id. After the replacement fork settles, bb closes/removes the staged
Claude Code or Pi session and archives the staged Codex fork; a daemon-side TTL
cleans up abandoned preparations. The source provider session remains untouched
until the database commit. The prepare/discard wire contract requires
`HOST_DAEMON_PROTOCOL_VERSION = 97`.

## API, SDK, And CLI

The mutation selects its target by the initiating request event sequence:

```text
POST /api/v1/threads/:id/edit-message
```

```ts
{
  operationId: string;
  expectedRequestSequence: number;
  input: PromptInput[];
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  permissionMode?: PermissionModeInput;
  executionInputSources?: ExistingThreadExecutionInputSources;
}
```

For CLI convenience, a read-only latest-target route remains available:

```text
GET /api/v1/threads/:id/latest-message-edit
```

The SDK exposes `threads.getLatestMessageEdit(...)` and
`threads.editMessage(...)`. The CLI exposes:

```text
bb thread edit-message [id] [--self]
  --message <text>
  [--expected-request-sequence <n>] [--json]
```

Without an explicit sequence the CLI resolves the latest eligible request.
With a sequence it can edit any eligible earlier message and uses the value as
an optimistic-concurrency guard.

## Atomic Replacement

The server holds the per-thread mutation guard and performs:

1. **Preflight:** resolve the exact request and root turn, validate eligibility,
   replacement input, attachments, mentions, execution options, and event
   high-water mark.
2. **Stage:** create a detached provider fork through the preceding checkpoint,
   or choose a fresh-session path for the first turn. The source session and bb
   event history remain unchanged if this fails.
3. **Commit:** in one immediate transaction, revalidate the target and high-water
   mark, append an `edit_message` operation marker, delete the selected event
   suffix plus sequence-addressed prompt-history/search state and dynamic
   context state, append the edited `client/turn/requested` through the normal
   send pipeline, record prompt history, and transition the thread to active.
4. **Publish and dispatch:** emit `history-rewritten`, invalidate history-owning
   caches, and dispatch the edited turn on the staged provider session.

The marker is retained above the deleted suffix, keeps event sequences
monotonic, and stores an input fingerprint. Retrying the same `operationId` and
payload returns the committed result; reusing it with different input is a
conflict.

## Validation Plan

Automated coverage must prove:

- the experiment defaults off, persists, renders in Settings, and gates both UI
  and server;
- actions appear on every eligible accepted user request, not only the latest;
- opening/cancelling is non-destructive and focuses the editor;
- submitting an earlier request removes its turn and every later turn;
- suffix deletion also clears search, prompt-history, and dynamic-context state
  while preserving monotonic sequences;
- stale request sequences, changed high-water marks, steers, active work,
  queued messages, pending interactions, and unsupported providers reject
  without changing history;
- Codex maps the retained bb turn id to `lastTurnId`;
- Claude Code persists the assistant UUID and maps it to `upToMessageId`;
- Pi persists the session leaf id and branches through that entry only;
- first-turn edits start fresh for all three supported providers;
- lost-response retries do not create duplicate rewinds or requests;
- SDK paths/types, CLI latest lookup, explicit earlier sequence, human output,
  guide, skill, and configuration docs match the implementation.

Before enabling the experiment more broadly, perform real Codex, Claude Code,
and Pi smoke tests with a unique fact in the removed suffix. The replacement
turn must be unable to recall that fact from provider conversation context.
Also verify desktop and compact/mobile editing, cancel, failed submit, and two
connected clients.

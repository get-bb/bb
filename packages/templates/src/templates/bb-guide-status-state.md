---
kind: instruction
title: bb Guide - STATUS State
summary: Persistent reactive JSON state and manager messaging for STATUS dashboards.
intent: Explain window.bbStatusState, window.bbThreadTell, STATUS-data storage, and the status-state CLI.
editingNotes: Keep this aligned with the /api/v1/threads/:id/status-data and /api/v1/threads/:id/send routes plus the injected client.
---
STATUS state

`window.bbStatusState` is injected into the root manager STATUS document served
from `/api/v1/threads/<thread-id>/status/`. Use it when `STATUS/index.html` or
`STATUS.html` needs durable JSON state for controls, forms, filters, task
boards, or other dashboard UI that should survive iframe reloads and update
across open tabs.

Do not use it for rendering source files or static assets. Keep ordinary HTML,
CSS, JS, images, and fonts in `STATUS/`; use STATUS state for data the dashboard
and manager agent both need to read or update.

Storage layout:

```text
<thread-storage>/
  STATUS/
    index.html
  STATUS-data/
    tasks.json
    dashboard-prefs.json
```

Each key is one flat file at `STATUS-data/<key>.json`. Keys must match
`^[A-Za-z0-9_-]{1,80}$`; bb appends `.json`. The file stores the raw JSON value,
not an envelope.

Browser API:

```ts
type StatusStateSelector = StatusDataKey | "*";

interface BbStatusState {
  list(): Promise<Record<StatusDataKey, JsonValue>>;
  get(key: StatusDataKey): Promise<JsonValue | undefined>;
  set(key: StatusDataKey, value: JsonValue): Promise<void>;
  delete(key: StatusDataKey): Promise<void>;
  on(selector: StatusStateSelector, callback: StatusStateChangeCallback): () => void;
}

type StatusStateChangeCallback = (
  newValue: JsonValue | undefined,
  prevValue: JsonValue | undefined,
  key: StatusDataKey,
  event: StatusStateChangeEvent,
) => void;

interface StatusStateChangeEvent {
  source: "local" | "remote";
  operation: "set" | "delete" | "hydrate" | "resync" | "revert";
  optimistic: boolean;
  version: string | null;
  error: string | null;
}
```

Hydration and reactivity:

- The global exists before dashboard scripts run.
- `on(key, cb)` fires for an existing hydrated key as soon as the listener is
  registered. `on("*", cb)` fires once for each existing key.
- Local `set` and `delete` calls update the in-memory state optimistically and
  fire callbacks with `source: "local"` and `optimistic: true`.
- Committed writes are broadcast over bb's realtime WebSocket on the
  `thread:<thread-id>:status-data` channel. Other open tabs receive callbacks
  with `source: "remote"`.
- On WebSocket reconnect, the client lists current state again and fires
  `operation: "resync"` callbacks for differences.
- STATUS-data writes do not affect `status-version`, so they do not reload the
  iframe document.

Minimal dashboard example:

```html
<button id="add">Add task</button>
<pre id="out"></pre>
<script>
const out = document.querySelector("#out");

function render(value) {
  out.textContent = JSON.stringify(value ?? [], null, 2);
}

window.bbStatusState.on("tasks", render);

document.querySelector("#add").addEventListener("click", async () => {
  const current = (await window.bbStatusState.get("tasks")) ?? [];
  await window.bbStatusState.set("tasks", [
    ...current,
    { id: crypto.randomUUID(), title: "New task", status: "todo" }
  ]);
});
</script>
```

Sending a message to the manager:

`window.bbThreadTell(text)` is also injected into the same root STATUS document.
It sends a normal follow-up message to the manager thread that owns the iframe:

```ts
window.bbThreadTell(text: string): Promise<void>
```

There is no thread id argument. The iframe runtime uses the thread context from
`/api/v1/threads/<thread-id>/status/` and posts to:

```http
POST /api/v1/threads/<thread-id>/send
```

The request body is:

```json
{
  "input": [{ "type": "text", "text": "hello" }],
  "mode": "auto"
}
```

The promise resolves when the server accepts the send route. 4xx responses
reject with the server error message and attach `status`, `code`, and
`retryable` fields when present. 5xx responses reject with
`bbThreadTell failed: server error (<status>)`.

Example component pattern:

```html
<textarea id="manager-message" rows="3"></textarea>
<button id="manager-send" type="button">Send to manager</button>
<output id="manager-send-status"></output>
<script>
const textarea = document.querySelector("#manager-message");
const status = document.querySelector("#manager-send-status");

document.querySelector("#manager-send").addEventListener("click", async () => {
  status.textContent = "";
  try {
    await window.bbThreadTell(textarea.value);
    textarea.value = "";
    status.textContent = "sent";
    setTimeout(() => {
      if (status.textContent === "sent") status.textContent = "";
    }, 2000);
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "Message failed";
  }
});
</script>
```

Agent and CLI writes:

```bash
bb status-state list <thread-id>
bb status-state get <thread-id> <key>
bb status-state set <thread-id> <key> '<json>'
bb status-state set <thread-id> <key> @/tmp/value.json
bb status-state delete <thread-id> <key>
```

`list` prints all values. `get` prints one raw JSON value and exits non-zero if
the key is missing. `set` parses inline JSON or `@file` JSON. CLI writes go
through the server API, so open dashboards receive broadcasts.

CAS is available through the CLI and HTTP layer:

```bash
bb status-state set <thread-id> tasks @/tmp/tasks.json --if-match <version>
bb status-state set <thread-id> tasks '[]' --create-only
bb status-state delete <thread-id> tasks --must-exist
```

The browser global is intentionally last-write-wins. Use CLI or direct HTTP
preconditions when an agent needs compare-and-set behavior.

Limits:

There is no new bb-specific size cap for v1. Existing server request limits,
daemon file transport limits, browser memory, and JSON parse costs still apply.
Direct filesystem edits to `STATUS-data/` are visible after reload, reconnect,
or explicit reads, but they do not broadcast in v1; use `bb status-state set`
or `delete` for reactive agent writes.

Related guides:

  bb guide overview
  bb guide managers
  bb guide styling

---
name: building-bb-apps
description: Use this when building, modifying, debugging, or authoring data or skills for a bb app, including the app model, window.bb SDK, bb app CLI, capabilities, data storage, app-local skills, and realtime data binding.
---

# Building bb Apps

Use this skill whenever you are creating or changing a bb app. A bb app is a
global, local-host app stored under the bb data directory. It is not a separate
web service.

## App Model

A global app lives at:

```text
<dataDir>/apps/<slug>/
  manifest.json
  public/
  skills/
  source/
```

`<slug>` is the application id. `manifest.id` must equal the containing folder
name and must be a lowercase slug up to 64 characters, such as `status` or
`review-board`.
`manifest.name` is display-only. Application ids are identifiers; names are not.

`public/` is the browser web root. bb serves it at:

```text
/api/v1/apps/<slug>/
```

The `public/` directory name is not part of the URL. `public/index.html` is
served at `/api/v1/apps/<slug>/`; `public/index-abc.js` is served at
`/api/v1/apps/<slug>/index-abc.js`. Use relative asset refs such as
`./index-abc.js`, not root-absolute refs such as `/assets/index-abc.js`.

Durable JSON values addressed by app-data paths live outside the app folder at
`<dataDir>/app-data/<slug>/`, created lazily on first write. App data is
private — never browser content — and is exposed through the SDK, CLI, and
server data API. Keeping data out of the app folder lets app code be replaced
wholesale (for example by app-source syncs) without touching user state.

`skills/` stores app-local agent skills. Each skill is a normal
`skills/<name>/SKILL.md` folder. Valid app-local skills are injected into agents
alongside built-in bb skills and global data-dir skills.

## Manifest

Typical manifest:

```json
{
  "manifestVersion": 1,
  "id": "review-board",
  "name": "Review Board",
  "entry": "index.html",
  "capabilities": ["data", "message"]
}
```

Allowed capabilities are `data` and `message`. In this Phase 1 prototype,
capabilities are manifest metadata; the injected browser helpers are not gated
by capability.

`entry` is relative to `public/`. HTML entries get the injected `window.bb`
runtime. Markdown entries render as static documents and do not get
`window.bb`. If `entry` is omitted, bb looks for `index.html` or `index.md`.

## Create And Build

Create a scaffolded app with:

```bash
bb app new --name "Review Board"
bb app new --slug review-board
bb app new --id review-board
```

`bb app new` creates a Vite + React + TypeScript Todo app. The generated layout
includes:

```text
manifest.json
README.md
public/                 # prebuilt browser output, served by bb
skills/add-todos/        # app-local skill for writing todo records
source/                  # editable Vite React TypeScript project
source/src/bb-sdk.d.ts   # generated window.bb types
```

No data is seeded; `<dataDir>/app-data/<slug>/` appears on first write.

The app renders immediately because `public/` is already built. Edit in
`source/`, then rebuild:

```bash
cd "$BB_APP_ROOT/source"
pnpm install
pnpm build
```

The scaffold's Vite config uses:

```ts
base: "./",
build: {
  outDir: "../public",
  assetsDir: "",
  emptyOutDir: true,
}
```

That emits flat, relative assets into `../public`. Rebuild after editing
`source/`; bb serves `public/`, not the Vite dev server. `pnpm dev` is only for
local editing.

Find an app's canonical filesystem paths with:

```bash
bb app show review-board --json
bb app current --json
```

`bb app current --json` only works inside an app-capable runtime. The runtime
also exposes `BB_APPS_ROOT`, `BB_APP_ID`, `BB_APP_ROOT`, and
`BB_APP_DATA_PATH` when there is a current app.

## window.bb SDK

HTML app entries receive `window.bb`. The scaffold vendors generated types at
`source/src/bb-sdk.d.ts`; keep that declaration in sync with `@bb/sdk` when the
SDK contract changes.

The current-app data API is object-argument based:

```ts
await window.bb.data.read({ path: "state.json" });

await window.bb.data.write({
  path: "todos/todo_20260603_review_notes",
  value: {
    id: "todo_20260603_review_notes",
    title: "Review project notes",
    done: false,
    createdAt: "2026-06-03T20:00:00.000Z",
    updatedAt: "2026-06-03T20:00:00.000Z"
  }
});

await window.bb.data.delete({ path: "todos/todo_20260603_review_notes" });

const rows = await window.bb.data.list({ prefix: "todos" });
const entries = await window.bb.data.entries({ prefix: "todos" });
```

`read` returns a JSON value or `undefined`. `write` accepts any valid JSON
value. `delete` resolves when the path is removed. `list` returns
`{ path, value }[]`. `entries` returns metadata-bearing entries with `path`,
`value`, `version`, `sizeBytes`, and `modifiedAtMs`.

`prefix` is optional. `""` matches all app data. A prefix matches either the
exact data path or a subtree under `prefix + "/"`.

Use `onChange` for live realtime data binding:

```ts
const unsubscribe = window.bb.data.onChange({
  prefix: "todos",
  callback(event) {
    console.log(event.path, event.value, event.deleted);
  }
});

unsubscribe();
```

`onChange({ prefix?, callback })` returns an unsubscribe function. Registering a
listener immediately replays existing matching records, buffers concurrent
events during replay, and replays again after reconnects or app-data resync
hints. Delete events have `deleted: true` and `value: undefined`.
Use this as the canonical reactive binding: browser writes, `bb app data`
writes, server/API writes, observed direct file writes under `data/`, and
deletes converge through this event shape.

### Realtime Events (bb.on)

Use `window.bb.on({ event, ...scope, callback })` when an app needs the raw
realtime SDK stream instead of the current-app `data.onChange` adapter. It
returns an idempotent unsubscribe function:

```ts
const unsubscribeThread = window.bb.on({
  event: "thread:changed",
  threadId,
  callback(event) {
    if (event.changes.includes("status-changed")) {
      void reloadThread();
    }
  }
});

const unsubscribeConnection = window.bb.on({
  event: "realtime:connection",
  callback(event) {
    if (event.state === "connected" && event.reconnected) {
      void reloadThread();
    }
  }
});

const unsubscribeData = window.bb.data.onChange({
  prefix: "todos",
  callback(event) {
    renderTodo(event.path, event.value, event.deleted);
  }
});

unsubscribeThread();
unsubscribeConnection();
unsubscribeData();
```

The SDK owns the websocket. It uses one shared websocket per SDK instance,
ref-counts subscriptions, closes the socket when there are no active target
subscriptions, and automatically reconnects and resubscribes active targets.
App authors do not open sockets or send subscribe messages. A
`realtime:connection` listener observes that shared socket but does not open a
socket by itself.

All `bb.on` inputs include `event` and `callback`; supported scope fields are:

| Event | Scope fields | Callback receives |
| --- | --- | --- |
| `thread:changed` | `threadId?` | `ChangedMessage` where `entity` is `"thread"`: `{ type: "changed", entity: "thread", id?, metadata?, changes }` |
| `project:changed` | `projectId?` | `ChangedMessage` where `entity` is `"project"`: `{ type: "changed", entity: "project", id?, changes }` |
| `environment:changed` | `environmentId?` | `ChangedMessage` where `entity` is `"environment"`: `{ type: "changed", entity: "environment", id?, changes }` |
| `host:changed` | `hostId?` | `ChangedMessage` where `entity` is `"host"`: `{ type: "changed", entity: "host", id?, changes }` |
| `system:changed` | none | `ChangedMessage` where `entity` is `"system"`: `{ type: "changed", entity: "system", changes }` |
| `system:config-changed` | none | The same system `ChangedMessage`, only when `changes` includes `"config-changed"` |
| `system:apps-changed` | none | The same system `ChangedMessage`, only when `changes` includes `"apps-changed"` |
| `app:changed` | none | `ChangedMessage` where `entity` is `"app"`: `{ type: "changed", entity: "app", id?, changes }` |
| `app-data:changed` | `applicationId?`, `prefix?` | `AppDataBroadcastMessage` with `type: "app-data.changed"`: `{ applicationId, path, value, deleted, version }` |
| `app-data:resync` | `applicationId?` | `AppDataBroadcastMessage` with `type: "app-data.resync"`: `{ applicationId }` |
| `realtime:connection` | none | `{ state: "connecting" | "connected" | "disconnected", reconnected, reconnectDelayMs }` |

For app data, omit `applicationId` only in a current-app browser context; the
SDK fills it from the injected app context. `prefix` uses the same matching
rules as `window.bb.data.list`: `""` matches everything, otherwise the exact
path or descendants under `prefix + "/"` match.

Use `window.bb.data.onChange({ prefix?, callback })` for an app's own data in
normal UI code. It is a convenience adapter over
`bb.on({ event: "app-data:changed", applicationId, prefix, callback })`: it
subscribes, replays current matching data, buffers concurrent updates during
replay, replays again after reconnects or `app-data.resync` hints, and maps the
raw contract payload to `{ path, value, deleted }` with `value: undefined` for
deletes. Use raw `bb.on({ event: "app-data:changed", applicationId?, prefix? })`
when the callback needs contract fields such as `applicationId` or `version`.
Use `realtime:connection` with `event.reconnected === true` to trigger any extra
refetch or reconciliation your app needs after the SDK has reconnected.

Payload types come from `ChangedMessage` in `@bb/domain` and
`AppDataBroadcastMessage` in `@bb/server-contract`; do not invent payload
fields in app code.

Message the thread context that opened the app with:

```ts
await window.bb.message.send({
  payload: {
    kind: "review-board.status",
    open: 3
  }
});
```

`targetThreadId` is optional in the browser call:

```ts
await window.bb.message.send({ payload: "Please review this.", targetThreadId });
```

When the app was opened by a thread, the injected app session supplies the
target. Non-iframe callers must provide a target thread or the server returns
`message_target_required`.

The injected runtime currently exposes the broader bb SDK prototype too:
`window.bb.threads`, `window.bb.apps`, `window.bb.hosts`,
`window.bb.projects`, `window.bb.environments`, `window.bb.providers`,
`window.bb.replay`, and `window.bb.status`. Treat those
as CLI-level power inside the browser prototype; prefer the current-app
`data` and `message` areas for ordinary app behavior.

## App Data

App data paths are relative to `<dataDir>/app-data/<slug>/`.

Rules:

- Path must not be empty.
- No leading or trailing slash.
- No backslashes or NUL bytes.
- No `.` or `..` segments.
- No dot-prefixed segments.
- Up to 8 path segments.
- Whole path length up to 512 characters.
- Each segment is 1 to 80 characters and uses letters, numbers, dots,
  underscores, and hyphens.

Data values are JSON. The server writes canonical pretty JSON files under
`data/`. A common app pattern is one JSON file per record, for example:

```text
todos/<id>
```

The generated Todo scaffold binds to `todos/` and uses records like:

```json
{
  "id": "todo_20260603_review_notes",
  "title": "Review project notes",
  "done": false,
  "createdAt": "2026-06-03T20:00:00.000Z",
  "updatedAt": "2026-06-03T20:00:00.000Z"
}
```

Prefer per-record paths for reactive lists. Avoid storing the whole UI in one
large `state.json` unless a single-document model is genuinely better.

## bb CLI

App management:

```bash
bb app list
bb app list --json
bb app new --name "Review Board"
bb app new --slug review-board
bb app show review-board
bb app show review-board --json
bb app current --json
bb app delete review-board --yes
```

Data management from outside the app:

```bash
bb app data list review-board
bb app data list review-board todos
bb app data read review-board todos/todo_20260603_review_notes
printf '%s\n' '{"ok":true}' | bb app data write review-board state.json --stdin
bb app data write review-board state.json --file ./state.json
bb app data delete review-board state.json
```

`bb app data list <applicationId> [path]` treats `[path]` as a prefix. `read`
prints the stored JSON value. `write` requires `--file <localPath>` or
`--stdin`. Commands accept application ids, not display names.

There is also a message command for non-browser sends:

```bash
bb app message review-board --target-thread thr_123 --json '"Please review this."'
```

## App Sources

An app source is a git repo (or local path) of bb apps that installs and
updates as a unit. Every top-level directory in the repo with a valid
`manifest.json` is an app; no catalog file is needed:

```text
my-bb-apps/              # the git repo
  pomodoro/
    manifest.json        # standard manifest; manifest.id is the app id
    public/index.html
    skills/...
  standup-notes/
    manifest.json
    public/index.html
  README.md              # non-app entries are ignored
```

Authoring rules: commit built `public/` output (no build step runs on
install), never commit a `data/` directory (runtime data is user-owned and
ignored), and never commit `.bb-app-source.json` (ignored — provenance is
written by bb). Symlinks are skipped on install.

Managing sources:

```bash
bb app source add https://github.com/you/my-bb-apps.git
bb app source add /path/to/local/repo --name team-apps --ref v1
bb app source list
bb app source sync team-apps          # fetch + update that source's apps
bb app source sync                    # sync every source
bb app source sync team-apps --force  # discard local edits to diverged apps
bb app source detach pomodoro         # app becomes permanently local
bb app source remove team-apps --yes  # removes apps; app data is kept
```

Semantics:

- Updates are manual: nothing syncs in the background. `bb app source sync`
  fetches the origin and reconciles installed apps; the recorded commit sha
  is the version.
- Installed apps carry a `.bb-app-source.json` provenance marker and report
  `source` in `bb app list`/`bb app show`. Managed apps cannot be deleted
  with `bb app delete` — detach first or remove the source.
- Local edits to a managed app mark it `modified`; sync never overwrites it
  without `--force`. Upstream deletion never removes a modified app.
- App ids already used by a local app (or another source) report `conflict`
  and are skipped; the local app always wins.
- App data lives in `<dataDir>/app-data/<slug>/` and survives updates,
  upstream removal, and source removal; it reattaches when an app is
  reinstalled.
- Trust: adding a source is the trust decision. Its apps serve browser code
  with a `window.bb` session and inject agent skills. Only add repos you
  trust.

## Skills Injection

Three sources are discovered for injected skills:

```text
<built-in skills bundled inside the bb server>
<dataDir>/skills/<skill-name>/SKILL.md
<dataDir>/apps/<slug>/skills/<skill-name>/SKILL.md
```

Built-in skills (including this one) ship with bb itself from
`apps/server/src/services/skills/builtin-skills/<skill-name>/SKILL.md` and are
injected on every install without any data-dir setup. For the normal
production data dir, `<dataDir>/skills` is `~/.bb/skills`; skills there are
user-authored data-dir global skills.

Each injected skill must have agentskills-style YAML frontmatter:

```yaml
---
name: add-todos
description: Add todos to this bb Todo app by writing per-item app data records.
---
```

The frontmatter `name` must match the directory name. Descriptions must be
non-empty. Symlinked roots or skill files are skipped. A data-dir or app-local
skill that reuses a built-in skill's name overrides the built-in copy. If two
injected skills share the same name across the data-dir root and any app root,
all colliding skills with that name are skipped. Keep app-local skill names
unique.

App-local skills are discovered only for valid global apps whose
`manifest.json` parses and whose `manifest.id` matches the app directory. The
server passes discovered sources to the host daemon, which stages them into
provider-specific skill roots for agents.

Use app-local skills to teach agents how to drive that specific app's data
model. The generated Todo app's `skills/add-todos/SKILL.md` is the pattern:
state the record path, JSON shape, required fields, and CLI write command.

## End-To-End Pattern

Create:

```bash
bb app new --slug review-board --name "Review Board"
bb app show review-board --json
```

Edit and rebuild:

```bash
app_root="$(bb app show review-board --json | jq -r .appRootPath)"
cd "$app_root/source"
pnpm install
# edit source/src/App.tsx, source/src/useTodos.ts, etc.
pnpm build
```

See it through the running bb server or bb UI:

```text
/api/v1/apps/review-board/
```

Write data in the browser:

```ts
const todo = {
  id: "todo_20260603_review_notes",
  title: "Review project notes",
  done: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

await window.bb.data.write({
  path: `todos/${todo.id}`,
  value: todo
});

const unsubscribe = window.bb.data.onChange({
  prefix: "todos",
  callback(event) {
    console.log(event.path, event.deleted, event.value);
  }
});
```

Write the same kind of data from an agent or shell:

```bash
todo_id="todo_20260603_review_notes"
created_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
printf '%s\n' "{\"id\":\"$todo_id\",\"title\":\"Review project notes\",\"done\":false,\"createdAt\":\"$created_at\",\"updatedAt\":\"$created_at\"}" |
  bb app data write review-board "todos/$todo_id" --stdin

bb app data list review-board todos
bb app data read review-board "todos/$todo_id"
```

Notify the owning thread from the app:

```ts
await window.bb.message.send({
  payload: {
    kind: "review-board.updated",
    changedPath: `todos/${todo.id}`
  }
});
```

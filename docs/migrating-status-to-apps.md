# Migrating from STATUS to Apps

The legacy **STATUS** surface (`STATUS.html` / `STATUS.md` / a `STATUS/` folder
plus the `STATUS-data/` key–value store) has been removed. A thread now exposes
one or more **apps** instead, and the old single status dashboard becomes a
regular app with the id `status`.

This guide is for an **existing manager** (or any thread) whose storage still
contains the old STATUS files and needs to move to the new format. New threads
already seed a `status` app automatically and need no migration.

For the full feature reference, run `bb guide app`. This doc only covers the
mechanical migration.

---

## What changed

| Legacy STATUS                                                                 | New Apps                                                                                                               |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `STATUS/index.html`, `STATUS.html`, or `STATUS.md` in the thread-storage root | `apps/<id>/assets/<entry>` on disk, served at `/api/v1/threads/<thread-id>/apps/<id>/<entry>`                          |
| One implicit status surface per thread                                        | Any number of apps; the dashboard is just the app with id `status`                                                     |
| `STATUS-data/<key>.json` (flat keys, `^[A-Za-z0-9_-]{1,80}$`)                 | `apps/<id>/data/<path>` (nested paths allowed; default: a single `data/state.json`)                                    |
| `window.bbStatusState` (`get`/`set`/`delete`/`list`/`on`)                     | `window.bb.data` (`read`/`write`/`delete`/`list`/`onChange`)                                                           |
| `window.bbThreadTell(text)`                                                   | `window.bb.message(text)`                                                                                              |
| Served at `/api/v1/threads/<id>/status/`                                      | Served at `/api/v1/threads/<id>/apps/<id>/`                                                                            |
| Globals always injected                                                       | Injected only for **HTML** entries, gated by manifest `capabilities`; **Markdown** entries are static (no `window.bb`) |

---

## Target layout

```text
<thread-storage>/
  apps/
    status/
      manifest.json     # metadata — NOT served
      assets/           # internal storage for browser files
        index.html      # (or index.md)
      data/             # file-based key/value store
        state.json      # default: keep all state in one blob
      logo.svg          # optional; otherwise a built-in icon is used
```

`manifest.json` for the status dashboard:

```json
{
  "manifestVersion": 1,
  "id": "status",
  "name": "Status",
  "icon": "ListTodo",
  "entry": "index.html",
  "contributions": ["thread.app"],
  "capabilities": ["data", "message"]
}
```

- `id` must match the directory name and `^[A-Za-z0-9_-]+$`.
- `entry` is resolved relative to `assets/`. Use `index.html` for an
  interactive dashboard, or `index.md` for a static document (Markdown apps do
  **not** get `window.bb`).
- `icon` is a built-in icon name. To use a custom image instead, drop a
  top-level `logo.svg` / `logo.png` / `logo.jpg` and omit `icon`; with neither,
  apps fall back to the `GridView` icon.
- `capabilities`: `data` injects `window.bb.data`, `message` injects
  `window.bb.message`. List only what the app uses.

Browser files under `assets/` are served from the flat app URL. For example,
`apps/status/assets/index-Cd7sCqsN.js` is requested as
`/api/v1/threads/<thread-id>/apps/status/index-Cd7sCqsN.js`; do not include an
`assets/` segment in HTML references. Apps are served directly from these
static files, so there is no app-specific web server, npm install, or build
step requirement.

---

## Migration steps

### 1. Create the app directory

```bash
APP="$BB_THREAD_STORAGE/apps/status"
mkdir -p "$APP/assets" "$APP/data"
```

### 2. Move the markup into `assets/`

- `STATUS.html` → `apps/status/assets/index.html`
- `STATUS/index.html` (+ its CSS/JS/images/fonts) → `apps/status/assets/` (keep the same relative structure; everything under `assets/` is served from the flat app URL)
- `STATUS.md` → `apps/status/assets/index.md` (set `entry` to `index.md`; remember a Markdown entry is static)

Use flat relative HTML references, such as `<script type="module"
src="./index-abc.js"></script>` or `<link rel="stylesheet"
href="./style.css">`. If you are moving existing Vite build output, set
`build.assetsDir = ""` so emitted CSS/JS/assets sit alongside `index.html`
inside `assets/`; otherwise keep the app as plain static files.

### 3. Migrate the state

The default convention is a **single `data/state.json` blob**. If your old
dashboard used a few `STATUS-data/*.json` keys, consolidate them:

```bash
# Example: fold STATUS-data/prs.json + STATUS-data/workers.json into one blob.
jq -n \
  --slurpfile prs     "$BB_THREAD_STORAGE/STATUS-data/prs.json" \
  --slurpfile workers "$BB_THREAD_STORAGE/STATUS-data/workers.json" \
  '{ prs: $prs[0], workers: $workers[0] }' \
  > "$BB_THREAD_STORAGE/apps/status/data/state.json"
```

Or, if you prefer to keep separate keys, each old `STATUS-data/<key>.json`
becomes `apps/status/data/<key>.json` (nested paths like `data/tasks/123` are
also allowed — see `bb guide app` for the path rules).

### 4. Update the in-page JavaScript

Replace the old globals (HTML entries only):

| Old                                    | New                                       |
| -------------------------------------- | ----------------------------------------- |
| `window.bbStatusState.get(key)`        | `await window.bb.data.read(path)`         |
| `window.bbStatusState.set(key, value)` | `await window.bb.data.write(path, value)` |
| `window.bbStatusState.delete(key)`     | `await window.bb.data.delete(path)`       |
| `window.bbStatusState.list()`          | `await window.bb.data.list(prefix)`       |
| `window.bbStatusState.on(key, cb)`     | `window.bb.data.onChange(prefix, cb)`     |
| `window.bbStatusState.on("*", cb)`     | `window.bb.data.onChange("", cb)`         |
| `window.bbThreadTell(text)`            | `await window.bb.message(text)`           |

Notes:

- All `window.bb.data` methods are async (return Promises). `read` resolves to
  the parsed JSON value or `undefined`.
- `onChange(prefix, cb)` does **subtree** matching: `onChange("tasks")` fires
  for `tasks` and `tasks/*` but not `tasksfoo`; `onChange("")` watches
  everything. It **replays** existing matches once on registration, then streams
  live changes. The callback receives `{ path, value, deleted }`.
- If you consolidated into a single `state.json`, the common pattern is:

  ```js
  window.bb.data.read("state.json").then(render);
  window.bb.data.onChange("state.json", (event) => render(event.value));
  ```

- Guard the helpers (`window.bb.data?.…`, `window.bb.message?.(…)`) — they are
  only present when the matching capability is declared.

### 5. Update how the agent / maintainer writes state

Agents (and any maintainer worker) write app data by writing the files
**directly on disk** — the daemon watches `data/` and broadcasts changes to open
clients. Use the same atomic temp-file + rename pattern as before, just to the
new path:

```bash
DIR="$BB_THREAD_STORAGE/apps/status/data"
mkdir -p "$DIR"
tmp=$(mktemp "$DIR/.state.XXXXXX")
printf '%s\n' "$NEW_STATE_JSON" > "$tmp" && mv "$tmp" "$DIR/state.json"
```

(The browser side uses `window.bb.data.write(...)`, which routes through the
daemon to the same file. Both paths converge on the one watched directory.)

If a long-running maintainer worker used to write `STATUS-data/task_*.json`,
re-point it at `apps/status/data/…` (a single `state.json` is recommended).

### 6. Remove the old STATUS files

Once the app renders correctly:

```bash
rm -rf "$BB_THREAD_STORAGE"/STATUS.html \
       "$BB_THREAD_STORAGE"/STATUS.md \
       "$BB_THREAD_STORAGE"/STATUS \
       "$BB_THREAD_STORAGE"/STATUS-data
```

### 7. Verify

```bash
bb app list <thread-id>          # should show the `status` app
bb app open status               # prints the served URL to open in the panel
```

Or open the thread's secondary panel: the pinned `Status` tab (and the `+`
launcher) should show the app, and writing `data/state.json` should update it
live with no reload.

---

## Quick reference

- Full feature docs: `bb guide app` (manifest, `window.bb`, data paths, icons,
  entry types, the `bb app` CLI).
- Styling tokens for app HTML are documented there too (`bb guide styling`
  redirects to the app guide).
- `bb app new <name>` scaffolds additional apps; `bb app rm <name>` removes one.

---
kind: instruction
title: bb Guide - Apps
summary: Global app storage, browser API, CLI, and styling reference.
intent: Explain how to build global bb apps and use app data, messaging, and runtime paths.
editingNotes: Keep this aligned with routes/apps.ts, app-client-script.ts, and app CLI commands.
---
Apps

Apps are global within the local host data directory. They are the supported
way to build dashboards, control panels, and other interactive surfaces that
can open inside a thread panel.

Important: a bb app is self-contained static HTML/CSS/JS/SVG. Put browser
files under `<dataDir>/apps/<applicationId>/assets/`; bb serves the `entry`
file directly from `/api/v1/apps/<applicationId>/`. Do not start a web server,
localhost dev server, npm install, build step, bundler, or framework for a
normal app. Inline CSS/JS, relative asset refs, and CDN resources such as
Tailwind or fonts are fine.

Storage layout:

```text
<dataDir>/
  apps/
    review-board/
      manifest.json
      assets/
        index.html
      data/
        state.json
```

Each app is rooted at `<dataDir>/apps/<applicationId>/`. The manifest lives at
`manifest.json`, browser files live under `assets/`, and durable JSON state
lives under `data/`.

The app exists only when the local filesystem contains a valid manifest at
`<dataDir>/apps/<applicationId>/manifest.json`. `manifest.id` is the canonical
application id: it must be a lowercase path-safe slug such as `status` or
`review-board`, globally unique inside the data dir, and equal to the
containing folder name. `manifest.name` is an optional human display name only.
When it is absent or empty, bb displays the slug. Display names are not
identifiers and may repeat.

Manifest:

```json
{
  "manifestVersion": 1,
  "id": "review-board",
  "name": "Review Board",
  "icon": "ListTodo",
  "entry": "index.html",
  "capabilities": ["data", "message"]
}
```

`entry` is relative to `assets/`. HTML entries load in an app iframe and receive
the `window.bb` bridge according to `capabilities`; Markdown entries render as
static documents and do not receive `window.bb`. `capabilities` controls which
`window.bb` helpers are injected for HTML entries: `data` enables
`window.bb.data`, and `message` enables `window.bb.message`.

The served app URL is flat: `/api/v1/apps/<applicationId>/<entry>` maps to
`<dataDir>/apps/<applicationId>/assets/<entry>` on disk. HTML should use flat
relative refs like `./index-abc.js`, not `./assets/index-abc.js`. If you are
migrating an existing Vite build output, set `build.assetsDir = ""` so emitted
files sit alongside `index.html`; new bb apps should stay plain static files.

The icon is optional and uses a built-in icon name. Icon resolution order is:

1. `manifest.icon`, when present, as a built-in icon.
2. A custom top-level `logo.svg`, `logo.png`, `logo.jpg`, or `logo.jpeg` in the
   app root, up to 1 MB.
3. The built-in `GridView` fallback.

CLI:

```bash
bb app list
bb app new --name "Review Board"
bb app new --slug status
bb app show review-board
bb app data list review-board
bb app data read review-board state.json
bb app data write review-board state.json --file ./state.json
bb app message review-board --target-thread thr_123 --json '"Please review the current blockers."'
bb app delete review-board --yes
```

`--json` is available for scripts. Commands accept application ids only, never
display names. There is no host selector in v1; apps are local-host only.

Inside an app-capable runtime, inspect the current app context:

```bash
bb app current --json
```

Outside a current-app runtime, this returns `current_app_unavailable`.

Runtime paths:

```bash
echo "$BB_APPS_ROOT"          # <dataDir>/apps
echo "$BB_APP_ID"             # current application id, when available
echo "$BB_APP_ROOT"           # <dataDir>/apps/<applicationId>, when available
echo "$BB_APP_DATA_PATH"      # <dataDir>/apps/<applicationId>/data, when available
```

Agent writes:

When a runtime has `BB_APP_ROOT`, create or edit the app directly in that
canonical folder. Write app data with a temp file in the same directory and
then `mv` into place. Same-directory rename is atomic on macOS and Linux, and
bb broadcasts the committed app-data change.

```bash
dir="$BB_APP_DATA_PATH"
mkdir -p "$dir"
tmp=$(mktemp "$dir/.state.XXXXXX")
printf '%s\n' '{"tasks":[],"updatedAt":"2026-06-02T00:00:00Z"}' > "$tmp" &&
  mv "$tmp" "$dir/state.json"
```

Data paths are relative to the app's `data/` directory. They must not start or
end with `/`, must not contain backslashes, dot-prefixed segments, `.` or `..`,
and may be nested up to eight path segments. Each segment may use letters,
numbers, dots, underscores, and hyphens.

Browser API:

```ts
window.bb.applicationId
window.bb.appId
await window.bb.data?.read("state.json")
await window.bb.data?.write("state.json", { tasks: [] })
await window.bb.data?.delete("state.json")
const entries = await window.bb.data?.list("")
const unsubscribe = window.bb.data?.onChange("", (event) => {
  console.log(event.path, event.value, event.deleted)
})
await window.bb.message?.("Please review the current blockers.")
```

`window.bb.data` reads and writes JSON values. `onChange(prefix, callback)`
matches a single data file when `prefix` equals that path and matches a subtree
when the changed path is below `prefix + "/"`; `""` matches all app data.
Registering a listener immediately replays existing matching data, and bb
replays again after reconnects or app-data resync hints. Later filesystem
writes, browser writes, and deletes are delivered after that replay.

`window.bb.message(payload)` sends a normal follow-up message to the thread
context that opened the app. Non-iframe callers must provide a target thread
through the message API or CLI; without a target, bb returns
`message_target_required`. App data remains global. Only message delivery is
contextual.

Minimal app pattern:

```html
<main>
  <h1>Current work</h1>
  <ul id="tasks"></ul>
</main>
<script>
const list = document.querySelector("#tasks");

function render(state) {
  const tasks = state?.tasks ?? [];
  list.replaceChildren(
    ...tasks.map((task) => {
      const item = document.createElement("li");
      item.textContent = `${task.title} - ${task.state}`;
      return item;
    }),
  );
}

window.bb.data?.read("state.json").then(render);
window.bb.data?.onChange("state.json", (event) => render(event.value));
</script>
```

Styling:

Make app UI quiet, dense, and consistent with bb unless the user asks for a
different direction. Use Tailwind for layout utilities if helpful, and use the
bb-style tokens below for colors, fonts, borders, radius, and shadows. Apps
render in iframes, so external resources such as Google Fonts, Tailwind CDN,
remote images, and stylesheets load normally.

```html
<script src="https://cdn.tailwindcss.com"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: light;
  --background: oklch(0.9551 0 0);
  --foreground: oklch(0.3211 0 0);
  --card: oklch(0.9702 0 0);
  --muted: oklch(0.8853 0 0);
  --muted-foreground: oklch(0.5103 0 0);
  --border: oklch(0.8576 0 0);
  --accent: oklch(0.9 0 0);
  --success: oklch(0.7 0.15 155);
  --warning: oklch(0.7 0.16 50);
  --destructive: oklch(0.5594 0.19 25.8625);
  --radius: 0.5rem;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Fira Code", ui-monospace, SFMono-Regular, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --background: oklch(0.2178 0 0);
    --foreground: oklch(0.8853 0 0);
    --card: oklch(0.2435 0 0);
    --muted: oklch(0.31 0 0);
    --muted-foreground: oklch(0.7058 0 0);
    --border: oklch(0.34 0 0);
    --accent: oklch(0.32 0 0);
  }
}
body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 13px;
}
.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
}
</style>
```

Keep one canonical app for each concept. Use additional apps only when they are
distinct tools or dashboards.

Related guides:

  bb guide overview
  bb guide managers
  bb guide manager-templates
  bb guide async

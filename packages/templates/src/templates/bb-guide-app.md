---
kind: instruction
title: bb Guide - Apps
summary: Thread app storage, browser API, CLI, and styling reference.
intent: Explain the only supported way to build manager-visible dashboards and interactive thread apps.
editingNotes: Keep this aligned with routes/threads/apps.ts, app-client-script.ts, app CLI commands, and the default status app template.
---
Apps

Apps are the supported way to build dashboards, control panels, and other
interactive surfaces inside thread storage. A manager's primary status surface
is the built-in `status` app. Keep that app current instead of creating legacy
top-level status files.

Important: a bb app is self-contained static HTML/CSS/JS/SVG. Put files under
`apps/<id>/assets/`; bb serves the `entry` file directly from the flat app URL
through the host daemon. Do not start a web server, localhost dev server, npm
install, build step, bundler, or framework for a normal app. Inline CSS/JS,
relative asset refs, and CDN resources such as Tailwind or fonts are fine.

Storage layout:

```text
$BB_THREAD_STORAGE/
  apps/
    status/
      manifest.json
      assets/
        index.html
      data/
        state.json
```

Each app is rooted at `apps/<id>/`. The manifest lives at
`apps/<id>/manifest.json`, browser files live under `apps/<id>/assets/`, and
durable JSON state lives under `apps/<id>/data/`. The `status` app should keep
its primary shared state in `apps/status/data/state.json`.

Manifest:

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

`id` uses letters, numbers, underscores, and hyphens. `entry` is relative to
`assets/`. HTML entries load in an app iframe and receive the `window.bb`
bridge according to `capabilities`; Markdown entries render as static documents
and do not receive `window.bb`. `capabilities` controls which `window.bb`
helpers are injected for HTML entries: `data` enables `window.bb.data`, and
`message` enables `window.bb.message`.

The served app URL is flat: `/api/v1/threads/<thread-id>/apps/<id>/<file>`
maps to `apps/<id>/assets/<file>` on disk. HTML should use flat relative refs
like `./index-abc.js`, not `./assets/index-abc.js`. If you are migrating an
existing Vite build output, set `build.assetsDir = ""` so emitted files sit
alongside `index.html`; new bb apps should stay plain static files.

The icon is optional and uses a built-in icon name. Icon resolution order is:

1. `manifest.icon`, when present, as a built-in icon.
2. A custom top-level `logo.svg`, `logo.png`, `logo.jpg`, or `logo.jpeg` in the
   app root, up to 1 MB.
3. The built-in `GridView` fallback.

CLI:

```bash
bb app list --self
bb app new "Review Board" --id review-board --template blank --self
bb app new "Status" --id status --template status --self
bb app open status --self
bb app rm review-board --self --yes
```

Pass a thread id instead of `--self` to target another thread. `bb app open`
prints the app URL. `--json` is available for scripts.

Agent writes:

Write app data directly to `apps/<id>/data/<path>` using a temp file in the
same directory and then `mv` into place. Same-directory rename is atomic on
macOS and Linux, and bb broadcasts the committed app-data change.

```bash
dir="$BB_THREAD_STORAGE/apps/status/data"
mkdir -p "$dir"
tmp=$(mktemp "$dir/.state.XXXXXX")
printf '%s\n' '{"tasks":[],"updatedAt":"2026-05-28T00:00:00Z"}' > "$tmp" &&
  mv "$tmp" "$dir/state.json"
```

Data paths are relative to the app's `data/` directory. They must not start or
end with `/`, must not contain backslashes, dot-prefixed segments, `.` or `..`,
and may be nested up to eight path segments. Each segment may use letters,
numbers, dots, underscores, and hyphens.

Browser API:

```ts
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
`window.bb.message(text)` sends a normal follow-up message to the thread that
owns the app.

Minimal status app pattern:

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

Keep one canonical app for each concept. For manager progress, update the
`status` app instead of creating parallel views. Use additional apps only when
they are distinct tools or dashboards.

Related guides:

  bb guide overview
  bb guide managers
  bb guide manager-templates
  bb guide async

# bb-plugin-inline-vis

Builtin plugin for the assistant **message directive** slot
(`app.slots.messageDirective`). When the model emits:

```text
::inline-vis{file="demo.html"}
```

Set an optional iframe viewport height in pixels with `height`:

```text
::inline-vis{file="demo.html" height="480"}
```

The default is 224px; accepted values are whole numbers from 120 through 1200.

bb replaces that leaf with this plugin's React component, which:

1. Validates the untrusted `file` attribute.
2. Calls the plugin RPC `prepareHtmlPreview` with the message `threadId` and
   file path to validate the target and surface clean inline errors.
3. Shows loading / error states and a header action that opens the source HTML
   file in bb's sidebar workspace viewer.
4. Points a sandboxed iframe at bb's path-shaped worktree preview route. This
   matches the sidebar HTML preview: relative sibling assets work, scripts are
   enabled, and normal web loading is allowed. The iframe keeps an opaque
   origin (no `allow-same-origin`) so scripts cannot access the bb page, its
   cookies, or storage. Remote scripts, styles, images, fonts, media, fetches,
   and WebSockets work subject to ordinary browser CORS, mixed-content, and
   remote-server policies.

## Backend security

`prepareHtmlPreview` narrows `unknown` input immediately (rejects unknown
keys), loads the thread with `include: "environment"`, requires a live
workspace `path` and `hostId`, confines the workspace-relative `.html`/`.htm`
path under that root, and preflights it through `bb.sdk.files` (host-routed).
Absolute paths, traversal, non-html extensions, missing files, non-UTF-8
content, and files over 5 MiB are rejected. The iframe then uses bb's existing
confined worktree preview route to serve the document and relative assets.

It ships with bb and is reconciled through the builtin plugin lifecycle. Ship
a workspace HTML file, then ask the agent to visualize it with the directive
(see the bundled `inline-vis` skill).

## Tests

```bash
pnpm exec turbo run test typecheck --filter=bb-plugin-inline-vis
```

# bb-plugin-inline-vis

Builtin plugin that shows HTML pages and Markdown documents inside assistant
messages. It fills two slots: the assistant **message directive** slot
(`app.slots.messageDirective`) and the **code fence renderer** slot
(`app.slots.experimental_codeFenceRenderer`).

## Fenced block

A fenced code block with the language `inline-vis` holds the HTML page itself:

````text
```inline-vis
<div style="display:flex;gap:12px">…</div>
```
````

bb mounts the plugin's component once for the fence and keeps it for the whole
stream. The component renders by fence status:

- `streaming`: a short "Writing visualization…" status line.
- `closed`: the page in the frame described below. A button that appears on
  hover shows or hides bb's normal code block for the fence below the frame.
- `unclosed`, or a fence whose body is empty: bb's normal code block.

The page needs no file and no RPC. Its base URL is the app's root, so it
cannot reference workspace files by relative path. A page that contains three
backticks needs a four-backtick fence.

## Directive

```text
::inline-vis{file="demo.html"}
::inline-vis{file="notes.md"}
```

The omitted `source` defaults to `workspace`; `source="workspace"` is equivalent.
For a read-only artifact in the current thread's storage directory, use:

```text
::inline-vis{source="thread-storage" file="reports/result.html"}
```

Set an optional height in pixels with `height`, a whole number from 80 through
2000:

```text
::inline-vis{file="demo.html" height="480"}
```

For an HTML file, `height` caps the frame, and a taller page scrolls inside
it. Without it the frame fits the page. For a Markdown file, `height` is the
height of the card's preview, 256px by default; a longer document expands in
place.

bb replaces the directive with this plugin's React component, which:

1. Validates the untrusted `source`, `file`, and `height` attributes.
2. Calls the plugin RPC `preparePreview` with the message `threadId`, source,
   and file path. The RPC validates the target and returns the file's text.
   For HTML it also returns the URL of the served file and the SHA-256 of the
   text.
3. Shows loading and error states on the first read. An HTML file reserves
   blank space while it loads; a Markdown file shows its card with a skeleton.
   The last eight successful results are retained in memory by thread,
   message, source, and path. Remounts revalidate without discarding them on
   temporary read failures. A confirmed missing file clears its cached result
   and shows an error.
4. Renders HTML files in the frame described below, with the served file's URL
   as the base URL so relative sibling assets load. A button that appears on
   hover opens the source file in bb's sidebar viewer, from the workspace or
   the thread's storage directory. The button is a link to the rendered page:
   Cmd-click, Ctrl-click, or middle-click opens it in a browser tab (the
   default browser in desktop bb).
5. Renders Markdown files with bb's Markdown renderer inside a card. HTML is
   sanitized by the shared renderer. The card header shows the file name and
   folder, copies the Markdown source, and opens the file in the sidebar
   viewer. A document more than 64px taller than the preview height is
   clamped to it, with a fade and a "Show more" control that expands the
   document in place; nothing scrolls inside the card. An expanded document
   stays expanded when its message is rendered again in the same session.
   Markdown links and images resolve
   relative to the document's directory in the selected source. For
   `::inline-vis{source="thread-storage" file="reports/report.md"}`,
   `[Notes](notes.md)` and `![Chart](chart.svg)` refer to files under
   `reports/` in that thread's storage. The same rule applies to workspace
   reports.

## The HTML frame

Both forms render HTML the same way (`frame.ts`, `theme.ts`, and `HtmlFrame`
in `app.tsx`):

- The page is an iframe with no card, title bar, or border, on the thread's
  own background.
- The iframe is fed by `srcdoc`. `frameDocument` adds a charset, a viewport,
  a `<base>` (unless the page has its own), the theme stylesheet, and a small
  bootstrap script at the start of the page's `<head>`.
- The sandbox is `allow-scripts allow-forms` without `allow-same-origin`, so
  the page keeps an opaque origin. Its scripts cannot access the bb page, its
  cookies, or its storage. Remote scripts, styles, images, fonts, media,
  fetches, and WebSockets work subject to ordinary browser CORS,
  mixed-content, and remote-server policies.
- The theme is bb's active tokens as CSS custom properties on `:root`
  (`FRAME_THEME_TOKENS` in `frame.ts`), plus a six-colour chart series and the
  app's sans font. When the app's theme or light/dark mode changes, the host
  posts the new values and the bootstrap applies them without a reload.
- The bootstrap reports the page's content height, and the frame follows it
  from 80 to 2000 pixels. The last reported height is remembered per page
  (by content hash for a file, by message and fence index for a fenced block)
  so a remounted frame starts at the right size.
- A page cannot open windows. When the reader clicks an `http` or `https`
  link, the bootstrap asks the host, and the host opens it in a new tab only
  if the frame has focus and the click is a user activation. Anchor links
  move within the page.

## Backend security

`preparePreview` narrows `unknown` input immediately (rejects unknown keys and
source values). Workspace previews load the thread with
`include: "environment"` and require its live `path` and `hostId`. Thread
storage previews use `bb.sdk.threads.storageLocation` instead and do not resolve
the workspace. Both sources confine the relative `.html`, `.htm`, `.md`, or
`.markdown` path under the returned root and read it through `bb.sdk.files`
(host-routed). Absolute paths, traversal, unsupported extensions, missing files,
non-UTF-8 content, and files over 5 MiB are rejected. HTML previews render the
validated content returned by the RPC and use bb's existing confined worktree
or thread-storage route for relative assets and for opening the page in a
browser tab. Markdown previews render the validated content returned by the
RPC.

It ships with bb and is reconciled through the builtin plugin lifecycle. Ask
the agent to show a page with either form (see the bundled `inline-vis`
skill).

## Tests

```bash
pnpm exec turbo run test typecheck lint --filter=bb-plugin-inline-vis
```

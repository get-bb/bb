---
name: inline-vis
description: "Show an HTML chart, table, diagram, mockup, demo, or report inline in BB chat: write a small page directly in the reply as an inline-vis fenced block, or show a workspace or thread-storage HTML or Markdown file with the inline-vis directive."
---

# Inline previews

Use this when the user should see an HTML page or a Markdown document
**inline in the assistant message**. There are two forms. Pick by where the
page should live.

| Form                               | Use it for                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ` ```inline-vis ` fenced block     | A small, self-contained HTML page written directly in the reply. Nothing is written to disk.                                          |
| `::inline-vis{file="…"}` directive | A page or Markdown document that lives in the workspace or thread storage: bigger pages, pages with sibling assets, anything to keep. |

The reader sees an HTML page as part of your reply: no card, no title bar, on
the thread's own background, as tall as its content. Put the block or the
directive where the page belongs in the reply. The reader already sees the
page, so do not announce it, say where it is, or restate it. Write only what
the page does not say.

## Fenced block: a page written in the reply

Write a fenced code block whose language is `inline-vis`. The body of the
block is the HTML page itself, either a fragment or a full document:

````text
```inline-vis
<div style="display:flex;gap:12px">…</div>
```
````

- The page appears once the closing fence arrives. While you are still
  writing it, the reader sees a short "Writing visualization…" line, so close
  the fence.
- It needs no file and no tool call. Nothing is saved, so use the directive
  for anything the user should keep or open later.
- The page cannot reference sibling files by relative path. Inline its CSS,
  JavaScript, and data, or load them from absolute `https://` URLs.
- If the page itself contains three backticks, open and close the block with
  four backticks.
- The frame fits the page, up to 2000 pixels, and a taller page scrolls
  inside it. The block takes no attributes.
- Keep it small. Every character of the page is part of your reply. For a
  large page, write a file and use the directive.
- The reader can reveal the HTML source from a button that appears over the
  page. If the reply ends before the closing fence, or the block is empty,
  the reader sees an ordinary code block instead.

## Directive: a file in the workspace or thread storage

Write (or update) a source-relative file, then emit this **message
directive** as its own block. It must be outside any code fence:

```text
::inline-vis{file="demo.html"}
::inline-vis{file="notes.md"}
```

Omitting `source` defaults to the workspace. Explicit `source="workspace"` is
equivalent. For a read-only thread-storage artifact, write the document to
`$BB_THREAD_STORAGE/reports/result.html`, then emit its storage-relative path:

```text
::inline-vis{source="thread-storage" file="reports/result.html"}
```

Rules:

- `source` is optional and must be `workspace` or `thread-storage`.
- `file` is relative to the selected source (e.g. `demo.html`,
  `charts/out.html`, `notes.md`). Workspace paths are relative to the current
  workspace; thread-storage paths are relative to `$BB_THREAD_STORAGE`. Never
  put an absolute path in the directive.
- `.html`, `.htm`, `.md`, and `.markdown` files are accepted.
- `height` is optional, a whole number of pixels from 80 through 2000.
  - HTML: omit it and the frame fits the page. Set it to cap the frame; a
    taller page then scrolls inside it.
  - Markdown: the height of the card's preview; omit it for the 256px
    default. The reader expands a longer document in place.
- Keep files small (under the 5 MiB document limit).
- Emit the directive only after the file exists on disk in the selected source.
- Prefer `thread-storage` for read-only generated reports and other artifacts
  that should not modify the workspace.
- Do **not** put the directive inside backticks or a Markdown code fence, or
  it stays literal text. In particular, do not put it inside an `inline-vis`
  fenced block: that block holds HTML, not a directive.
- Incomplete streaming syntax stays literal until the closing `}` arrives, so
  emit a complete directive in one piece when possible.

An HTML file shows a button on hover that opens it in the sidebar. A Markdown
file shows in a card with its file name, a copy button, and the same open
action. A long document shows a preview with a "Show more" control.

## Laying out an HTML page

This applies to both forms. The frame has no border and is as wide as the
reply column (about 710px on desktop, about 360px on phones). Its left edge
lines up with your reply text.

- Leave `html`, `body`, and the outermost element with no background colour.
  The page sits on the thread's background. This overrides general style
  preferences such as a fixed black page background.
- Use a fluid width with no horizontal padding on the outermost element, and
  no outer card, border, or banner title: the page is part of your reply.
- If a box needs its own background (a mock of a specific screen, a panel
  that must stand apart), give it at least 16px of padding on every side and
  `var(--radius)` corners, so content never touches its edge.
- Give charts fixed pixel heights rather than heights that scale with width.
- Let content set the page's height. Avoid viewport-based heights such as
  `100vh` or `height: 100%` on `html` or `body`; the frame follows the page, so
  they can make it grow again and again.

## Theme

bb injects its active theme as CSS custom properties on `:root`. They follow
the user's theme and light/dark mode live, so style with them instead of
fixed colours:

- Surfaces and text: `--background` (identical to the thread around the
  frame), `--foreground`, `--muted`, `--muted-foreground`,
  `--subtle-foreground`, `--card`, `--card-foreground`, `--popover`,
  `--popover-foreground`, `--surface-raised`, `--surface-recessed`.
- Controls: `--primary`, `--primary-foreground` (solid buttons), `--secondary`,
  `--secondary-foreground`, `--accent`, `--accent-foreground` (neutral hover
  surface), `--border`, `--input`, `--ring`.
- Colour: `--brand` (the theme's one accent), `--destructive`,
  `--destructive-foreground`, `--destructive-text`, `--warning`,
  `--warning-text`, `--success`, `--attention`, `--diff-added`,
  `--diff-removed`.
- Charts: `--chart-1` … `--chart-6`, a categorical series.
- Shape and type: `--radius`, `--shadow-xs`, `--shadow-sm`, `--shadow-md`,
  `--shadow-lg`, `--font-sans`, `--font-mono`.

The base stylesheet sets the page's background, colour, and font from these
(14px, the app's own sans face), sets `body` margin to 0, and hides the page's
scrollbar. Your own CSS overrides it.

## What a page can do

- Inline and external CSS/JavaScript are supported. Remote images, fonts,
  media, fetches, and WebSockets are allowed subject to normal browser CORS,
  mixed-content, and remote-server policies.
- Relative assets next to a file shown with the directive load from the same
  source. A fenced block has no sibling files.
- Scripts run in a sandboxed frame with an opaque origin and cannot access the
  bb page, cookies, or storage. Forms work; pop-ups and downloads do not.
- A link to another site opens in a new browser tab when the reader clicks
  it. A link to an anchor (`#section`) moves within the page.
- Markdown uses BB's renderer with sanitized HTML support.

If the plugin is disabled, users see the original directive source or an
ordinary code block. If a directive's path is invalid, they see an inline
error from the plugin.

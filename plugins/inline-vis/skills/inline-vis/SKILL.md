---
name: inline-vis
description: "Show a newly created or updated HTML demo, chart, or report, or Markdown plan, summary, or notes from the workspace or thread storage inline in BB chat with the inline-vis directive."
---

# Inline previews

When the user should see an HTML demo or a Markdown document **inline in the
assistant message**, write (or update) a source-relative file, then emit this
**message directive** as its own block (not inside a fenced code block):

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

## Rules

- `source` is optional and must be `workspace` or `thread-storage`.
- `file` is relative to the selected source (e.g. `demo.html`,
  `charts/out.html`, `notes.md`). Workspace paths are relative to the current
  workspace; thread-storage paths are relative to `$BB_THREAD_STORAGE`. Never
  put an absolute path in the directive.
- `height` is optional and sets the preview height in pixels. It must be a whole
  number from 120 through 1200; omit it for the 224px default.
- `.html`, `.htm`, `.md`, and `.markdown` files are accepted.
- Inline and external CSS/JavaScript are supported in HTML. Remote images,
  fonts, media, fetches, and WebSockets are also allowed subject to normal
  browser CORS, mixed-content, and remote-server policies. Scripts execute in an
  opaque-origin iframe and cannot access the bb page, cookies, or storage.
  Markdown uses BB's renderer with raw HTML disabled.
- Keep files small (under the sidebar preview's 5 MiB document limit).
- Emit the directive only after the file exists on disk in the selected source.
- Prefer `thread-storage` for read-only generated reports and other artifacts
  that should not modify the workspace.
- Do **not** put the directive inside backticks or a markdown code fence, or it
  stays literal text.
- Incomplete streaming syntax stays literal until the closing `}` arrives — emit
  a complete directive in one piece when possible.

The bb app replaces the directive with an inline preview. If the plugin is
disabled or the path is invalid, users see the original directive source or an
inline error from the plugin.

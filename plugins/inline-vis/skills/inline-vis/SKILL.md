---
name: inline-vis
description: "Show a newly created or updated workspace HTML demo, chart, or report, or Markdown plan, summary, or notes inline in BB chat with the inline-vis directive."
---

# Inline workspace previews

When the user should see an HTML demo or a Markdown document **inline in the
assistant message**, write or update the workspace-relative file, then
emit this **message directive** as its own block (not inside a fenced code
block):

```text
::inline-vis{file="demo.html"}
::inline-vis{file="notes.md"}
```

## Rules

- `file` is **workspace-relative** (e.g. `demo.html`, `charts/out.html`). Never
  use absolute paths.
- `height` is optional and sets the preview height in pixels. It must be a whole
  number from 120 through 1200; omit it for the 224px default.
- `.html`, `.htm`, `.md`, and `.markdown` files are accepted.
- Inline and external CSS/JavaScript are supported in HTML. Remote images, fonts,
  media, fetches, and WebSockets are also allowed subject to normal browser
  CORS, mixed-content, and remote-server policies. Scripts execute in an
  opaque-origin iframe and cannot access the bb page, cookies, or storage.
  Markdown uses BB's renderer with raw HTML disabled.
- Keep files small (under the sidebar preview's 5 MiB document limit).
- Emit the directive only after the file exists on disk in the current thread
  workspace.
- Do **not** put the directive inside backticks or a markdown code fence, or it
  stays literal text.
- Incomplete streaming syntax stays literal until the closing `}` arrives — emit
  a complete directive in one piece when possible.

The bb app replaces the directive with an inline preview. If the plugin is
disabled or the path is invalid, users see the original directive source or an
inline error from the plugin.

Turn a Markdown note, report, or document into a typeset, printable PDF. The agent references a `.md` file with the `typst-md` directive, the plugin typesets it through Typst inside the app, and the user saves a real PDF from the rendered sheet.

## What you get

- A page-like sheet rendered inline in the assistant message, not a raw Markdown block.
- **Save PDF** with selectable text, plus **Save SVG**, **Save PNG**, and print.
- **Save Markdown** (the authored `.md`) and **Word (.docx)** from the same menu, and a **Source / Rendered** toggle to read the raw Markdown.
- **Open in sidebar** opens the same sheet and Export menu in the thread's side panel, so the sidebar view matches the inline card.
- One conversion path for the preview and the PDF, so the export matches the screen.
- Headings, lists, tables, code, links, and images from the Markdown source.
- Works with workspace files and read-only thread-storage artifacts.

## How it works

The agent writes a `.md` file and emits:

```text
::typst-md{file="reports/report.md"}
::typst-md{source="thread-storage" file="reports/result.md" height="560"}
```

`source` is optional (`workspace` by default, or `thread-storage`). `height` is optional, 120–1200 pixels, default 224. The plugin reads the file through bb's host-routed file API, converts Markdown to Typst, compiles it with a WebAssembly Typst compiler in the app, and renders the result inline. Images resolve relative to the Markdown file; remote images become links. The source file must be UTF-8 and at most 5 MiB.

## For agents

The bundled `typst-md` skill explains when to use the directive and where the user saves the PDF. Use `typst-md` for a document deliverable (PDF, print, typeset); use `inline-vis` for a quick inline Markdown preview.

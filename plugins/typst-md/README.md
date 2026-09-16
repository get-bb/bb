# bb-plugin-typst-md

Fork-builtin plugin that typesets **Markdown** documents through Typst. It
registers one assistant **message directive** (`app.slots.messageDirective`).
When the model emits:

```text
::typst-md{file="reports/report.md"}
::typst-md{file="reports/report.md" height="560"}
```

the plugin converts the Markdown to Typst, compiles it with a WebAssembly Typst
compiler in the app, and renders the result inline as a paper-like sheet. A
read-only artifact in the current thread's storage directory works the same way:

```text
::typst-md{source="thread-storage" file="reports/result.md"}
```

`source` is optional and must be `workspace` (default) or `thread-storage`.
`height` is optional: a whole number from 120 through 1200 pixels, default 224.

## How it works

1. Validates the untrusted `source` and `file` attributes and rejects unknown
   values before any RPC.
2. Calls `prepareDocument` to read the `.md`/`.markdown` file through
   `bb.sdk.files` (host-routed) from the workspace or thread storage.
3. Converts the Markdown to Typst with `marked` tokens: headings, paragraphs,
   emphasis/strong/strikethrough, inline and fenced code, ordered/unordered
   lists (nested and task lists), tables, links, images, blockquotes, and
   horizontal rules. YAML frontmatter is stripped and raw HTML is kept as
   escaped literal text.
4. Boots the Typst compiler and renderer lazily from jsDelivr (same engine and
   pinned `0.7.0` wasm assets as `typst-inline`) and compiles the document.
5. Renders the document inline. Markdown images resolve **relative to the
   `.md` file** and are read through the `readAsset` RPC and the Typst access
   model. Remote images are not downloaded and become links.

The inline preview and the exported PDF come from the same compiled document,
so the PDF matches what the user sees.

## Export and source

The header has a **Source / Rendered** toggle that swaps the typeset sheet for
the raw Markdown in the host code viewer, and an **Export** menu:

- **Save Markdown** downloads the authored `.md` source unchanged.
- **Word (.docx)** converts the Markdown through bb's core exporter. The Word
document follows the Markdown, not the Typst page layout, and resolves images
relative to the `.md` file.
- **Save PDF** downloads a vector PDF with selectable text.
- **Save SVG** and **Save PNG** (one 2x file per page) and **Печать** print one
sheet per Typst page.

The Typst source is capped at 5 MiB and must be UTF-8; assets are capped at
8 MiB per file.

## Sidebar panel

The card's **Open in sidebar** action opens the plugin's own **Markdown document**
panel in the thread's side panel. The panel renders the same typeset sheet and
has the same Export menu, so the sidebar view matches the inline card. The panel
is also listed in the side panel's new-tab launcher; without a document target it
shows a short hint. The standard Markdown file preview stays owned by the other
plugins, so this plugin panel is how the typeset/PDF view is guaranteed in the
sidebar.

## Limits

- Fonts are the Typst-bundled Libertinus Serif, New Computer Modern, and DejaVu
  Sans Mono. `#import "@preview/…"` packages are not available.
- Mermaid diagrams are not rendered; a ` ```mermaid ` fence becomes a plain code
  block. Generate a diagram as an image file and reference it instead.

## Backend security

`prepareDocument` and `readAsset` narrow `unknown` input immediately (rejecting
unknown keys and source values), confine the relative path under the resolved
root, and read through `bb.sdk.files`. Absolute paths, traversal, unsupported
extensions, missing files, non-UTF-8 content, and oversized files are rejected.

## Tests

```bash
pnpm exec turbo run test typecheck --filter=bb-plugin-typst-md
```

Engine tests use an in-process fake compiler and renderer; the JavaScript/Rust
wasm bundle is exercised manually against the network with
`scripts/verify-engine.ts`.

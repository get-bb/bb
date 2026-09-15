# bb-plugin-typst-inline

Builtin plugin for the assistant **message directive** slot
(`app.slots.messageDirective`). When the model emits:

```text
::typst{file="reports/report.typ"}
```

BB replaces that leaf with this plugin's React component, which typesets the
document and shows it as a paper-like sheet inside the conversation.

`source` is optional and defaults to `workspace`; `source="thread-storage"`
reads a read-only artifact from the current thread's storage directory.
`height` is optional, must be a whole number from 120 through 1200, and
defaults to 224.

## How it works

1. The component validates the untrusted `source`, `file`, and `height`
   attributes.
2. It calls the plugin RPC `prepareArtifact` with the message `threadId`,
   `source`, and `file`. The RPC resolves the workspace path and `hostId` (or
   the thread storage root), confines the relative `.typ` path under that root,
   reads the file through `bb.sdk.files`, and rejects missing files, non-UTF-8
   content, and files over 5 MiB.
3. Compilation runs in the app with the WebAssembly Typst compiler
   (`@myriaddreamin/typst.ts`). The compiler and renderer modules (about 28 MB
   and 1 MB) and the default Typst text fonts load lazily from jsDelivr the
   first time a directive is rendered. Nothing is downloaded when the plugin is
   unused.
4. The compiler resolves `#include`, `#image`, `#read`, and the data loaders
   relative to the `.typ` file. Every path it asks for is read through the
   plugin RPC `readArtifactFile`, which applies the same root confinement and a
   per-file size cap, and the bytes are handed back to the compiler. The
   compiler stops at the first unreadable file, so dependencies load one
   compile round at a time: an artifact may reference at most 32 dependency
   files and 8 MiB in total, within 40 compile rounds.
5. The renderer returns an SVG document; the component shows it on a white
   sheet with a scrollable viewport at the requested height. Compilation errors
   are shown inline instead of the sheet.
6. The plugin claims the `typ` extension in BB's file opener. A `.typ` file
   opened from a chat link, the file search, the workspace explorer, or the
   card's sidebar action shows the rendered document in the file panel instead
   of the source. Files that belong to neither a thread nor a project (host
   paths) keep BB's default text preview. Every artifact also gets a re-render
   action that drops the cached rendering, re-reads the dependencies, and
   compiles again. A failed artifact offers Try again.
7. An Export menu, on the inline card and in the file panel:
   - **Save PDF** compiles the document in PDF mode and downloads it.
   - **Save SVG** downloads the rendered vector document.
   - **Save PNG** rasterizes each page at 2x in the browser and downloads one
     file per page. Only the visible page is drawn: the renderer's invisible
     text-selection layer is omitted because it would taint the canvas.
   - **Печать** prints one sheet per Typst page at its page size, so the
     browser's "Save as PDF" produces the same pagination.

   PDF compiles again; SVG and PNG reuse the cached rendering. A page that cannot
be rasterized or encoded reports an error instead of leaving the menu busy.

   To see the source instead, use the one-off Open with choice on a file link or
   change the opener for the extension in Settings.

Rendered SVGs are cached in the app for up to 24 artifacts, keyed by thread,
source, file, and a source hash, so scrolling and re-renders do not recompile.
Dependencies are re-read on every render, so an edited `#include` is reflected
as soon as the message renders again.

## Typst surface

- Default text fonts are loaded from the Typst font assets CDN; other fonts are
  not available.
- `#import "@preview/..."` (Typst Universe packages) is not resolved. The
  document must be self-contained apart from files in the same source.
- JavaScript data in the rendered document is disabled; the SVG is inserted as
  static content.

## Tests

```bash
pnpm exec turbo run test typecheck --filter=bb-plugin-typst-inline
```

The tests cover directive and file-opener registration, attribute validation,
path confinement, source resolution (thread, environment, project, and thread
storage), dependency reads, error mapping, the retry loop and its budgets, the
rendered sheet, page splitting, the print document, and the export actions. The WebAssembly compiler itself is not
exercised in unit tests; `lib/typst-engine.ts` is mocked in `app.test.tsx`.

`scripts/verify-engine.ts` compiles real documents, including a 21-dependency
report, pages, and a PDF, through `lib/typst-engine.ts`. It needs network
access (jsDelivr). PNG export needs a real canvas: `lib/typst-raster.test.ts`
covers the rasterization steps with a stubbed canvas, and the browser output was
verified in Chromium (200x100pt pages render as 400x200px PNGs with content):

```bash
pnpm exec tsx scripts/verify-engine.ts
```

Typeset a Typst document and show it inline in the assistant message as a paper-like sheet. The agent writes a `.typ` file to the workspace or thread storage, and the plugin compiles and renders it in the conversation and in bb's file viewer. Documents export as PDF, SVG, or PNG, and print with Typst's own pagination.

## What you get

- A white sheet with the rendered pages, scrollable in place. The agent can set a height from 120 to 1200 pixels; the default is 224.
- The plugin claims `.typ` files in bb's file opener, so a `.typ` file opened from a chat link, the file search, or the card's sidebar action shows the rendered document in the file panel instead of the source. Files outside a project or thread (host paths) keep bb's default text preview.
- An Export menu on the inline card and in the file panel: save PDF, SVG, or PNG (one 2x file per page, rasterized in the browser), and print with page breaks per Typst page. A re-render action re-reads the dependencies and typesets the document again.
- A clear inline error when the document is missing, too large, not UTF-8, or fails to compile, with a Try again action.
- No Typst installation: the compiler and renderer are WebAssembly modules that load on first use, and the default Typst text fonts come from the Typst font assets CDN. PDF export compiles the document again in PDF mode; SVG and PNG reuse the cached rendering.

## How it works

The agent emits a message directive that names a source-relative `.typ` file. Omitting `source` defaults to the workspace, and explicit `source="workspace"` is equivalent:

```text
::typst{file="reports/report.typ" height="560"}
::typst{source="thread-storage" file="reports/result.typ"}
```

The plugin confirms the file exists in the selected source before it renders. Files must be UTF-8 text with a maximum size of 5 MiB. `#include` and `#image` paths resolve relative to the `.typ` file and are read through the same confined file API, so multi-file documents work without exposing host paths. An artifact may reference up to 32 dependency files and 8 MiB in total.

Typst Universe packages (`@preview/...`) and fonts other than the bundled default text fonts are not available.

## For agents

The bundled `typst-inline` skill teaches the agent when to emit the directive and how to write the file.

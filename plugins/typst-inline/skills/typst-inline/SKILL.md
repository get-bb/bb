---
name: typst-inline
description: "Render a Typst document inline in a BB chat message with the typst directive. Use it when a report, paper, invoice, formula-heavy summary, or typeset PDF-style artifact should be typeset rather than shown as plain Markdown or HTML."
---

# Inline Typst documents

When the user should see a **typeset document** inline in the assistant message,
write a `.typ` file into the workspace (or thread storage), then emit this
**message directive** as its own block (not inside a fenced code block):

```text
::typst{file="reports/report.typ"}
```

BB compiles the file with a WebAssembly Typst compiler in the app itself. The
user does **not** need a `typst` binary, and you should not try to run one.

## Rules

- `file` is relative to the selected source and must end with `.typ`.
- `source` is optional and must be `workspace` (default) or `thread-storage`.
  For a read-only artifact, write the file under `$BB_THREAD_STORAGE` and emit
  its storage-relative path:

  ```text
  ::typst{source="thread-storage" file="reports/result.typ"}
  ```

- `height` is optional and sets the preview height in pixels: a whole number
  from 120 through 1200. The default is 224.

  ```text
  ::typst{file="reports/invoice.typ" height="560"}
  ```

- Never put an absolute path in the directive.
- Emit the directive only after the file exists on disk in the selected source.
- Do not put the directive inside backticks or a Markdown code fence, or it
  stays literal text. Incomplete streaming syntax stays literal until the
  closing `}` arrives, so emit a complete directive in one piece.

## What the document can use

- The page is rendered like paper: a white sheet inside the message.
- **Fonts**: the Typst default text fonts (Libertinus Serif, New Computer
  Modern, DejaVu Sans Mono) are bundled by the compiler and need no setup.
  Other fonts are not available, so do not set `#set text(font: "Arial")`;
  pick `"Libertinus Serif"`, `"New Computer Modern"`, or `"DejaVu Sans Mono"`,
  or leave the font unset.
- **Local files**: `#include "chapters/intro.typ"`, `#image("logo.png")`, and
  similar paths resolve **relative to the `.typ` file**, inside the same source
  (workspace or thread storage). Other workspace files are readable, so a
  multi-file document works. Keep images small: an artifact may load at most 32
  files, 8 MiB in total, and each file is read from disk when the message
  renders.
- **Packages**: `#import "@preview/..."` is not available. Write self-contained
  Typst without Typst Universe packages.
- **Data**: a typed Typst document can read nothing from the network. Inline
  numbers, text, or tables directly in the file, or generate the `.typ` content
  from data you already have. `#read`/`#json` on repository files only works
  for files inside the same source directory tree.

## Keep it small

The source file is capped at 5 MiB and must be UTF-8 text. A long report is
fine; a generated data dump is not. Prefer a compact table over thousands of
lines of literal text.

## After writing

1. Write the `.typ` file with the file tools.
2. Make sure it compiles mentally: check that every `#include` and `#image`
   path exists relative to the file, and that styles use available fonts.
3. Emit the directive as its own block.

The user can open the same document in bb's file panel (clicking a `.typ` link or
the sheet's sidebar action) and export it as PDF, SVG, or PNG, or print it, from
the sheet's Export menu. Tell the user that the render is available there
instead of pasting the source. When the request is about a PDF, a printable
file, or a document in general, follow the `typst-pdf` skill for the offer and
export steps.

When the file changes, BB recompiles it and replaces the rendered sheet in the
message. If the document is missing, too large, not UTF-8, or fails to compile,
the user sees the Typst error inline in place of the sheet. Fix the file and
tell the user briefly what changed instead of dumping the directive again.

---
name: typst-md
description: "Typeset a Markdown document as a page-like paper sheet and save it as a real PDF. Use when the user wants a PDF, printable, or typeset version of Markdown notes, reports, or documents — including \"save as pdf\", \"сохрани в pdf\", \"сделай pdf\", \"сверстай\", \"оформи как документ\", \"распечатай\"."
---

# Markdown as a Typst PDF

`typst-md` turns a **Markdown** file into a typeset document. BB converts the
Markdown to Typst, compiles it with a WebAssembly Typst compiler in the app, and
shows the result inline as a paper-like sheet. The user saves a real PDF from
that sheet. **You cannot write the PDF file yourself** — the app compiles it
when the user picks *Save PDF*. Never say that you saved or attached a PDF.

Use this instead of `inline-vis` when the user wants a document they keep,
print, or send. `inline-vis` is the quick inline Markdown preview; `typst-md`
is the typeset deliverable.

## When this applies

- PDF wording: "pdf", "save as pdf", "export to pdf", "download as pdf",
  "print this", "printable", "сохрани в pdf", "сохрани документ", "сделай pdf",
  "экспорт в pdf", "распечатай", "для печати".
- Typesetting wording: "typeset", "lay out", "format this as a document",
  "сверстай", "оформи как документ", "в виде документа".
- A document whose obvious deliverable is a PDF: report, invoice, resume,
  contract, meeting notes, cheat sheet, handout — отчёт, счёт, резюме, договор,
  шпаргалка.

Do not use it for a short answer that belongs in the chat, or when the user
wants plain Markdown, HTML, or source code.

## Emit the directive

1. Write the `.md` file with the file tools (workspace path like
   `reports/<slug>.md`, or `$BB_THREAD_STORAGE` for a read-only artifact).
2. Emit the directive as its own block, not inside backticks or a code fence:

   ```text
   ::typst-md{file="reports/report.md"}
   ::typst-md{source="thread-storage" file="reports/result.md" height="560"}
   ```

   - `file` is relative to the selected source. Workspace paths are relative to
     the current workspace; `thread-storage` paths are relative to
     `$BB_THREAD_STORAGE`. Never use an absolute path.
   - `source` is optional and must be `workspace` (default) or
     `thread-storage`.
   - `height` is optional, a whole number from 120 through 1200 pixels; the
     default is 224. Raise it in steps of 120 to show more of a long page.

## What converts

Headings, paragraphs, emphasis, strong, strikethrough, inline code, fenced code
blocks, ordered and unordered lists (including nested and task lists), tables,
links, images, blockquotes, and horizontal rules. YAML frontmatter is removed.

- **Images** resolve **relative to the `.md` file** in the same source. Remote
  images (`https://…`) are not downloaded and become links.
- **Fonts and packages** follow the same limits as `typst-inline`: the bundled
  Libertinus Serif, New Computer Modern, and DejaVu Sans Mono fonts are
  available, and `#import "@preview/…"` is not.
- **Mermaid** diagrams are **not rendered**; a ```mermaid fence becomes a plain
  code block. If the document needs a diagram, generate it as an SVG/PNG image
  file and reference it with `![…](path.svg)`.
- The source file is capped at 5 MiB and must be UTF-8 text.

## After writing

Tell the user how to get the PDF: in the rendered sheet open the **Export** menu
and choose **Save PDF**. The same menu saves **Markdown** (the authored source),
**Word (.docx)**, SVG, and PNG, and prints one sheet per Typst page; the header's
**Source** toggle shows the raw Markdown. State this explicitly — the PDF is not
attached to your message.

If the document fails to compile, fix the `.md` file and briefly say what
changed instead of reprinting the source. BB replaces the sheet when the file
changes.

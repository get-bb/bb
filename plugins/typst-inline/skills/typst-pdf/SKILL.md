---
name: typst-pdf
description: "Deliver a document as a PDF file by typesetting it in Typst first. Use when the user wants a PDF, asks to save, export, download, or print a document, or asks to typeset/lay out a document — including \"save as PDF\", \"сохрани в pdf\", \"сохрани документ\", \"сделай pdf\", \"сверстай\", \"распечатай\". Offer typesetting when the format is not stated, render the document inline, and tell the user where to save the PDF."
---

# PDF documents through Typst

A real PDF comes from a typeset document: BB compiles it in the app, shows it
inline as a paper-like sheet, and the user saves the PDF from that sheet. Pick
the directive by the source format:

- **Markdown source** → emit `::typst-md{file="reports/report.md"}` (see the
  `typst-md` skill). Use this when the document already exists as Markdown or
  should stay Markdown in the workspace.
- **Full typographic control** → write a `.typ` file and emit
  `::typst{file="reports/report.typ"}` (this skill).

**You cannot write the PDF file yourself** — the app compiles it when the user
picks *Save PDF*. Never say that you saved or attached a PDF.

## When this applies

Use this skill when the user's end result is a document file they keep, print,
or send:

- PDF wording: "pdf", "save as pdf", "export to pdf", "download as pdf",
  "print this", "printable", "сохрани в pdf", "сохрани документ",
  "сделай pdf", "экспорт в pdf", "распечатай", "для печати".
- Typesetting wording: "typeset", "lay out", "format this as a document",
  "сверстай", "оформи как документ", "в виде документа".
- Document kinds whose obvious deliverable is a PDF: report, invoice, receipt,
  resume/CV, cover letter, contract, certificate, diploma, thesis, paper,
  article, book chapter, cheat sheet, handout, meeting notes — отчёт, счёт,
  резюме, договор, справка, диплом, статья, шпаргалка.

Do not reach for it for a short answer that belongs in the chat, or when the
user explicitly wants Markdown, HTML, source code, or plain text.

## Offer typesetting before you render

- If the user asked for **PDF, printing, or saving a document as a file**, say
  in one sentence that you will typeset it in Typst and that they will save the
  PDF from the rendered sheet, then do it.
- If the user asked for a **document without naming a format** (for example
  "make a report" or "напиши резюме"), ask first which delivery they want:
  - Prefer the `AskUserQuestion` tool when it is available. Ask one question
    such as "How should I deliver the document?" with two options:
    "Typeset in Typst (Recommended)" — a page-like document you can save as
    PDF, SVG, or PNG — and "Keep it as Markdown in the chat" — quick, no export.
  - Otherwise ask the same choice in a single short sentence in your reply.
- Ask once per thread. Once the user chose or declined, do not ask again.

## Build the document

1. Write the source file with the file tools. For Markdown, write the `.md`
   file and emit `::typst-md{file="reports/<slug>.md"}`. For full control,
   write a `.typ` file (prefer a workspace path such as `reports/<slug>.typ`).
   For a read-only artifact, write under `$BB_THREAD_STORAGE` and use
   `source="thread-storage"`.
2. Emit the directive as its own block, never inside backticks or a code fence:

   ```text
   ::typst{file="reports/report.typ"}
   ::typst{source="thread-storage" file="reports/result.typ" height="560"}
   ```

   `height` is optional, a whole number from 120 through 1200 pixels, default
   224. Raise it in steps of 120 to show more of a long page.
3. Write Typst that compiles with BB's bundled compiler:
   - Fonts: `"Libertinus Serif"`, `"New Computer Modern"`, or
     `"DejaVu Sans Mono"`, or leave the font unset. Other fonts are not
     installed, so `#set text(font: "Arial")` fails.
   - No Typst Universe packages: `#import "@preview/..."` is not resolved.
   - `#include`, `#image`, and `#read` resolve relative to the `.typ` file
     inside the same source. At most 32 dependency files and 8 MiB in total;
     the source itself is at most 5 MiB and must be UTF-8.
   - Use `#set page(paper: "a4", margin: 2cm)` when the default sheet is not
     right, and `#set page(numbering: "1 / 1")` for page numbers.
   - Escape text-mode markup. `@` starts a reference, so an email must be
     `sale\@example.com` or `#link("mailto:sale@example.com")[sale@example.com]`;
     escape `#`, `$`, `_`, `*`, `` ` ``, `~`, `<`, `>`, `[`, `]`, and `\` when
     they are literal text.
4. Tell the user how to get the PDF: in the rendered sheet open the **Export**
   menu and choose **Save PDF**. The same menu saves SVG and PNG and prints one
   sheet per Typst page; a `.typ` file opened in the file panel has the same
   Export menu. State this explicitly — the PDF is not attached to your message.

## After writing

- If the document fails to compile, fix the `.typ` file and briefly say what
  changed instead of reprinting the source. BB replaces the sheet when the file
  changes.
- Keep the reply small: summarize the document, do not paste the `.typ` source
  into the chat.

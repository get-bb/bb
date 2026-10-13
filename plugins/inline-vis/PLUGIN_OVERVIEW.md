See an agent's chart, mockup, demo, report, or Markdown document in the conversation without opening a side panel. The agent either writes a small HTML page directly in its reply, or writes an HTML or Markdown file to the workspace or the thread's storage directory. The plugin shows the page inside the assistant message.

## What you get

- An HTML page shown as part of the reply: no card and no title bar, on the thread's own background, as tall as its content.
- The page in your theme. It gets bb's colours, radius, shadows, and font as CSS variables, and follows a theme or light/dark change live without reloading.
- For a page from a file, a button that appears on hover and opens the file in bb's sidebar viewer. Cmd-click, Ctrl-click, or middle-click it to open the rendered page in a browser tab instead.
- For a page written in the reply, a button that appears on hover and shows or hides the HTML source below the page.
- A formatted Markdown document in a card that shows its file name, with buttons to copy the Markdown and open the file in the sidebar. A long document shows a preview and expands in place with "Show more".
- A clear inline error when a file is missing, too large, or unsupported.

## How it works

There are two ways for the agent to show a page.

A fenced code block with the language `inline-vis` holds the HTML page itself. Nothing is written to disk. While the reply is still streaming, the block shows a short status line. The page appears when the closing fence arrives. If the reply ends before the fence closes, bb shows its normal code block.

```inline-vis
<div style="display:flex;gap:12px">…</div>
```

A message directive names a source-relative `.html`, `.htm`, `.md`, or `.markdown` file. Omitting `source` defaults to the workspace, and explicit `source="workspace"` is equivalent:

```text
::inline-vis{file="charts/out.html"}
::inline-vis{file="charts/out.html" height="480"}
::inline-vis{file="reports/summary.md"}
::inline-vis{source="thread-storage" file="reports/result.html"}
```

For a directive, the plugin checks the path, confirms the file exists in the selected source, and reads its text. Files must be UTF-8 text with a maximum size of 5 MiB. Relative assets next to an HTML file load as usual. A page written in a fenced block has no sibling files.

An HTML frame fits its page: the page reports its content height and the frame follows it, from 80 to 2000 pixels. A `height` on the directive caps the frame, and a taller page then scrolls inside it. A Markdown card uses `height` as the height of its scrolling area.

HTML runs in a sandboxed iframe with an opaque origin. Scripts in the page cannot read the bb page, its cookies, or its storage. A page cannot open windows. When the reader clicks a link to another site, the app opens it in a new tab. Markdown uses bb's renderer with sanitized HTML support.

## For agents

The bundled `inline-vis` skill teaches the agent when to use a fenced block and when to use the directive, how to lay a page out so it reads as part of the reply, and which theme variables to style with. No account or external service is required.

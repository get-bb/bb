See an agent's chart, demo, report, or Markdown document in the conversation without opening a side panel. The plugin shows the workspace file inside the assistant message.

## What you get

- A live HTML preview or formatted Markdown document in the message.
- A default viewport height of 224 pixels. The agent can set a height from 120 to 1200 pixels.
- A header action that opens the source file in the workspace viewer.
- A clear inline error when the file is missing, too large, or unsupported.

## How it works

The agent emits a message directive that names a workspace-relative `.html`, `.htm`, `.md`, or `.markdown` file:

```text
::inline-vis{file="charts/out.html" height="480"}
::inline-vis{file="reports/summary.md"}
```

The plugin confirms the file exists in the thread workspace before it renders. Files must be UTF-8 text with a maximum size of 5 MiB. Relative assets next to HTML files load as usual.

HTML runs in a sandboxed iframe with an opaque origin. Markdown uses bb's renderer with raw HTML disabled.

## For agents

The bundled `inline-vis` skill teaches the agent when to emit the directive and how to write the file. No account or external service is required.

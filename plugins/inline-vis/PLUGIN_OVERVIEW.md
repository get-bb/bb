See an agent's chart, demo, or report in the conversation without opening a side panel. The agent writes an HTML file to the workspace or the thread's storage directory. The plugin shows that file inside the assistant message.

## What you get

- A live preview card in the message. Scripts and styles in the file run.
- A default viewport height of 224 pixels. The agent can set a height from 120 to 1200 pixels.
- A header action that opens workspace source HTML in the workspace viewer. Thread-storage previews omit this action.
- A clear inline error when the file is missing, too large, or not HTML.

## How it works

The agent emits a message directive that names a source-relative `.html` or `.htm` file. Omitting `source` defaults to the workspace, and explicit `source="workspace"` is equivalent:

```text
::inline-vis{file="charts/out.html" height="480"}
```

Read-only artifacts in the thread's storage directory can be rendered without resolving the workspace:

```text
::inline-vis{source="thread-storage" file="reports/result.html"}
```

The plugin confirms the file exists in the selected source before it renders. Files must be UTF-8 text with a maximum size of 5 MiB. Relative assets next to the file load as usual.

The preview runs in a sandboxed iframe with an opaque origin. Scripts in the file cannot read the bb page, its cookies, or its storage.

## For agents

The bundled `inline-vis` skill teaches the agent when to emit the directive and how to write the file. No account or external service is required.

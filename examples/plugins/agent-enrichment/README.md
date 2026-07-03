# bb-plugin-agent-enrichment

The "agent enrichment" hero plugin: no UI bundle, no background services —
its entire surface is agent-facing. It demonstrates:

- **`bb.cli.register`** — a `bb docs` command. Agents run it through bash
  exactly like humans do (`bb docs search <query...>`); the handler runs
  server-side and text-searches the bundled `docs/` folder of markdown files.
  Agents discover it through the server-generated `plugin-commands` skill.
- **`bb.agents.registerTool`** — `docs_search`, the same search as a native
  dynamic tool. Parameters are a zod schema: validated per call (a model's
  bad arguments become a tool error, not a plugin error) and converted to the
  JSON schema providers see. The tool rides the session's `dynamicTools`, so
  it appears on the next thread/turn start.
- **`bb.ui.registerMentionProvider`** — type `@` in the composer and search
  the bundled docs by title; picking one inserts a pill, and the doc's full
  body is resolved at send time and attached as agent-only context.
- **`bb.settings.define`** — a boolean (`caseSensitive`) rendered in BB's
  settings UI and editable with `bb plugin config agent-enrichment`.
- **`bb.storage.kv`** — caches the last search (`bb docs last` prints it;
  the CLI command and the native tool share the cache).
- **`skills/repo-conventions/`** — the conventional plugin skills directory,
  auto-imported into every thread's skills through the plugin skills tier.

Dependencies: only `zod`, for the tool parameters. When BB runs from a
source checkout the import resolves from BB's own dependencies, so the
plugin works as-is from `examples/`; if you copy it elsewhere, run
`npm install` in the plugin directory first.

## Install

Requires the "Plugins" experiment (Settings → Experiments).

```
bb plugin install ./examples/plugins/agent-enrichment
bb plugin list
```

## Try it

```
bb docs search "conventional commits"
bb docs last
bb plugin config agent-enrichment set caseSensitive true
```

In a thread (next turn start after install): ask the agent to call the
`docs_search` tool, `@`-mention a doc (type `@testing` in the composer), or
just ask about repo conventions — the `repo-conventions` skill is already
available to it.

After editing sources, `bb plugin reload agent-enrichment`.

# bb-plugin-agent-enrichment

The "agent enrichment" hero plugin: no UI, no background services, no
dependencies — its entire surface is agent-facing. It demonstrates:

- **`bb.cli.register`** — a `bb docs` command. Agents run it through bash
  exactly like humans do (`bb docs search <query...>`); the handler runs
  server-side and text-searches the bundled `docs/` folder of markdown files.
  Agents discover it through the server-generated `plugin-commands` skill.
- **`bb.settings.define`** — a boolean (`caseSensitive`) rendered in BB's
  settings UI and editable with `bb plugin config agent-enrichment`.
- **`bb.storage.kv`** — caches the last search (`bb docs last` prints it).
- **`skills/repo-conventions/`** — the conventional plugin skills directory.
  Automatic skills/ import ships in a later BB phase; until then this
  documents the expected layout.

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

After editing sources, `bb plugin reload agent-enrichment`.

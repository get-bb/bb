# @Plugin reference example

Adds installed and Community plugins to bb's existing `@` mention menu. It is
a reference implementation for cross-resource mention relevance: an exact
plugin result should outrank weaker thread, project, section, or path matches
without giving the plugin control over those sources.

## What it demonstrates

- Two `bb.ui.registerMentionProvider` registrations under the default `@`
  trigger: **Installed** and **Community**.
- Live installed-plugin discovery through `bb.sdk.plugins.list()`.
- Compatible, uninstalled Community discovery through
  `bb.sdk.plugins.catalog.search()`.
- Exact, prefix, then substring ranking within each provider, while bb owns
  cross-provider ordering and keeps each rendered section contiguous.
- Send-time resolution that revalidates the selected identity before attaching
  bounded, agent-only context.
- Advisory installed-plugin context that neither forces a tool call nor widens
  permissions, and Community context that makes installation an explicit user
  action.

A mention never installs, enables, configures, authenticates, or invokes a
plugin by itself.

## Run it

```sh
bb plugin install ./examples/plugins/at-plugin
bb plugin list
```

Type `@` in a composer and search for an installed or Community plugin. After
editing the example, reload it with:

```sh
bb plugin reload at-plugin
```

## Verify it

```sh
pnpm exec turbo run typecheck test --filter=bb-plugin-at-plugin
```

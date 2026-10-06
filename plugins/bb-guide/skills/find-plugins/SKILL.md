---
name: find-plugins
description: "Search the BB plugin store and recommend existing plugins. Use when the user asks whether bb can do something or whether a plugin exists for it, describes a workflow they repeat, or before building a new plugin or feature."
---

# Find plugins

Check what already exists before you build or say that bb cannot do something.

## Search

Run 2–3 searches with different short keywords, such as the task, the tool it
touches, and a synonym:

```sh
bb plugin search browser --json
bb plugin search screenshot --json
```

Search matches each term as one substring of the id, name, description,
category, or tags, so use one or two words per query. Merge the results by
`pluginId`.

## Recommend

Recommend at most three plugins that fit, each with a one-line reason. Order
them:

1. Already installed (`installed: true`).
2. Official plugins bundled with bb (`marketplace: "bb-official"`).
3. Reviewed BB Community plugins (`marketplace: "bb-community"`).

Show a third-party marketplace result only when nothing above fits, and label
it as not reviewed by BB. Mention when a result is incompatible
(`compatible: false`) and why.

If a `show_plugin_card` tool is available, call it with each recommendation's
exact `pluginId` and copy the line it returns into your reply on its own line.
The card opens the plugin's detail page, where the user can enable or install
it.

Never install, enable, or disable a plugin unless the user explicitly asks you
to.

## Nothing fits

Say so plainly, and offer to build it as a plugin. Use the
bb-plugin-authoring skill if the user agrees.

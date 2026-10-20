---
title: Plugins
description: Plugins add panels, tools, looks and agent skills to bb. Most of bb itself is plugins, so you can change almost any part of it.
section: extend-bb
order: 10
status: published
updated: "2026-10-20"
relatedGuides:
  - agent-browser
relatedDocs:
  - install-plugins
  - plugin-trust
  - build-a-plugin
redirectFrom: []
media: {}
---

Plugins are how you make bb yours. A plugin adds something to bb: a sidebar panel, a new tool for your agents, a different look, or a command. Ask an agent for one in plain words, and the agent installs it.

## bb is built from plugins

Most of bb is plugins. bb ships with 43 of them: 36 install automatically, and 7 official plugins, including GitHub and Memory, install when you ask. Scheduled jobs and remote access are plugins too.

You can turn off any plugin bb ships with, or replace it with your own version.

## What a plugin can change

- **How bb looks:** themes, backgrounds, and a different sidebar.
- **What your agents can do:** new skills, tools, and agent providers.
- **What you see in a thread:** charts, interactive answers, and decision cards in the chat.
- **The tools around your work:** panels for pull requests, a content calendar, and daily briefs.

For every place a plugin can add to bb, see the [Plugin Guide](/plugin-guide).

## Where plugins come from

| Source | What it is |
| --- | --- |
| **Included with bb** | Plugins that ship with the app. Most install automatically, and some start turned off (for example, MCP server and Prompt Library). Official plugins like GitHub and Memory install when you ask. |
| **The marketplace** | Plugins from the bb team and the community, each with its author named. [Browse the marketplace →](/marketplace) |
| **Your own** | A plugin an agent builds for you. See [Build your own plugin](/docs/build-a-plugin). |

Nothing from the marketplace is in bb until you install it, so bb stays as small as you want it.

:::note
Plugins are full-access code. Read [Before you install a plugin](/docs/plugin-trust) first.
:::

## Next

- [Install a plugin](/docs/install-plugins)
- [Build your own plugin](/docs/build-a-plugin)

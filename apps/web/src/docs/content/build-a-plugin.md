---
title: Build your own plugin
description: Ask an agent for the tool you’re missing, and it builds it as a plugin. Share it in the marketplace when it’s ready.
section: extend-bb
order: 40
status: published
updated: "2026-10-20"
relatedGuides: []
relatedDocs:
  - plugins
  - plugin-trust
redirectFrom: []
media: {}
---

If bb is missing something, describe the plugin you want, and an agent builds and installs it, asking about the design if it needs to.

## Ask for what you want

Describe the result, not the code:

> Add a sidebar panel that lists my open pull requests, with lines changed for each.

> Make a command that starts a thread to review today’s changes.

Ask for changes the same way until it’s right.

## What you can build

A plugin can add panels, pages, interactive answers in the chat, commands, agent tools and skills, themes, and more. The [Plugin Guide](/plugin-guide) shows every place a plugin can extend bb, with a prompt you can copy for each one.

## Share it

When your plugin is ready, ask an agent to submit it to the bb marketplace:

> Submit my PR panel plugin to the bb marketplace.

The agent opens a pull request on the [bb marketplace repository](https://github.com/get-bb/marketplace). The bb team reviews it before it’s listed, and you’re credited as the author. Once it’s listed, anyone can install it.

Read [Before you install a plugin](/docs/plugin-trust): the same trust model applies to plugins you share.

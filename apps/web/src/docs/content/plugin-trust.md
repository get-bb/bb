---
title: Before you install a plugin
description: Plugins are full-access code, like npm packages. Here’s how to check one before you install it.
section: extend-bb
order: 30
status: published
updated: "2026-10-20"
relatedGuides: []
relatedDocs:
  - install-plugins
  - plugins
redirectFrom: []
media: {}
---

Plugins are full-access code, like npm packages. Before you install one, read the code it installs, starting from the entry files in its manifest, plus its dependencies. Or ask an agent to explain what it does.

## What full access means

Plugins aren’t sandboxed: they run with the same access as bb itself, and they don’t ask for permissions one by one. A plugin can read your files, run commands, and use the network, the way any program you install can.

## Check a plugin before you install it

1. **See who made it.** Every marketplace listing names its author and links to the plugin’s source.
2. **Ask an agent to read it.**

   > Before you install this plugin, read its code and tell me what it can access and change.

3. **Read the code yourself** if you want to: start from the entry files in its manifest, then its dependencies.

## What the marketplace checks

Plugins included with bb show **BB Official** as their author. Every other plugin shows its author’s name. For plugins from other marketplaces, bb pins the exact version or commit you confirm and refuses the install if the source changes. No plugin’s publisher is verified. Check every plugin the same way.

## If something goes wrong

Open the command palette and choose **Turn on plugin safe mode** to stop every plugin except the ones bb installs automatically. Then remove the plugin that caused the problem. See [Install a plugin](/docs/install-plugins#if-a-plugin-breaks-something).

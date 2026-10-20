---
title: Install a plugin
description: Ask an agent to install a plugin, then manage it in Settings. Turn plugins off, remove them, or stop them with safe mode.
section: extend-bb
order: 20
status: published
updated: "2026-10-20"
relatedGuides: []
relatedDocs:
  - plugins
  - plugin-trust
redirectFrom: []
media: {}
---

Find a plugin in the [marketplace](/marketplace), then ask an agent in any thread to install it.

## Ask an agent to install it

Type what you want in plain words:

> Install the Playgrounds plugin.

> Find a plugin that shows my open pull requests, and install it.

The agent finds the plugin and installs it. The install keeps going if you close the thread or the app, as long as your bb server keeps running.

Before you ask, check who made it and what it does. See [Before you install a plugin](/docs/plugin-trust).

## See and manage your plugins

Open **Settings → Installed plugins** to see each plugin with its status and an on/off switch. Open a plugin to reach its settings.

Turning a plugin off keeps it installed. You can also ask an agent:

> Turn off the Ambient plugin.

> Update my plugins.

## Remove a plugin

Ask an agent to remove it. Removing a plugin deletes its settings, secrets, and scheduled jobs. The plugin’s own stored data and logs are kept, and so are automations you set up with the Automations plugin.

## If a plugin breaks something

Open the command palette and choose **Turn on plugin safe mode**. It stops every plugin except the ones bb installs automatically, so official plugins like GitHub and Memory stop too. Safe mode stays on across restarts until you choose **Turn off plugin safe mode**, which restarts the plugins that were on before.

## Next

- [Before you install a plugin](/docs/plugin-trust)
- [Build your own plugin](/docs/build-a-plugin)

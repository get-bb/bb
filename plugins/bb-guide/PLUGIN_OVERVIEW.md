# BB guide

Control the BB introduction and bundled agent skills in Settings → Installed
plugins → BB guide. The plugin and all six settings default to enabled.

- `introduction`: send the BB CLI, thread, and link instructions.
- `skills`: make the selected bundled skills available.
- `bbCli`: include `bb-cli`.
- `pluginAuthoring`: include `bb-plugin-authoring`.
- `skillCreator`: include `skill-creator`.
- `submitPlugin`: include `submit-a-plugin`.

Use `bb plugin config bb-guide set <key> true|false` from the CLI, or
`bb.sdk.plugins.updateSettings({ pluginId: "bb-guide", values: { ... } })`
through the SDK. Changes apply when agent configuration is next assembled;
they do not erase instructions from an existing conversation.

Disabling the plugin removes its introduction and all four skills. The
settings affect this plugin's copies, not independently installed user or
provider skills. Other plugins keep their own skills. The generated
`plugin-commands` skill continues to describe enabled plugin commands.

bb's sidebar navigation, as a plugin.

## What you get

- **Rail**: icons on the sidebar's left edge for Home, Plugins, Skills, Automations, and every plugin panel, with New thread in the sidebar header. The rail stays when the sidebar collapses.
- **Top list**: the same destinations as labeled rows above the thread list, with New thread as a row and a mini-map when a panel is open in a split.
- Hidden destinations live under **More**. Right-click any destination, or use its options button in Top list, to open it in a split, view its plugin's details, hide it, or disable its plugin.
- Panel badges: counts, short text, and dots in neutral, warning, or critical tones.

## How it works

Both layouts draw bb's navigation model through the plugin SDK. Order and visibility are bb settings (`sidebar.pluginPanelOrder` and `sidebar.visiblePluginPanels`), so they carry over when you switch layouts or install another navigation plugin. **Customize navigation** opens bb's own editor. Pick a layout under Settings → Appearance → Navigation, or with `bb settings ui set sidebar.navigationProvider navigation/top-list`.

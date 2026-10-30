# Open side panel tabs

`experimental_usePanelTabs()` lists the tabs open in the side panel of the
surface the component renders in, following live changes: the same list and
order bb's tab strip shows, on the thread view, plugin pages, the New thread
screen and the Plugins browse page. It returns `{ open, selectedKey, tabs }`;
each tab is `{ key, title, status, closable, detail }`, where `detail` says
what it shows: `info`, `file` (`path`), `browser` (`url`), `terminal`
(`terminalId`), `new-tab`, `plugin` (`pluginId`, the tab's
`ExperimentalTabReference`, and action `params`), or `plugin-details`
(`pluginId`). A key identifies a tab only while it is open; do not store it.
Code that is not a component, such as a command or thread action, reads the
same list once with `ctx.experimental_panel.getTabs()`, from the focused
surface for commands.

Act on a tab with the panel controller from `experimental_useAppPanel()`:
`selectTab(key)` selects it and reveals the side panel, and `closeTab(key)`
closes it as its close button does, so closing a terminal's tab ends the
terminal. Both return false for a key that is not open, and `closeTab` for a
tab without a close button. `experimental_PanelTabIcon` draws the icon bb's
strip shows for a key.

```tsx
import {
  experimental_PanelTabIcon as PanelTabIcon,
  experimental_useAppPanel,
  experimental_usePanelTabs,
} from "@get-bb/plugin-sdk/app";

function OpenTerminals() {
  const { tabs, selectedKey } = experimental_usePanelTabs();
  const panel = experimental_useAppPanel();
  return tabs
    .filter((tab) => tab.detail.kind === "terminal")
    .map((tab) => (
      <button
        key={tab.key}
        aria-pressed={tab.key === selectedKey}
        onClick={() => panel.selectTab(tab.key)}
      >
        <PanelTabIcon tabKey={tab.key} /> {tab.title}
      </button>
    ));
}
```

In `renderSlot`, pass `experimental_panelTabs` to set what the hook returns;
`selectTab` and `closeTab` calls are logged in `experimental_panelCalls`.

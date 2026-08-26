# Nav panel menu

Living example for a plugin-owned sidebar page menu. It contributes two
host-rendered groups and a lazy **API surfaces** submenu through
`experimental_menu`.

Install it from a bb source checkout:

```sh
bb plugin install ./examples/plugins/nav-panel-menu --yes
```

Open the sidebar page's `...` menu or right-click its row. The host renders BB's
own ordering, split, and settings actions first, followed by the example's
**Navigation** and **Workspace** groups. The submenu's children are constructed
only when **API surfaces** opens.

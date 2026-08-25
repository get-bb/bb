# Replacement Lab

Install this plugin together with `replacement-lab-beta` to exercise BB's
exclusive replacement behavior. Both register a thread list, a complete
Changes view, and a Markdown file opener. Alpha also registers a sidebar
navigation replacement; Beta also registers a global diff renderer.

- Automatic mode selects Alpha first because plugin IDs are deterministic.
- Settings can pin BB, Alpha, or Beta.
- Alpha's navigation grid exercises host Search, modifier-click and
  drag-to-split bindings, plugin destinations, `experimental_Original`, and
  crash fallback while the host keeps the drawer, search field, thread list,
  footer, and shortcuts.
- **Embed BB original** exercises the instance-bound `Original` renderer.
- **Crash** exercises the owner crash fallback. Open Changes in two app panes
  to verify that a crash falls back only the pane that crashed.
- A file or commit opened through BB's fixed Changes route appears as the
  pane-local target. **Clear target** acknowledges it.
- Embed BB's Changes view while Beta's global diff renderer is active to verify
  that the renderer still applies to the native virtualized body.
- Disabling Alpha while Automatic is selected reveals Beta.

The fixtures are intentionally diagnostic rather than useful thread lists or
file viewers.

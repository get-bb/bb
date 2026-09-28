# Storage & retention

A bundled, default-disabled plugin. Enable the `storage-retention` plugin. Open Storage & retention in the sidebar.
Both retention policies default to Never. The plugin owns policy, previews,
hourly scheduling, run summaries, UI, and CLI commands. It uses public SDK thread
rows to reconstruct archive/delete relationships and ordinary lifecycle actions.
The plugin also owns disk measurement in its host worker, scan caching in its own
SQLite database, report assembly, orphan classification, and file deletion.
Core supplies ordinary thread lifecycle actions, machine storage paths, and
environment cleanup retry. The existing core idle orphan sweep is unchanged.
Disabling the plugin stops retention; it does not stop core orphan maintenance.

Cached reports are snapshots; rescan to see external filesystem changes. Plugin
maintenance is serialized per machine; concurrent core cleanup tolerates missing
entries. No core storage tables, scan routes, or daemon commands are added.

The first version pages all nondeleted threads before acting. It intentionally
accepts changes between reading eligibility and applying an action. The UI and
CLI previews count current candidates, not guaranteed future outcomes.

## TODO

Define cross-plugin thread protection. Automation targets receive no special
exemption yet; pin threads that must be kept. No retention-hold API or Automations
integration ships with this plugin.

Consider general timestamp and lifecycle-owner filters if full enumeration
becomes expensive. No retention-specific query or mutation API is required.

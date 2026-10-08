# Storage & retention

A bundled, default-disabled plugin. Enable the `bb--storage-retention` plugin. Open Storage & retention in the sidebar.
Both retention policies default to Never. The plugin owns policy, previews,
hourly scheduling, run summaries, UI, and CLI commands. It uses public SDK thread
rows to reconstruct archive/delete relationships and ordinary lifecycle actions.
The plugin also owns disk measurement in its host worker, scan caching in its own
SQLite database, report assembly, orphan classification, and file deletion.
Core supplies ordinary thread lifecycle actions, machine storage paths, and
environment cleanup retry. The existing core idle orphan sweep is unchanged.
Disabling the plugin stops retention; it does not stop core orphan maintenance.

The machine page offers Clear archived files for whole storage folders, including
small files, from archived, stopped, unpinned threads in the scan. Bulk clearing
keeps conversations and uploaded attachments and requires confirmation. The
matching CLI command is `bb storage clear-archived-files --machine HOST_ID --yes`.

The Clean up section offers Remove instances for `~/.bb-dev` entries whose
source checkout no longer exists. The host re-verifies each checkout is missing,
stops processes whose working directory is inside it, then removes the entry. The
matching CLI command is `bb storage remove-dev-instances --machine HOST_ID --yes`.
Every development row's trash button removes that single entry immediately
(`--instance NAME`), like the thread rows' trash button clears a thread's files.
If the instance's dev server is running (fresh daemon lock), the row asks
"Stop and remove?" first; confirming stops that instance's launcher and
removes it. The CLI's `--yes` covers that confirmation.

Large-file cleanup from the page starts a background job so slow folder walks
can finish after the remote HTTP request returns. Each machine reports running,
completed, or failed status, including after navigation or reconnection. The
`startClearLargeFiles({hostId})` RPC starts the job; pass null for all scanned
online machines. `bb storage usage` exposes `largeFileCleanup` status. The
`clearLargeFiles` RPC and `bb storage clear-large-files` continue to wait for
completion and return deleted file/byte totals.

Cached reports are snapshots; rescan to see external filesystem changes. Plugin
scans and bulk cleanup run exclusively per machine. Different stopped threads
can clear concurrently, while duplicate clears for one thread are rejected.
The UI starts a clear immediately, shows row progress and error toasts,
and keeps other thread actions available. Settings save immediately without
success toasts; failed saves restore the previous value. Concurrent core cleanup tolerates
missing entries. Disk measurement and deletion remain in the plugin host worker. Core emits an environment-removal notification; storage scans and cleanup stay
in the plugin.

The first version pages all nondeleted threads before acting. It intentionally
accepts changes between reading eligibility and applying an action. CLI previews count current candidates, not guaranteed future outcomes.

Two additional cleanup policies default to off. `deleteStorageOnArchive`
queues future archives, waits for the 30-second undo grace, and retries after
reload, thread stop, or host reconnection. Unarchiving cancels cleanup; pinned
threads are skipped. `deleteDevDataOnCheckoutRemoval` scans and removes development
folders whose checkout is missing, including existing folders, while keeping
existing and unidentified sources. Both are available through `bb storage retention`.

Development cleanup reconciles filesystem state on plugin startup, machine
reconnect, and hourly. `experimental_environment.removed` re-measures only the
removing machine's `~/.bb-dev`, queued behind any scan or cleanup already
running there; missed events need no replay or removal-history tables.
Offline/busy machines and failed cleanup retry on subsequent scans. Provider
removal success does not prove the path was deleted; the host always checks
actual filesystem state.

Orphan, development, worktree, and archived-file bulk cleanup can also run as
background jobs. `startCleanup` and `startClearArchivedFiles` start them; `host`
and `hosts` report progress. The CLI offers `bb storage cleanup` for maintenance
jobs and keeps synchronous cleanup commands for callers that need final totals.

## TODO

Define cross-plugin thread protection. Automation targets receive no special
exemption yet; pin threads that must be kept. No retention-hold API or Automations
integration ships with this plugin.

Consider general timestamp and lifecycle-owner filters if full enumeration
becomes expensive. No retention-specific query or mutation API is required.

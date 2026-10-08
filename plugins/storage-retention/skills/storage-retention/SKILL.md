---
name: storage-retention
description: Inspect machine storage, clean up files, and configure automatic thread archive or deletion.
---

# Storage & retention

Enable `bb plugin enable storage-retention`. Both policies default to Never.
Open the plugin's sidebar panel for machine reports and retention settings.
All settings in the panel save immediately when changed.
All commands return JSON. Use the owning server's normal SDK/plugin RPC transport.

```sh
bb storage retention
bb storage retention --archive-after 30 --delete-after 90
bb storage retention --archive-after 30 --delete-after 90 --save --yes
bb storage retention --archive-after never --delete-after never --save --yes
bb storage retention --delete-storage-on-archive true --save --yes
bb storage retention --delete-storage-on-archive false --save --yes
bb storage retention --delete-dev-data-on-checkout-removal true --save --yes
bb storage usage
bb storage usage --rescan
bb storage usage --machine HOST_ID --rescan
bb storage usage --machine HOST_ID
bb storage remove-orphans --machine HOST_ID --yes
bb storage clear-large-files --yes
bb storage clear-large-files --machine HOST_ID --yes
bb storage retry-worktree-cleanup --machine HOST_ID
bb storage clear-thread --thread THREAD_ID --yes
bb storage clear-archived-files --machine HOST_ID --yes
bb storage remove-dev-instances --machine HOST_ID --yes
bb storage remove-dev-instances --machine HOST_ID --instance NAME --yes
```

Without `--save`, retention thresholds only preview affected thread counts.
Days must be whole numbers from 1 to 3650, or `never`. Unspecified settings
preserve their saved values. Saved policies apply across all projects. The
hourly run processes up to 50 trees per action and skips groups with pinned
members. Archiving can remove worktrees including uncommitted changes. Deleting
removes history and thread storage. Preview first and save only when authorized.

Delete thread storage on archive defaults to off. Set `--delete-storage-on-archive`
to `true` or `false`, or use the switch in the retention panel, which saves immediately.
It applies to future manual and automatic archives, including each cascaded child,
while the plugin is enabled; it does not clear previously archived threads.
Conversations and uploaded attachments are kept. Pinned threads are skipped.
Cleanup waits for stopped threads and online persistent machines. Pending cleanup
survives reloads and retries every minute; unarchiving or deleting cancels it, and
turning the setting off discards pending work on the next cleanup pass. Failures
are logged and retried. Threads without an environment need a completed scan to
identify their storage machine, just like clear-thread.

Delete development data when its checkout is removed defaults to off and is
independent of archive cleanup. Set `--delete-dev-data-on-checkout-removal` to
`true` or `false`, or use its switch in the retention panel, which saves immediately. When enabled, the
plugin scans online persistent machines hourly and removes missing-checkout
`~/.bb-dev` entries after successful scans, including manual scans. Existing
missing-checkout data is eligible too; retention previews count threads, not
these folders. The host rechecks checkout absence before removal, stops servers
working inside missing checkouts, and preserves entries whose source exists or
cannot be identified. An environment-removal event re-measures only that machine's `~/.bb-dev`, after any running scan or cleanup there finishes. Startup,
machine reconnect, and hourly scans recover missed events from filesystem state.
Offline/busy machines and failed cleanup retry on later
hourly scans. Disabling the setting prevents cleanup after subsequent scans.

Scans run in the background; rerun usage to read completion, progress, or failure.
`--rescan` without `--machine` scans every online machine that is not already busy.
A completed report includes `disk` (total and free bytes of the volume holding thread storage).
Reports include `projectWorktrees`: counts of distinct managed worktree paths per project on the selected machine, including zero-count projects with a local source there; destroyed and removed environments are excluded, and `cleanupPendingCount` is a subset of the worktree count. Counts reflect current environment records, not filesystem measurements.
Scans also measure `~/.bb-dev` on that machine. `developerStorage` is null when absent; otherwise it contains the path, total allocated bytes, and immediate folder/file sizes. Each entry includes `sourcePath`, `sourcePathState` (exists, missing, or unknown), and `threads` linked through host environment paths or a managed checkout’s thread ID. Matches cover threads known to this BB instance, including archived and hidden threads. Sources are recovered from saved launch metadata or hash-verified known/conventional checkout paths; unresolved sources remain null. Missing checkouts are cleanup candidates, not proof their development data is disposable. The UI offers missing-checkout, other-instance and unidentified-source filters. The developer section initially shows the five largest entries, grouped into linked threads, other development instances and unidentified sources, each group with its own Show N more control inside the card. Paths are hidden from rows and available through the three-dot menu’s Copy source checkout path and Copy dev data path actions. When `developerStorage` is present, the machine list totals thread and development storage with a per-kind split, and the machine page's first card adds a BB development row (instance count and size) to its category table under one total; the entry list stays in its own section.
Remove-dev-instances (page: Remove instances in the Clean up section) removes `~/.bb-dev` entries the last scan marked missing. `--instance NAME` (page: the trash button on any development row, which removes immediately; different rows can run at once) removes only that entry, whatever its checkout state, and fails if the last scan did not list it. An entry counts as running when its daemon lock (`daemon.lock.lock`) was refreshed in the last 15 seconds; scans report this as `running`. RPC `removeDevInstances({hostId, names, stopRunning})` with `stopRunning: false` leaves a running entry whose checkout still exists in place and lists it in `running` (the page then asks "Stop and remove?"); with `stopRunning: true`, as the CLI does, it sends SIGTERM to the launcher PID recorded in that instance's `bb-app-runtime.json` (SIGKILL after 15 seconds) and removes it. Processes in an existing checkout are otherwise left alone. The machine re-checks each source at removal time and skips entries whose checkout exists again or cannot be resolved. Before removal it stops every process whose working directory is inside a removed checkout (SIGTERM, then SIGKILL after 2 seconds), because servers keep running after their checkout is deleted. Process stopping is not available on Windows. A symlinked `~/.bb-dev` entry is removed as a link; the folder it points to is kept. It returns `removedCount`, `removedBytes`, `skippedCount` and `stoppedProcessCount`, and also deletes leftover `.bb-trash-*` folders in `~/.bb-dev`.
The largest-thread list initially shows five rows; Show N more reveals the remaining ranked threads in the report (up to 20), and Show fewer collapses it.
Reads never start scans. Remove-orphans requires a completed scan and only removes
storage the plugin identifies as orphaned from current SDK thread rows. Clear-large-files deletes
individual files of 10 MB or more from the thread storage of archived threads found in the last scan,
keeping smaller files and skipping pinned and running threads; reports show the matching totals as
`archivedLargeFiles`. Without `--machine` it covers every online machine with a completed scan.
The page uses `startClearLargeFiles({hostId})` to start background cleanup and
returns immediately; pass null for all scanned online machines. Read
`largeFileCleanup` in usage/host reports for running, completed (file and byte
totals), or failed status. The synchronous CLI command and `clearLargeFiles` RPC
still wait for completion. Duplicate bulk jobs and overlapping scans are rejected.
Conversation history is never affected. The Storage page suggests it once archived threads hold 1 GB
or more of large files.
Clear-archived-files removes whole storage folders, including small files, from archived, stopped, unpinned threads found in the last scan on the selected machine. Conversations and uploaded attachments are kept.
The page starts this with `startClearArchivedFiles({hostId})`, which returns immediately. Read `archivedFileCleanup` in usage/host reports for running, completed, or failed status with cleared thread and byte totals. Progress is reported after each batch; failed jobs can be retried for the remaining files. The CLI and `clearArchivedFiles` RPC still wait for completion. Cleanup is exclusive per machine; opening a confirmation does not block other actions.
Clear-thread, clear-archived-files and remove-orphans first stop processes whose working directory is inside each removed thread folder, matching worktree removal, so dev servers started there don't outlive their files.
Clear-thread requires a stopped thread and an online machine. When the thread no longer has an environment, a completed scan must identify its storage on exactly one machine. Different threads can clear concurrently; duplicate clears for one thread are rejected. Scans and bulk cleanup remain exclusive per machine. Reports are cached
snapshots; rescan to see external filesystem changes.

Plugin RPC methods: `state(null)`, `preview({archiveAfterDays, deleteAfterDays, deleteStorageOnArchive, deleteDevDataOnCheckoutRemoval})`,
and `configure({archiveAfterDays, deleteAfterDays, deleteStorageOnArchive, deleteDevDataOnCheckoutRemoval})`; use null for Never and booleans for storage cleanup (both default to false for older policies). Storage
RPC methods are `hosts(null)`, `host({hostId})`, `scanHost({hostId})`,
`removeOrphans({hostId})`, `retryWorktreeCleanup({hostId})`, and
`clearThread({threadId})`, `clearArchivedFiles({hostId})` and `removeDevInstances({hostId, names: null})` for every missing instance or `removeDevInstances({hostId, names, stopRunning})` for chosen ones. The plugin owns its host worker and scan database.

Cross-plugin protection is deferred. Pin automation target threads to keep them.
Disabling the plugin stops scheduled retention and removes its storage actions. Core's idle orphan sweep remains independent.

The page uses app toasts for setting saves, cleanup results, and action failures. Running scans and cleanup progress stay beside their controls. Completed cleanup messages are not retained inline or replayed on page open. Initial loading failures retain an inline retry action. Settings and unrelated machines remain usable during cleanup; report refreshes do not extend action locks.

`bb storage cleanup --machine HOST_ID --kind orphans|development|worktrees --yes` starts a background job and returns immediately. RPC: `startCleanup({hostId, kind})`. Read `maintenance` in usage/host reports for running, completed or failed status. Retry failures with the same command; remaining candidates are re-read. The page uses this for bulk orphan removal, missing-checkout development data and worktree retries. Existing synchronous commands remain available.

Automatic archive cleanup and archived-file bulk eligibility respect the core 30-second undo grace, using the shared core grace constant. Undo/rearchive, pins and live status are rechecked before cleanup; bulk jobs re-read eligibility before each batch. Grace expiry is a time boundary, not an indication that environment teardown completed.

Action toasts appear immediately when work is requested. They use a short action title and a subtitle identifying the machine, thread, setting, or development-data folder. The same toast updates with completion or failure; identifiers and byte totals belong in the subtitle. Development-data deletion reads “Deleting development data” followed by “Development data deleted” when finished.

Background maintenance reports preserve `kind` in running, completed, and failed states so action-specific notification titles do not depend on observing the running update.

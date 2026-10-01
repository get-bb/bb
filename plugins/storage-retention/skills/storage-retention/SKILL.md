---
name: storage-retention
description: Inspect machine storage, clean up files, and configure automatic thread archive or deletion.
---

# Storage & retention

Enable `bb plugin enable storage-retention`. Both policies default to Never.
Open the plugin's sidebar panel for machine reports and retention settings.
All commands return JSON. Use the owning server's normal SDK/plugin RPC transport.

```sh
bb storage retention
bb storage retention --archive-after 30 --delete-after 90
bb storage retention --archive-after 30 --delete-after 90 --save --yes
bb storage retention --archive-after never --delete-after never --save --yes
bb storage usage
bb storage usage --rescan
bb storage usage --machine HOST_ID --rescan
bb storage usage --machine HOST_ID
bb storage remove-orphans --machine HOST_ID --yes
bb storage clear-archived --yes
bb storage clear-archived --machine HOST_ID --yes
bb storage retry-worktree-cleanup --machine HOST_ID
bb storage clear-thread --thread THREAD_ID --yes
```

Without `--save`, retention thresholds only preview affected thread counts.
Days must be whole numbers from 1 to 3650, or `never`. Unspecified thresholds
preserve their saved values. Saved policies apply across all projects. The
hourly run processes up to 50 trees per action and skips groups with pinned
members. Archiving can remove worktrees including uncommitted changes. Deleting
removes history and thread storage. Preview first and save only when authorized.

Scans run in the background; rerun usage to read completion, progress, or failure.
`--rescan` without `--machine` scans every online machine that is not already busy.
A completed report includes `disk` (total and free bytes of the volume holding thread storage).
Reads never start scans. Remove-orphans requires a completed scan and only removes
storage the plugin identifies as orphaned from current SDK thread rows. Clear-archived empties
the storage of archived threads holding 100 MB or more in the last scan, skipping pinned and running
threads; reports show the matching total as `clearableArchived`. Without
`--machine` it covers every online machine with a completed scan. Conversations stay in the archive.
Clear-thread requires a stopped thread and an online machine. The plugin serializes its scans and cleanup per machine. Reports are cached
snapshots; rescan to see external filesystem changes.

Plugin RPC methods: `state(null)`, `preview({archiveAfterDays, deleteAfterDays})`,
and `configure({archiveAfterDays, deleteAfterDays})`; use null for Never. Storage
RPC methods are `hosts(null)`, `host({hostId})`, `scanHost({hostId})`,
`removeOrphans({hostId})`, `retryWorktreeCleanup({hostId})`, and
`clearThread({threadId})`. The plugin owns its host worker and scan database.

Cross-plugin protection is deferred. Pin automation target threads to keep them.
Disabling the plugin stops scheduled retention and removes its storage actions. Core's idle orphan sweep remains independent.

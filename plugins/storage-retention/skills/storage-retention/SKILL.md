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
bb storage clear-large-files --yes
bb storage clear-large-files --machine HOST_ID --yes
bb storage retry-worktree-cleanup --machine HOST_ID
bb storage clear-thread --thread THREAD_ID --yes
bb storage clear-archived-files --machine HOST_ID --yes
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
Clear-thread requires a stopped thread and an online machine. When the thread no longer has an environment, a completed scan must identify its storage on exactly one machine. Different threads can clear concurrently; duplicate clears for one thread are rejected. Scans and bulk cleanup remain exclusive per machine. Reports are cached
snapshots; rescan to see external filesystem changes.

Plugin RPC methods: `state(null)`, `preview({archiveAfterDays, deleteAfterDays})`,
and `configure({archiveAfterDays, deleteAfterDays})`; use null for Never. Storage
RPC methods are `hosts(null)`, `host({hostId})`, `scanHost({hostId})`,
`removeOrphans({hostId})`, `retryWorktreeCleanup({hostId})`, and
`clearThread({threadId})` and `clearArchivedFiles({hostId})`. The plugin owns its host worker and scan database.

Cross-plugin protection is deferred. Pin automation target threads to keep them.
Disabling the plugin stops scheduled retention and removes its storage actions. Core's idle orphan sweep remains independent.

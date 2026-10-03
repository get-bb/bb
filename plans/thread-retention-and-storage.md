# Storage & retention plugin

Implementation lives in `plugins/storage-retention` (plugin id
`bb--storage-retention`). The plugin owns retention
policy and eligibility, hourly scheduling, previews and run history, disk
measurement, host-worker file operations, scan caching, report assembly, UI,
and the `bb storage` CLI. It uses public SDK thread rows and ordinary lifecycle
actions. No core storage tables, migrations, scan routes, retention services,
daemon commands, or new daemon protocol fields remain.

Core APIs landed separately; this branch adds plugin registration and consumes:

- `hosts.get` / `bb machine show`: read the thread-storage root
  from the latest daemon session, including offline machines without live threads.
  The path is null until a session reports it.
- `environments.experimental_cleanup` / `bb environment cleanup`:
  request provider cleanup explicitly, overriding retention and backoff, rejecting
  live environments and unmanaged checkouts, and retaining the
  existing lifecycle machinery for hooks, ownership, retries, and completion.

Both policies default to Never. Enable the plugin to use it. Cross-plugin protection remains a TODO; pin automation targets to keep
those groups. Eligibility races are accepted. Reports are cached snapshots;
external filesystem changes appear after a rescan. The landed #4328 core idle
orphan sweep is unchanged and does not depend on this plugin.

## Storage page and large-file rule (2026-10-01)

- Page: one header (the panel title), machine rows matching Settings →
  Machines (status, server pill, scanned active/archived counts, disk free),
  Scan all and per-machine scans, preset retention selects, a pinned-threads
  banner, compact largest-thread rows with archived/running pills, and a
  delayed skeleton with data loaded once per panel.
- Suggestions, rule 1: files of 10 MB or more (`LARGE_FILE_MIN_BYTES`) in
  archived, unpinned, stopped threads. The page nudges once they total 1 GB
  (`LARGE_FILE_NUDGE_MIN_BYTES`); deleting them keeps smaller files and every
  conversation. `bb storage clear-large-files` is the CLI form. Thread counts
  come from the scan because most archived threads no longer reference an
  environment.
- One disk pass: the scan runs `du -a` and streams it, recording large files
  while summing directories; the walker fallback does the same. On a 5.5M-file
  thread-storage root a scan takes about 114 s, the same as the previous `du -s`
  pass.
- Verification: plugin 43 tests, server 3,223, Plugin Guide 75, templates 47;
  typecheck and lint for every package depending on a changed one. Live checks
  on the owner's server covered real scans of two machines and both
  confirmations, cancelled without deleting.

## Experiment removal verification (2026-09-28)

The plugin is the only enablement control. Removed the experiment definition,
settings UI, runtime gates, state flag, and related documentation. Plugin tests
(38) and settings tests (4) pass; plugin/app/server typechecks pass. Live QA
confirmed the experiment is absent, policy previews and scans work, and plugin
disable/re-enable controls command availability while preserving Never defaults.

## Verification before experiment removal (2026-09-28)

- Plugin: 38 tests pass, including real host-entry filesystem scans, orphan
  removal, stopped-thread clearing, busy/failure recovery, symlink/traversal
  rejection, retention pagination, batch limits, and disable/dispose behavior.
- Server: 92 tests pass for host management, environment orchestration, and
  #4328 orphan cleanup. New coverage exercises SDK paths with no live threads,
  offline sessions, explicit failed-cleanup retry, and live-thread rejection.
- SDK public contracts: 8 tests pass. App experiment: 4 tests pass. DB experiment
  defaults: 1 test passes. Turbo typechecks pass for server, app, CLI, SDK,
  plugin, and Plugin Guide. Plugin lint has one existing async-effect compiler
  warning and no errors.
- Builtin plugin loading/registry: 30 tests pass. Plugin Guide: 27 tests pass;
  first-party manifest consistency: 1 test passes. Total focused tests: 201.
- Production app/server/daemon/CLI and bundled-plugin builds pass.
- Fresh isolated instance: actual host worker measured a 32 KB orphan fixture;
  UI confirmation removed it and updated cached reports. A 16 KB stopped-thread
  fixture appeared in largest threads and CLI clearing recreated an empty
  directory. Reads did not scan. Reports and policy survived plugin disable /
  re-enable. UI preview did not save; Save policy persisted 30/90 thresholds.
  Disabling the experiment blocked scans and displayed the enablement message.
  Restored Never policies, disabled the plugin and experiment, stopped the
  browser and dev processes, and removed the marked data and owned QA checkout.
- The unchanged inline confirmation layout was also verified on iOS Simulator
  Safari in the earlier extraction pass. This pass verified desktop interactions.
- Verification inventory remains blocked by the pre-existing unmapped `browser`
  CLI family. Its baseline was not rewritten; the affected settings recipe is
  updated.

Evidence logs: `/tmp/storage-full-*.log`. Live screenshots, configuration, and
observations are retained under
`/var/folders/lr/f3ynv4xj6p77kvx_rz7zgzg00000gn/T/bb-storage-full-evidence-kd1zu99u`.

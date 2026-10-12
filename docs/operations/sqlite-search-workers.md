# SQLite search worker investigation

This change targets gorag's synchronous SQLite search stalls. It does not deploy code or change the running service.

## Verified environment

The installed bb-app version was 0.42.1. Node was v24.13.0, and better-sqlite3 was 12.10.0.
The source baseline was `59a03819a`, on `fix/tasks-markdown-table-rendering` in `/home/jsl/bb-meta/bb`.
The implementation uses a separate clone and branch, `fix/sqlite-search-worker`, in `/tmp/bb-search-isolation`.

The source checkout contained existing declaration-build edits. An hourly automation also applied those edits to this clone.
The automation log records that action at 2026-10-12 01:26:37 UTC.
Those files remain intact and are excluded from this change's commit.

The active user service was `bb-jsl.service`. Its limits were MemoryHigh=14 GiB and MemoryMax=16 GiB.
Its initial usage was approximately 13.8 GiB. The host reported about 38 GiB available RAM, with full swap.
Disk usage reached 93%, above the historical 84–86% readings.
The service's memory pressure later reached approximately 33% full pressure over 60 seconds.
These are point measurements, not a production latency distribution.

A later host inspection measured server RSS at 1,670,044 KiB and daemon RSS at 213,600 KiB.
Those measurements exclude most agent and build memory included in the shared cgroup.

Read-only metadata inspection found WAL mode, incremental auto-vacuum, 312,749 pages, and zero freelist pages.
No reproduction ran against the live search index.

## Root cause

The installed server invokes better-sqlite3 and synchronous Drizzle operations on its main Node event loop.
The October 12 log records a 102,177.1 ms `all` operation in the multi-token thread search query.
The query performs a separate FTS pass for each token. It groups token matches, ranks threads, and ranks matching segments.
Its original segment ranking also carries full message text through temporary window tables.
Common tokens expand the number of matches before the limit applies.

The main event loop cannot process timers or WebSocket heartbeat acknowledgements during that synchronous call.
This mechanism explains the observed heartbeat interruption and Connect reconnection around the query.
The same logs contain unrelated event reads lasting 11,415.3–66,122.8 ms.
Memory reclaim and disk pressure amplify SQL latency. SQL instrumentation does not identify their exact contribution to the 102-second query.

The initial disposable corpus contained 300 threads and 60,000 segments.
The original three-token query took 450.95 ms on that corpus.
Its plan used FTS scans, temporary grouping tables, a DISTINCT count table, and temporary ordering tables.
This reproduced the query structure, not the full production stall.

## Implementation

The existing search route now awaits a typed worker service. The existing SDK and search UI use that route.
The UI already passes TanStack Query's AbortSignal through `sdk.threads.search`.
Connect forwards cancellation to its origin HTTP request. The Node HTTP adapter propagates disconnects to the request signal.

One dedicated reader owns its own read-only SQLite connection. It serves search and conversation outline requests.
The reader does not run migrations, change the journal, or configure auto-vacuum.
It enables query-only mode, uses a 32 MiB page cache, disables mmap, and waits at most 100 ms for locks.

A single WAL transaction covers search matching, totals, snippets, thread hydration, and activity metadata.
Outline reads and projection use the same worker isolation. Outline cache entries use the worker's snapshot key.

The query now sorts segment identifiers before loading retained message text.
It materializes token matches and limited threads. Each token contributes one grouped row per thread, so COUNT(*) replaces COUNT(DISTINCT tokenIndex).
The change preserves cross-segment matching, visibility, deletion, groups, scores, ordering, totals, highlights, snippets, and limits.
The reference-query test compares complete raw rows across common tokens, prefixes, hidden threads, deleted threads, archives, and large messages.

The reader allows one active or starting request and eight waiting requests.
Waiting requests expire after 10 seconds. SQL execution expires after three seconds. Startup expires after 10 seconds.
Cancellation removes queued requests or retires the active reader. Replacement waits until the old connection exits.
Startup errors, worker errors, exits, invalid messages, and shutdown reject pending requests.

A separate maintenance worker truncates completed outputs. It uses an existing writable connection with a 10 ms lock timeout.
Its transaction keeps output changes and scan cursors atomic. Its execution deadline is 100 ms.
The next sweep retries an interrupted batch. This worker emits no database notifications, so it does not reorder notification delivery.

## Actual interruption and safe termination

A probe showed that Worker.terminate alone waited 7,223 ms for synchronous SQLite to return.
The installed SQLite build defines SQLITE_OMIT_PROGRESS_CALLBACK. A progress-handler extension cannot work with that build.

The final native extension owns a connection-local watchdog thread. It invokes SQLite's supported sqlite3_interrupt API at the deadline.
The watchdog joins before the connection closes. It never receives the main server's database connection.
A 30 ms disposable probe returned SQLITE_INTERRUPT in approximately 28 ms and closed normally.

Cancellation testing also exposed a better-sqlite3 failure during V8 termination and native error creation.
The shared cancellation barrier prevents termination while a native SQLite entry runs.
The parent atomically claims an idle state before termination. The worker then refuses subsequent native entries.
All prepare, statement, exec, pragma, extension-load, connection-open, and connection-close operations used by the worker obey that barrier.
Explicit BEGIN, COMMIT, and ROLLBACK statements also obey it. The library's private transaction wrapper bypasses public statement wrappers.
Each native entry also checks the request deadline. This prevents a late commit after JavaScript processing exceeds the budget.

Removing the barrier caused a disposable child to abort with SIGABRT. The regression test runs that probe in an independent process.
This prevents a native abort from producing a misleading Vitest result.

SQLite interruption occurs at SQLite's earliest opportunity. It cannot preempt an uninterruptible kernel I/O operation.
The host's remaining memory and I/O pressure therefore still matters.
See [SQLite's interrupt contract](https://www.sqlite.org/c3ref/interrupt.html) and [WAL reader/checkpoint behavior](https://sqlite.org/wal.html).

## Observability

The worker logs operation, request ID, generation, outcome, queue depth, queue wait, and total transport time.
It separates native SQLite time, JavaScript result processing, JSON serialization, response bytes, and delivery time.
Native timing includes prepare, execution, row transfer, and transaction statements.
Unavailable phase timings remain null for canceled or interrupted deliveries.

The API logs main-thread result decoding, serialization, and complete route time with the same request ID.
Errors contain public codes rather than SQLite error text or invalid result content.
These logs omit search text, bindings, credentials, and thread content.

Worker outcome logs include the last event-loop delay sample and the age of the last daemon acknowledgement enqueue.
An acknowledgement enqueue does not prove that the daemon received it.
The delay sample represents the monitor's latest five-second window. It does not measure the current request alone.
Connect logs heartbeat acknowledgement age and timer delay every 20 seconds.
Log timestamps correlate those records with worker outcomes and existing stall logs.

## Validation and benchmark

The final focused run passed 162 tests: 103 server tests, 47 database tests, and 12 tunnel-client tests.
The focused server, database, and tunnel-client typechecks passed. The server build and native extension build passed.
The server run includes existing thread-data API tests, outline caching, real HTTP disconnects, unrelated API responsiveness, and heartbeat timers.
Worker tests cover bounded queues, cancellation, replacement, startup failure, shutdown, concurrent writes, snapshots, lock contention, and WAL release.
The maintenance regression interrupts a real SQLite trigger. It verifies unchanged outputs and scan cursors, then verifies a successful retry.

The earlier HTTP 503 had a driver-wrapper cause. Passing undefined to raw() differs from calling raw() without arguments.
The corrected statement wrappers preserve omitted arguments. The ordinary search correctness test now returns HTTP 200.
The HTTP fixture waits for the listening event before reading its address. Its cleanup handles the declared server types.
Harness cleanup closes the current dependency instances, including replacement workers.
The cold search fixture allows 15 seconds for setup and startup. The production SQL execution deadline remains three seconds.

The completed benchmark produced these origin-only results:

| Metric             | Original main-loop search | Dedicated reader |
| ------------------ | ------------------------: | ---------------: |
| Search p95         |                  605.6 ms |         516.4 ms |
| Search p99         |                  692.2 ms |        1227.9 ms |
| Unrelated API p95  |                  605.6 ms |           4.0 ms |
| Unrelated API p99  |                  691.9 ms |           8.9 ms |
| Event-loop p99     |                  696.3 ms |          13.2 ms |
| Event-loop maximum |                 1073.2 ms |          57.1 ms |
| Heartbeat gap p99  |                  695.8 ms |          13.2 ms |
| Timeouts           |                    0/1000 |           0/1000 |

Each search and unrelated API column contains 1,000 samples.
The baseline recorded 1,004 heartbeat gaps. The worker recorded 40,882 gaps.
Worker startup plus its first search took 949.7 ms in one sample.
This was a new connection with an already warm OS cache, not a cold-storage measurement.

Search p95 improved, while search p99 worsened. The host remained subject to other workloads, and the reader used a smaller cache.
This benchmark cannot assign the tail regression to either factor. It establishes the event-loop isolation benefit under this workload.
The worker's SQL, result-processing, serialization, and queue p95 values were 431.5, 81.7, 0.60, and 0.07 ms.
Those phase measurements used statement execution timing. The final instrumentation also includes prepare and transaction statements.
The benchmark precedes the final wrapper, listener, and deadline-entry corrections. It measures the same optimized query and worker isolation strategy.
The baseline did not collect separate phase measurements. Its zero-count phase fields are unavailable measurements, not zero latency.

The benchmark runs 1,000 requests per variant through a disposable loopback HTTP listener.
Its workload uses four common tokens across separate segments, 300 threads, and 60,000 messages with 4,096 padding characters.
It sends one unrelated health request beside every search and samples a 10 ms heartbeat timer.

Each variant receives 20 warmups. The host's OS cache is warm and is not purged.
The first worker request separately measures startup plus the initial search.
The benchmark includes all measured responses and timeout outcomes.
It reports sample counts, p50/p95/p99, maximum latency, event-loop delay, heartbeat gaps, and timeout rates.

The baseline uses the original source helper and response hydration. A three-second native guard bounds the disposable baseline reproduction.
The worker variant uses the optimized query and actual packaged worker.
The baseline retains its 256 MiB cache and 1 GiB mmap ceiling. The reader uses its proposed 32 MiB cache and no mmap.
These settings model the proposed operational change rather than a cache-controlled query-only comparison.
The measurements are origin-only. They do not measure production p99 or round-trip Connect latency.
The earlier 20–30 sample healthy windows also do not establish production p99.

Reproduce after a normal server build:

```sh
pnpm exec turbo run build --filter=@bb/server --concurrency=2
node --conditions=source --import tsx scripts/bench/thread-search-responsiveness.mts 1000 59a03819a
```

The script creates and removes its own database. It temporarily imports the specified baseline source and removes that module afterwards.
It does not accept a live database path.

## Remaining synchronous hotspots

Thread lists still perform synchronous activity and session metadata queries on the main connection.
General timeline reads and event projection paths also remain synchronous.
Destroyed-environment deletion still performs one synchronous foreign-key cascade per event-loop turn.
Closed-session pruning, legacy table cleanup, incremental vacuum, and full vacuum remain synchronous.

The current live database uses incremental vacuum and had no freelist pages at inspection.
The full vacuum path therefore was not selected by that observed state.
A large future cascade, vacuum pass, write, or lock wait can still delay the main event loop.
This change isolates the measured search and outline paths and the completed-output retention batch.
It does not convert every database operation to asynchronous execution.

## Resource isolation proposal

Create sibling user services for the server and local host daemon.
Use the existing bb-server and bb-host-daemon entry points. Preserve the current data directory and daemon identity.
Agent, watcher, and workspace subprocesses will inherit the daemon's workload slice.
Server-owned builds also need an explicit build scope. Moving only the daemon does not isolate those builds.

| Slice                          | Proposed MemoryHigh | Proposed MemoryMax | CPUWeight | IOWeight |
| ------------------------------ | ------------------- | ------------------ | --------- | -------- |
| bb-server.slice                | 4 GiB               | 6 GiB              | 1000      | 1000     |
| bb-workload.slice              | 8 GiB               | 10 GiB             | 100       | 100      |
| bb-build.slice, below workload | 2 GiB               | 3 GiB              | 50        | 10       |

The two parent hard limits total 16 GiB. The child build budget counts inside the workload budget.
MemoryLow=2 GiB on the server slice can protect its observed resident memory.
IOWeight is relative protection, not a bandwidth cap. Its effect depends on the block scheduler.
An initial workload proposal caps database-device reads at 80 MiB/s and writes at 20 MiB/s.
Measure device throughput before setting IOReadBandwidthMax and IOWriteBandwidthMax on that device.
These are proposed settings, not applied production limits.
Trial these budgets with representative workloads before applying them. Admission limits must keep workload memory within its new budget.

The declaration-build automation already provides a separate bb-dts.slice, a shared build lock, and one worker by default.
Its current run reported isolation=active and workers=1. Preserve that work and reconcile it separately from this commit.
Turbo concurrency two does not limit TypeScript programs created inside a build script.
Normal cache use avoids unnecessary rebuilds. This implementation did not invoke --force.

Validation used temporary scopes outside bb-jsl.service. Their later budgets were 6 GiB/8 GiB with two CPU equivalents.
An initial 2 GiB validation budget caused reclaim pressure, so only that temporary budget changed.
Production limits remained 14 GiB/16 GiB.

## Deployment requirements

Review and merge the implementation before deployment. Build the native extension for gorag's OS and architecture.
A C compiler and better-sqlite3's packaged SQLite headers are build requirements. The extension uses SQLite's extension API rather than system SQLite.
The server bundle includes the worker entry and extension. The native compile task bypasses caching because native artifacts depend on the build host.
Linux x64 was tested. macOS compilation and cross-platform release artifacts were not tested in this investigation.
A general release must provide matching native artifacts for each supported target and avoid cross-platform artifact cache reuse.

The installed server must restart to load the worker route and new observability.
No daemon protocol or API payload changed. This implementation does not require a daemon protocol bump.

The current bb-jsl.service uses KillMode=control-group. Restarting it can terminate its agent subprocesses.
Drain current local work before migrating to separate services. Keep the existing service until deployment receives explicit authorization.
No production limit increase, agent termination, server restart, or deployment occurred during this implementation.

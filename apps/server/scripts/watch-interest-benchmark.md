# Watch-interest refresh benchmark

Run from the repository root after `pnpm install --frozen-lockfile` and `pnpm exec turbo run build --filter=@bb/server`:

```sh
node --conditions=source --import tsx apps/server/scripts/watch-interest-benchmark.mjs 20 2 100
node --conditions=source --import tsx apps/server/scripts/watch-interest-benchmark.mjs 1000 10 20
```

The arguments are subscribed threads, hosts, and measured refreshes. Each process creates a fresh migrated file database with one environment/project per host, evenly distributed threads, one environment-detail subscription per environment and one thread-detail subscription per thread. It uses the real `NotificationHub` and `WatchInterestCoordinator`; daemon sockets collect sends in process. No production data, events or payloads are read. The20-thread/two-host case is a small illustrative workload;1,000threads/tenhosts is deliberately synthetic stress, not observed production subscription volume.

Every iteration updates one environment's path outside timing, then measures the complete synchronous `NotificationHub.notifyEnvironment(...,["metadata-changed"])` callback, including target resolution, fingerprinting, message serialization and daemon socket dispatch. It also queues a zero-delay timer immediately before the refresh and records how long that callback waits. This is queued JavaScript responsiveness, **not HTTP latency**. Network transport, disk writes for the preceding metadata update, fixture creation and initial subscription setup are excluded. Output assertions require exactly one changed host watch-set per iteration and the expected total thread targets across all hosts.

Three warmup refreshes are excluded. Normal workloads measure100refreshes/process; the expensive stress workload measures20. SQL counts include each real get/all call inside the synchronous refresh. The benchmark instruments the actual SQLite connection without substituting database results. WAL, synchronous NORMAL and default automatic checkpoint settings come from `createConnection`; the measured stage only reads. Database and application caches are warm; no OS cache flushing and no cold-read claim.

All timings use `performance.now()` elapsed wall time. Percentile `p` is sorted zero-based index `floor(n*p)`; maximum is the last value. At20samples, both p95 and p99 equal maximum and are **exploratory**, not robust tail estimates. Report per-run medians and maximum ranges, with sample counts, rather than implying a reliable production p99.

For a matched comparison, copy this unchanged harness into the same relative path on the baseline checkout. Run two independent processes per size/version in order normal-before, normal-after, stress-before, stress-after, stress-after, stress-before, normal-after, normal-before. Keep schema, fixture size, Node/SQLite versions and output assertions identical. Aggregate timing as ranges of per-run statistics, not pooled samples. Use the shared advisory benchmark lock to exclude participating heavyweight jobs; external host/services/OS load remains uncontrolled. The original subscription setup is itself quadratic and can take tens of seconds at1,000threads; that setup cost is deliberately excluded from refresh latency.

The optimization still walks active interests and sends complete watch sets when needed. It removes repeated SQL lookups; it does not make unbounded subscriptions free or establish a production latency SLO. No new indexes, persistent authorization cache, event retention changes or protocol changes are involved.

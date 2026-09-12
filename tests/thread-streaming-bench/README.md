# Thread streaming render benchmark

Measures what it costs to render an assistant answer while it streams into a
thread with a long history, on a large database, through the whole stack:

provider bridge → host daemon → server ingest → realtime frame → client
refetch → timeline merge → React → Markdown → layout/paint.

Every iteration runs production builds in isolated processes against a fresh
copy of golden data, drives a headless Chrome for Testing over raw CDP, types
the prompt into the composer like a user, and records main-thread, frame,
network, latency and server CPU metrics.

## Prerequisites

- Node 22 on `PATH` (better-sqlite3 is built for ABI 127).
- Production artifacts:
  `pnpm exec turbo run build --filter=@bb/app --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/bundled-plugins --filter=@get-bb/plugin-sdk --filter=@bb/cli`
- Chrome for Testing. The default path is
  `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`; set
  `CHROME_PATH` to use another binary.
- `TMPDIR` under your home directory on machines with a per-user `/tmp` quota.

## Usage

```bash
pnpm --filter @bb/thread-streaming-bench bench prepare
pnpm --filter @bb/thread-streaming-bench bench run --scenario default --iterations 5 --label baseline
pnpm --filter @bb/thread-streaming-bench bench run --scenario default,long --throttle 4 --label mobile-ish
pnpm --filter @bb/thread-streaming-bench bench compare <baseline>/results.json <candidate>/results.json
```

`prepare` builds golden data once and caches it under
`$BB_BENCH_CACHE_DIR` (default `~/.cache/bb-thread-streaming-bench`), keyed by
a hash of the spec, the bench provider sources, the Drizzle migrations and the
seed fixture. It seeds `pnpm seed:perf` defaults (1,200 threads, ~400k events),
installs `tests/bench-stream-provider`, and grows bench threads through the
real stack with instant `bench_history` turns: an 8-turn thread (`small`), a
150-turn thread (`large`) and a 600-turn thread (`xlarge`).

`run` options:

| Option                                      | Meaning                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scenario a,b`                            | Scenarios to run (see below).                                                                                                                                     |
| `--iterations N`, `--warmup N`              | Measured and discarded iterations per scenario.                                                                                                                   |
| `--throttle N`                              | CPU throttling rate applied after the page loads.                                                                                                                 |
| `--profile none\|cpu\|trace`                | Renderer CPU profile or a devtools timeline trace (with stacks and invalidation tracking) per iteration. Profiling perturbs timing; do not mix with latency runs. |
| `--server-profile`                          | Start the server with the Node inspector and record a server CPU profile for the streaming window.                                                                |
| `--artifact-root <checkout>`                | Run the production artifacts of another checkout (it must have built `@bb/cli` too).                                                                              |
| `--compare-roots a=<checkout>,b=<checkout>` | Alternate several checkouts per iteration; writes `comparison-<label>.md` against the first.                                                                      |
| `--inject-css <file>`, `--inject-js <file>` | Experiment: append a stylesheet or an init script.                                                                                                                |
| `--reduced-motion`                          | Experiment: emulate `prefers-reduced-motion: reduce`.                                                                                                             |
| `--label`, `--out`, `--cache-dir`           | Output naming and locations.                                                                                                                                      |

## Scenarios

| Name             | History | Document                                           | Pace             |
| ---------------- | ------- | -------------------------------------------------- | ---------------- |
| `default`        | large   | `long-response` (16.5 KB)                          | 24 chars / 30 ms |
| `long`           | large   | `long-response` × 4 (66 KB)                        | 24 chars / 16 ms |
| `pathological`   | large   | stray `$$`, long loose list, long fence, big table | 24 chars / 30 ms |
| `small-history`  | small   | `long-response`                                    | 24 chars / 30 ms |
| `xlarge-history` | xlarge  | `long-response`                                    | 24 chars / 30 ms |

## Metrics

Measured from the composer send until the stream completes, the thread is idle,
every checkpoint rendered, and two more seconds passed.

- Main thread: CDP `Performance.getMetrics` deltas (task, script, layout,
  style, counts, JS heap).
- Long animation frames (count, blocking time, top script attribution), long
  tasks (TBT), rAF frame intervals.
- React commits, counted through a DevTools hook stub.
- Timeline requests (`afterSequence`, full, older page), bytes and duration;
  other API requests; WebSocket frames.
- Line render latency: plain-text checkpoint phrases from the document; the
  latency is the time from the provider emitting the newline that completes the
  checkpoint's line (assistant text is newline-gated) until the phrase appears
  in the DOM.
- Server and host daemon CPU from `/proc` process-tree deltas.
- Pinned-to-bottom fraction while streaming.
- DOM nodes added (mutation records) and CDP RecalcStyle time per layout.
- JS heap retained after a forced GC.
- Final message text hash and a size-only timeline geometry hash, to catch
  rendering changes between runs.

Report min and median over at least five iterations, and compare runs taken on
the same machine at a similar load average. Other heavy processes skew
unsaturated candidates more than saturated baselines; inspect the per-iteration
JSON files when medians disagree with individual runs.

# Debugging And QA

- `pnpm dev` prints the active frontend URL, server API URL, host daemon port, data dir, and logs dir. Do not assume fixed dev ports.
- `pnpm mobile:apk:dev` builds a standalone ARM64 Android APK at `apps/mobile/build-output/bb-dev.apk`, named **bb dev** with an orange icon and separate package/data from the installed app. Append `-- x86_64` for an Intel emulator. See [the mobile build instructions](../apps/mobile/README.md#android-local-apk-and-verification) for prerequisites, installation, and per-thread delivery.
- `pnpm start:worktree` builds production artifacts and serves the optimized app bundle from the checkout-specific dev server URL, while keeping the same dev data directory and deterministic server/host-daemon ports. It has no Vite dev server or hot reload.
- `pnpm start:worktree-remote` is the trusted-network variant of `pnpm start:worktree`; it binds that server to all IPv4 interfaces.
- `pnpm desktop` packages the Electron app and launches it against the installed data directory, ports and Electron user-data directory, the same targets a released build uses. It shares the single-instance lock with an installed bb: quit that first, or the launch focuses it instead of starting your build.
- `pnpm desktop:worktree` packages and launches it against this checkout's data directory and deterministic ports, the same instance `pnpm start:worktree` uses, with Electron's user-data directory at `$BB_DATA_DIR/desktop` (override with `BB_DESKTOP_USER_DATA_DIR`). It refuses to start when the server or host-daemon port is busy, so a stale server cannot answer for your build. Set `BB_DESKTOP_OPEN_DEVTOOLS=1` to open DevTools. Both desktop commands always repackage first; machines without a Developer ID identity produce unsigned artifacts.
- The packaged app defaults to server/frontend `:38886`, host daemon `:38887`, data dir `~/.bb/`, and logs under `~/.bb/logs/`.
- `bb-app` (including `pnpm start`), `bb-server`, and `bb-host-daemon` capture service stdout and stderr in `logs/server-stdio.log` and `logs/host-daemon-stdio.log` under the selected data directory. These append across restarts and are separate from rotating application logs. Use `tail -F` on these files for console output and early startup errors; service output is not forwarded to the launcher's terminal.
- Entity IDs in URLs (`proj_*`, `thr_*`) are primary keys. Query them directly against the active data dir: `sqlite3 <data>/bb.db "SELECT * FROM threads WHERE id = 'thr_xxx';"`.
- API routes are under `/api/v1/`, for example `GET /api/v1/threads/:id`. Use `curl` against the server API to isolate frontend issues from server behavior.
- Use the CLI to inspect state: `pnpm bb thread show <id>`, `pnpm bb project list`, `pnpm bb status`. From source, use `pnpm bb:dev`.

## Desktop Browser Tab Recovery

Saved desktop browser tabs keep their URL and owning host/window. Opening one
in the desktop app attaches the existing view when that window still owns it,
including after its connection generation changes. While the desktop or host is
reconnecting, the panel retries for about a minute, then offers Try again.

After a window closes or the app relaunches, the panel reopens the saved URL in
the current window on the same host once the host confirms the old window is
gone. Native history and unsaved page state are not restored. The desktop broker
suppresses teardown snapshots from destroyed windows so closing a window does
not delete its saved tabs before another window can recover them. The server adopts
the restored tab from the window's browser snapshot and closes competing restored
views if two windows reopen it concurrently. Snapshots from a stale restoring
generation cannot adopt the tab. A newer snapshot from the same window and
thread cancels a pending adoption, including when the newer snapshot is empty.

Web clients, other hosts, and other live windows show the saved URL and its
availability instead of attaching a native view. Copy link remains available;
Open in browser accepts only HTTP(S) URLs. The panel's tab close control also
works in this state. Selecting another saved tab rechecks its owning window;
Try again also rechecks a window previously reported as live after it closes.
Inspect the persisted owner with
`bb thread tabs show <threadId> --json` or `sdk.threads.tabs.get`, and compare it
with `bb browser instances --host <hostId> --json` or
`sdk.experimental_desktopBrowsers.listInstances`. Recovery uses the existing
native snapshot and browser APIs; no daemon wire fields change.

## Log Fields

- `Slow DB query` is logged when a prepared statement, `exec` batch, or
  complete transaction takes at least 100 ms. `durationMs` is elapsed time and
  `cpuDurationMs` is CPU time on the calling thread; a large gap means waiting
  or descheduling (filesystem I/O, lock waits, or scheduler contention), not
  necessarily slow SQL. `operation: "transaction"` covers the callback, commit,
  and rollback, and its SQL label is the transaction mode; statements inside it
  may log separately, so do not add their durations. Commits can include
  SQLite's automatic WAL checkpoint. SQL string literals are redacted and
  parameter values are never logged.
- Connect's `tunnel closed` warnings include the last transport error's message
  and code, `connectedDurationMs`, and `lastHeartbeatAckAgeMs`. A null duration
  means the opening handshake never completed; a null acknowledgement age means
  no heartbeat acknowledgement arrived on that connection. They appear in the
  server logs and `<dataDir>/plugins/connect/logs/plugin.log`.

## Reproducing Test Order Failures

CI's test shards shuffle test files and tests within each file. Vitest prints the seed for
runs that execute; unchanged Turbo tasks can still reuse cached results.
Reproduce a failing package with its logged seed:

```bash
pnpm exec turbo run test --filter=@bb/app -- --sequence.shuffle --sequence.seed=4721 --maxWorkers=2
```

For a repository-wide order audit, omit the filter and use `--concurrency=4`
before Turbo's `--` separator. CI caps each Vitest process at two workers so
package concurrency does not multiply into unbounded worker contention.
Use a second seed after
repairing order dependencies. Reset test-owned mock implementations, fixture
arrays, persisted preferences, and databases before each test. Await background
work and close streams, workers, and subprocesses before removing their files or
tearing down their environment. Worker isolation does not restore built-in
process objects or cancel resources that a test leaves running.

## ACP Steer Cancellation Failures

ACP steering cancels the active prompt before submitting the follow-up. If that
prompt returns an error during cancellation, BB marks the session for rebuilding
before the next turn. The replacement process attempts `session/load`; providers
without working session restoration start fresh and report the loss of in-agent
history. The failed turn stays failed, and an unsent steer is not acknowledged as
accepted.

Older Hermes adapters can throw `NoneType.startswith` during cancellation and
leave their internal session marked running. Update Hermes to include
[the null-response fix](https://github.com/NousResearch/hermes-agent/commit/8f0322da5b82029f3bc4d16fbaa2c986299abfc6)
and [the running-state cleanup](https://github.com/NousResearch/hermes-agent/commit/bccd45618c16b605822dd179cd0399abdecaf698),
then restart its retained process with `bb thread stop <thread-id>` before sending
a new message. BB's recovery prevents reuse after a cancellation error; it does
not repair the older adapter's failing turn.

## Machine Authentication Cache

Successful verification of an unlimited daemon host key is cached in server
memory for 30 seconds, capped at the key's expiry. The cache holds at most
1,024 entries and retains only token hashes. Hits neither read nor write the
authentication database and do not extend the cache lifetime. The next request
after expiry uses the existing verifier and updates usage timestamps, so
`lastRequest` and `updatedAt` describe the last full verification rather than
every request. A burst of concurrent cold requests can still perform separate
verifications before the first result is cached.

Revocation and reenrollment invalidate that host's cached keys and prevent
already-running verifications from returning or caching invalidated credentials.
Restarting the server discards the cache. Enrollment keys and keys with quotas,
refills, or enabled rate limiting always use the existing verifier. Direct edits
to authentication rows outside the machine-auth service are observed when the
cache expires; QA that changes a warmed key's database fields must account for
that window. Expiry known when caching is enforced on every hit.

## Slow Database Operations

The server logs `Slow DB query` when a prepared statement, `exec` batch, or
complete transaction takes at least 100 ms. `durationMs` measures elapsed time;
`cpuDurationMs` measures CPU time on the calling thread. A large gap indicates
waiting or descheduling, not necessarily inefficient SQL. It does not by itself
distinguish filesystem I/O, lock waits, and scheduler contention.

`operation: "transaction"` includes the callback, commit, and rollback; its SQL
label identifies the transaction mode rather than containing callback SQL.
Statements inside it may also log, so do not add their durations to the
transaction duration. Commit timing matters because SQLite's automatic WAL
checkpoint can perform filesystem writes and synchronization on the server
thread. `operation: "exec"` also covers maintenance batches. SQL string
literals are redacted and parameter values are never logged.

## Pending Question Drafts

Native provider questions and Ask User Question plugin forms save partial
selections, free text, and the current question in browser-local storage under
`bb.question-draft.v1:<threadId>:<interactionId>`. These drafts survive thread
navigation and page reloads on the same browser/device. They are cleared after
successful submission or cancellation and retained if either request fails.
When local storage is unavailable, an in-memory fallback preserves drafts
across navigation until the page reloads. Drafts are not sent to the agent until
submitted, and CLI/SDK answers do not read the browser's draft.
There is no time-based expiry. If an interaction is resolved elsewhere, its
draft can remain in local storage but is never rendered as an active question;
the server's pending interaction list controls that. Clearing browser site data
removes these drafts. Older clients ignore this new storage namespace. Only the
native question form and Ask User Question plugin opt in; secret-request forms
do not use this storage.

## Native Draft Rollback

Migration `0132_thread_drafts` now only adds the temporary `threads.draft`
column. Its original pre-release SQL merged Drafts plugin queue entries into
that column and deleted the held rows and built-in plugin installation. The
original hash remains accepted by `migration-history.ts` for databases that
already ran it; it is not replayed.

Migration `0133_remove_thread_drafts` drops the column without converting its
contents back into queued messages. Databases upgrading through the revised
`0132` retain their existing queue rows and Drafts plugin installation. Databases
that ran the original `0132` lose the stored core draft contents, retaining their
thread rows and any remaining queued messages. The restored built-in plugin is
installed through normal server startup. Reintroducing native drafts requires
a new migration after `0133`.

## Archive Confirmation Counts

`GET /api/v1/threads/:id/child-summary` and `sdk.threads.childSummary` return
`nonDeletedChildCount` for deletion (direct children, including archived rows)
and `unarchivedDescendantCount` for archive confirmation. The latter follows
the same hierarchy, lifecycle-owner, and hidden source-fork edges as
`archive-all`, deduplicates threads, traverses archived intermediaries, and
excludes hidden, already archived, or deleted candidates and the requested root.
Hidden threads still participate in the archive cascade, and visible descendants
beneath hidden threads still count toward confirmation.
The UI adds the root to the displayed total and skips confirmation when no
unarchived descendants remain or the General setting `confirmThreadArchive`
is disabled. The summary is a preview; concurrent changes
can alter the eventual archive result. CLI and SDK archive calls remain
non-interactive.

## File Content Routes

Clients read file bytes through path-shaped GET routes, so relative URLs in
HTML and markdown resolve against the same route:

- `/api/v1/threads/:id/thread-storage/files/:path` reads the thread's storage
  folder.
- `/api/v1/threads/:id/host-files/:absolutePath` and
  `/api/v1/hosts/:id/files/:absolutePath` read the thread environment's host or
  the named host from its filesystem root. The path omits the leading `/`; a
  first segment such as `C:` selects that Windows drive root.
- `/api/v1/environments/:id/files/:path` reads the environment workspace, and
  `/api/v1/environments/:id/revisions/:ref/files/:path` reads `HEAD` or a
  4-40 character hex commit from it.
- `/api/v1/projects/:id/files/:path` and
  `/api/v1/projects/:id/hosts/:hostId/files/:path` read the project's local-path
  source on the primary or named host.

Media elements, HTML iframes, markdown images, and Download links use these
URLs directly. The server resolves the root on every request, so they need no
setup and do not expire.

Plugins that preview an arbitrary host directory instead mint a lease:
`POST /api/v1/files/previews` with `{ hostId?, rootPath, ttlMs? }` returns
`{ baseUrl, expiresAtMs }`, and `GET /api/v1/file-previews/:lease/:path` reads
that root. Minting the same root again returns the same `baseUrl` and extends
its expiry. Leases live in server memory and do not survive a server restart.

File content reads support a single HTTP byte range for media playback, seeking, and
file preview sampling. Responses advertise `Accept-Ranges: bytes`; bounded,
open-ended, and suffix ranges return `206` with `Content-Range` and the selected
bytes. Unsatisfiable ranges return `416` with `Content-Range: bytes */<size>`.
Malformed ranges, unsupported units, and multipart ranges fall back to the full
`200` response. HEAD ignores Range. Revision routes read the file with one
whole-file daemon read, so those responses ignore Range, keep the daemon's
25 MB non-image limit, and revalidate with a strong SHA-256 ETag.

File previews request the first 64 KiB. A complete sample becomes the preview
directly. Otherwise the sample, its MIME type, and the `Content-Range` size
classify the file: images and videos render from the file URL, binaries show
their size and a Download link, and text is fetched in full only when it is at
most 25 MB. The Download link is the file URL with the anchor `download`
attribute, so the browser streams it to disk without the 25 MB limit.

`If-None-Match` revalidation takes precedence over Range. Streamed responses use
weak metadata ETags (`W/"file-<revision>"`), not content SHA-256 hashes. This
avoids reading an entire large file just to validate it. Because the validator
is weak, any `If-Range` header falls back to a full `200` response, including a
matching weak tag or date. All raw file responses carry `Content-Security-Policy:
sandbox allow-scripts`, including SVG and XHTML, so directly opened documents
cannot acquire the app's origin privileges. HTML also carries the no-store
policy, at any size; the app renders an HTML iframe only for files up
to 5 MiB and shows larger HTML as source or, past 25 MB, as a Download.

The server uses `host.read_file_chunk` for a metadata-only probe (`length: 0`),
then reads at most 1 MiB per RPC as the HTTP consumer pulls data. HEAD, `304`,
and `416` responses read no contents. Cancelling or aborting stops subsequent
reads; an already in-flight RPC can finish. Each RPC opens and closes its file
handle, so no remote read session needs cleanup. Offsets and lengths are
validated at the daemon boundary, and paths remain confined to the route's root.

The daemon returns a revision based on device, inode, size, and nanosecond
mtime/ctime. Every content read checks the expected revision before and after
reading from its open descriptor. A mismatch before response headers produces
retryable `409 file_changed`; a change or error after streaming starts aborts
the HTTP body. The server also rejects short/misaligned chunks. This detects
ordinary writes, truncation, and replacement; it is not an immutable filesystem
snapshot or a cryptographic guarantee against changes hidden by filesystem
metadata granularity.

Streamed reads bypass the whole-file size caps (including the 25 MiB
non-image cap); each chunk stays bounded regardless of file size. `host.read_file`
consumers such as `POST /files/read` and revision routes keep their
whole-file limits and SHA-256 validators. `sdk.projects.fileContent` (and
`bb project content`) reads through the project file routes and decides utf8 versus
base64 from the returned bytes. Host-daemon protocol 219 introduced the chunk
RPC; older enrolled daemons cannot serve streamed reads until updated.

## Stale Workspace Claims

Failed thread provisioning immediately requests environment cleanup. If a previous
failure left a claim behind, sends, environment admission, and provider path claims
repair it when they encounter it; restarting the server is not required.

Claims owned by threads that are still starting or stopping remain blocked. A stale
claim on a ready or shared checkout is released locally, preserving the workspace.
A partially created environment retains its claim and is scheduled for the existing
background lifecycle cleanup. Sends report `workspace_busy` with “Workspace cleanup
is pending. Try again shortly.” until removal completes. Provider cleanup is never
awaited by this admission repair, and startup does not scan for abandoned claims.

## Local Dev QA

Run `pnpm dev` from this checkout and keep it running in a terminal. It prints
the checkout-specific URLs, data directory, and logs directory. Stop it with
Ctrl-C. For desktop-only changes, start
`pnpm exec turbo run dev --filter=@bb/desktop` in a second terminal.

Use the Node version in `.nvmrc` (22.19.0). Desktop development requires
Node 22.19 or newer in the Node 22 release line.

A bb connect shared-port URL is a different browser origin from localhost. If
QA through that URL needs the browser-local host daemon, restart the dev app
with the share origin configured after exposing its app port:

```bash
BB_APP_URL=https://<handle>--<app-port>.getbb.app pnpm dev
```

The port remains stable for the checkout, so the existing share continues to
work after the restart. The host daemon intentionally rejects remote origins
that are not configured; otherwise any webpage could drive its local editor
API.

For CLI QA, `pnpm bb:dev` derives this checkout's server and daemon endpoints.
In the test shell, clear inherited endpoint and thread context overrides first
so commands target the dev instance. Keep these changes inside that shell.

Test agents with:

```bash
unset BB_SERVER_URL BB_HOST_DAEMON_PORT BB_THREAD_ID BB_ENVIRONMENT_ID BB_THREAD_STORAGE BB_PROJECT_ID BB_CLI BB_CLI_REEXEC
pnpm bb:dev thread spawn --project proj_personal --provider codex --permission-mode accept-edits --title "Smoke test" --prompt "Reply only with ok." --json
```

## Local Cloud

Run the Cloud dashboard, the Connect worker, and the AI gateway against one
local D1 database:

```bash
pnpm cloud:dev
```

The command applies migrations and prints the dashboard URL. Create a local
email/password account, claim a handle, create a pairing code, and run the
displayed `bb account login --code` command against a bb started with
`pnpm dev` (`bb connect --code` does the same and also turns remote access
back on). A browser sign-in started with
`bb account login` opens `<local origin>/link?code=…` on the same origin. The
same worktree-specific local origin serves the dashboard at `bb.localhost`,
sends `bb.localhost/api/ai/*` to the AI gateway worker, and routes
`<handle>.bb.localhost` through the Connect worker. Email/password auth
is enabled only for this loopback workflow; production remains GitHub-only.
`pnpm dev` automatically sets `BB_DEV_CONNECT_BASE_URL` to that worktree's
local Cloud origin. While the bb is signed out, Settings → bb account and
Settings → Installed plugins → Connect therefore sign in against the local
Cloud, and a pasted code redeems locally. An explicit `--base-url ...` (or
`bb connect --server ...`) still wins, so the dev bb can still sign in to
getbb.app.
Local machine enrollment follows the same origin: local `http:` server URLs
produce `ws:` machine tunnels and `http:` share URLs, while non-local machine
enrollment remains HTTPS-only.

The AI gateway answers `503 unavailable` until an OpenRouter key is present.
Export `OPENROUTER_API_KEY` in the shell before `pnpm cloud:dev` to pass it
through to the local worker; the startup banner says which mode is active.
To exercise the whole chain without OpenRouter, export
`BB_CLOUD_DEV_AI_UPSTREAM_BASE_URL` (for example `http://127.0.0.1:4599/api/v1`)
pointing at a local OpenAI-compatible fake, plus any non-empty
`OPENROUTER_API_KEY`.
The production gateway gets the key from the repository's `OPENROUTER_API_KEY`
Actions secret, which `deploy-ai-gateway.yml` uploads with each deploy. Set the
staging key with `wrangler secret put OPENROUTER_API_KEY --env staging` from
`apps/ai-gateway`. Use a dedicated OpenRouter key with account-wide zero data
retention and a daily credit limit.

Ctrl-C stops the local services. Local D1 state is kept under
`.wrangler/cloud-dev`.

To test a source bb against the deployed staging Cloud instead, start it with
`pnpm dev --staging`. bb account and Connect then sign in, redeem codes, open
tunnels, and call the AI gateway at `https://vibecodethis.site`; no
`pnpm cloud:dev` is needed. The flag only changes the default origin, so a
dev data dir already signed in elsewhere keeps its account until
`bb account logout`.

## Record Provider Bridge Traffic

Export `BB_PROVIDER_BRIDGE_RECORD_DIR` before you start the dev app and every
provider bridge records its runtime and provider wires as NDJSON:

```bash
BB_PROVIDER_BRIDGE_RECORD_DIR=$HOME/.bb/provider-recordings/raw pnpm dev
```

In a second terminal, run:

```bash
unset BB_SERVER_URL BB_HOST_DAEMON_PORT BB_THREAD_ID BB_ENVIRONMENT_ID BB_THREAD_STORAGE BB_PROJECT_ID BB_CLI BB_CLI_REEXEC
pnpm bb:dev thread spawn --project proj_personal --provider codex --prompt "Run git status." --json
ls ~/.bb/provider-recordings/raw/codex/
```

The layout is `<dir>/<providerId>/<threadId>/<direction>.ndjson`, plus a
`_process` scope for lines that belong to no thread. See
[provider-bridge-protocol.md](provider-bridge-protocol.md), "Record mode",
for the entry format. Raw recordings can contain secrets and absolute paths.
Run `node scripts/provider-recordings/redact.mjs <raw-dir> <out-dir>` before
you share one, and never commit a raw recording.

To compare two checkouts' bridges on the committed recordings, run
`pnpm parity --old <checkout> --new . [--provider <id>] [--cell <name>]`.
Each leg replays every cell through its own bridge, assembler, and timeline
projection; the run prints a PASS/FAIL line per cell with event and row
counts and exits non-zero on any diff outside
`packages/provider-bridge-protocol/recordings/parity-allowlist.json`.

## Performance Fixture Database

Use `pnpm seed:perf` to fill a dev database with a large, realistic fixture:
many projects, ~1,200 threads, and ~400k event rows with production-like
payloads. Use it to reproduce performance problems that only appear at scale.

- Start the dev app once first (`pnpm dev`), then stop it and
  seed. The fixture then attaches to the real local host, so agents still run.
- By default the command seeds this checkout's dev data dir. Pass
  `--data-dir <path>` for another target. The command refuses to touch `~/.bb`.
- Scale flags: `--projects`, `--threads`, `--events`, `--seed`. `--reset`
  deletes the database file first. Without `--reset` the fixture appends.
- Example: `pnpm seed:perf -- --reset --events 400000`.

## Provider Corpus

The provider corpus is a private set of real production threads extracted from
a personal `~/.bb/bb.db`. It is the regression oracle for timeline projection:
every change must project the same rows and build timelines at the same speed.
The corpus contains real prompts, code, and paths, so it is **never
committed**; `.gitignore` blocks every `provider-corpus/` directory except the
in-repo harness and scripts.

- Location: `~/.bb/provider-corpus/` by default. Tests read it through
  `BB_PROVIDER_CORPUS_DIR` and skip when the variable is unset or the directory
  has no `manifest.json`, so CI and fresh checkouts stay green.
- Layout: `manifest.json` (thread selection and reasons), `profile.json`,
  `threads/<provider>/<threadId>/{meta.json,events.ndjson}`, and the generated
  `snapshots/` directory described below.
- Reader: `@bb/test-helpers` exports `corpusAvailable()`,
  `listCorpusThreads({ provider?, reasons? })`, and `loadCorpusThread(id)`.
  Event rows decode through the same `parseStoredThreadEvent` the server uses.

Gates under `apps/server/test/provider-corpus/`:

- `row-snapshots.test.ts` loads each thread into in-memory SQLite and projects
  every timeline page the way `GET /threads/:id/timeline` does (default and
  nested variants), then compares the rows with
  `snapshots/rows/<provider>/<threadId>.json`.
- `timeline-perf.test.ts` measures cold builds of the 10 largest threads per
  provider (latest page and full page walk) and compares with
  `snapshots/perf-baseline.json`. The CI micro-benchmark in the same file needs
  no corpus.
- `timeline-streaming-memo.test.ts` appends streaming rows to each thread's
  latest turn and requires every latest-page build to equal a build on a fresh
  connection with empty caches.

Run them:

```bash
scripts/provider-corpus/snapshot-rows.sh compare   # default mode, fails on diffs
scripts/provider-corpus/snapshot-rows.sh write     # refresh the baseline
```

The script wraps `pnpm exec turbo run test:provider-corpus --filter=@bb/server`
with `BB_PROVIDER_CORPUS_SNAPSHOT=write|compare`. Turbo strips undeclared
variables, so use that task (not the package `test` task) when you set the
corpus variables. Each run writes `snapshots/rows-last-run.json` and
`snapshots/perf-last-run.md` with totals and the perf table.

Compare mode fails on any row diff that `snapshots/allowlist.json` does not
cover. An entry names a scope, a path, and the PR that made the change:

```json
[
  {
    "threadId": "thr_abc123",
    "path": "/variants/*/pages/*/rows/*/output",
    "pr": "#1234",
    "reason": "…"
  },
  {
    "provider": "codex",
    "path": "/variants/default/pages/**/planSteps",
    "pr": "#1235",
    "reason": "…"
  },
  { "*": true, "path": "/variants/**/maxSeq", "pr": "#1236", "reason": "…" }
]
```

`path` is a JSON pointer over the snapshot, or a glob where `*` matches one
segment and `**` any number. The run prints the entries it used; an entry that
covers nothing fails the run because it is stale.

`snapshots/rows` is the baseline minted on `main` and shared by every
workstream, so never run `write` against it from a feature branch. A PR that
intentionally changes rows carries its own allowlist in the repository
(`apps/server/test/provider-corpus/allowlists/<ws>.json`, same schema, merged
after the shared file) and compares with
`BB_PROVIDER_CORPUS_ALLOWLIST=<that file>`. A snapshot of the branch's own
rows goes to a shadow directory: `BB_PROVIDER_CORPUS_SNAPSHOT_DIR=<dir>`
redirects both `write` and `compare`. Re-mint `snapshots/rows` from `main`
after such a PR merges and delete the allowlist file it carried.

A pointer allowlist cannot describe a change that adds or removes rows: every
later sibling shifts and the diff reports the whole turn. For such a change,
carry a row-class file instead
(`apps/server/test/provider-corpus/allowlists/<ws>-row-classes.json`) and set
`BB_PROVIDER_CORPUS_ROW_CLASSES=<that file>` on the compare run. The gate then
matches rows by identity (`callId`, `itemId`, `interactionId`, turn id, or row
id), buckets every change into the first class whose matcher fits, and fails
on a change no class claims or an entry that claims nothing (judged per
entry, so a dead matcher cannot hide behind a sibling with the same name). A
class names a `reason` and one matcher: `added`, `removed`, `moved` (the row left one
nesting level for another), `resegmented` (a turn shows a different number of
visible segments), `reshaped` (`from`/`to` kinds, optionally the other
`fields` the reshape may touch), or `changed` with the `fields` it may touch;
each narrows by `kind`, `workKind`, `role`, and `nested`. Turn bounds that follow a changed child fall into the built-in
`container-bounds` class. The run prints the count per class and records them
in `rows-last-run.json`. To iterate on the classes without re-projecting the
corpus, mint the branch's rows once into a shadow directory and classify the
two directories offline:

```bash
pnpm exec tsx scripts/provider-corpus/classify-row-diff.ts \
  ~/.bb/provider-corpus/snapshots/rows ~/.bb/provider-corpus/snapshots/rows.<ws> \
  --classes apps/server/test/provider-corpus/allowlists/<ws>-row-classes.json --verbose
```

Perf compare mode passes when each thread's normalized cost (minimum build time
divided by a fixed CPU calibration workload run alongside it) is within 10% of
the baseline, or within 5 ms for small latest-page builds, and the median event
size is within 15%. Compare mode refuses a baseline written with different gate
settings. Run the gate on a machine whose load average is below its core count;
the table header warns when the machine is oversubscribed.

## Desktop Browser Smoke Tests

```bash
pnpm exec turbo run smoke:browser-cdp --filter=@bb/desktop > /tmp/browser-cdp-smoke.log 2>&1
pnpm exec turbo run smoke:browser-cdp --filter=@bb/desktop -- --dev-browser /absolute/path/to/dev-browser > /tmp/browser-cdp-local-smoke.log 2>&1
pnpm exec turbo run smoke:browser-broker --filter=@bb/desktop -- --dev-browser /absolute/path/to/dev-browser > /tmp/browser-broker-smoke.log 2>&1
```

`smoke:browser-cdp` drives real Electron `WebContentsView` tabs through the
production CDP bridge with checksum-pinned DevBrowser and agent-browser
releases, a local fixture site, and a separate Electron profile; it starts no
BB core and reads no existing store. It requires Linux x64, `xvfb-run`, and
network access to GitHub releases. The command prints its artifact directory
(screenshots, protocol traces, result summary); credentials are redacted.
`--dev-browser` tests a local DevBrowser build instead, records its SHA256, and
adds cross-origin iframe snapshot-reference checks that the pinned release
cannot pass. Run the task with `-- --help` for usage. Popup control is untested.
A result with `forcedExit: true` means Electron did not quit within five
seconds and its process group was killed: the browser checks passed, but
graceful shutdown was not proven.

`smoke:browser-broker` runs the actual SDK and CLI against an in-memory
migrated test server, an authenticated host broker, the desktop broker client,
and real Electron tabs. The harness supplies the server-to-host RPC responder,
so it does not prove remote-machine transport. It uses no existing BB store or
browser profile.

## Provider-literal ratchet (G1)

`node scripts/check-provider-literal-ratchet.mjs` counts provider-id literals
(`"codex"`, `"claude-code"`, `"acp-…"`, `providerId === "…"`, `isAcpProviderId`, …)
in core (everything outside `plugins/provider-*` and `examples/`) and compares a
per-file count against `scripts/provider-literal-baseline.json`. The count may
only go down, so adding a provider-id branch to core fails CI. After removing
literals, regenerate the baseline with `--write` and commit it. `--list` prints
every hit. When the baseline reaches zero, delete it and the guard. See
[provider-plugin-api.md](provider-plugin-api.md).

## File Content Routes

Clients read file bytes through path-shaped GET routes, which you can `curl`
directly:

- `/api/v1/threads/:id/thread-storage/files/:path`: the thread's storage folder.
- `/api/v1/threads/:id/host-files/:absolutePath` and
  `/api/v1/hosts/:id/files/:absolutePath`: the thread environment's host or the
  named host, from its filesystem root. The path omits the leading `/`; a first
  segment such as `C:` selects that Windows drive root.
- `/api/v1/environments/:id/files/:path` reads the environment workspace, and
  `/api/v1/environments/:id/revisions/:ref/files/:path` reads `HEAD` or a
  4-40 character hex commit from it.
- `/api/v1/projects/:id/files/:path` and
  `/api/v1/projects/:id/hosts/:hostId/files/:path`: the project's local-path
  source on the primary or named host.
- `GET /api/v1/file-previews/:lease/:path` reads a root leased through
  `POST /api/v1/files/previews` (`{ hostId?, rootPath, ttlMs? }`); leases live
  in server memory and do not survive a restart.

Responses support a single HTTP byte range and carry
`Content-Security-Policy: sandbox allow-scripts`. A file that changes before
response headers are sent returns retryable `409 file_changed`; a change after
streaming starts aborts the body. Revision routes ignore Range and keep the
daemon's 25 MB non-image limit.

## Prepared Worktree Restarts

`pnpm start` and `pnpm start:worktree` always run Turbo-backed preparation
before launching: Turbo rebuilds what changed and restores unchanged artifacts
from cache, and native modules are repaired when necessary. Add `--dryrun` to
prepare, print the resolved ports, bind host, paths, and runtime entrypoints as
JSON, and exit without launching services, migrating data, or requiring free
ports. Dry runs still write build outputs; run
`pnpm install --frozen-lockfile` first when needed.

Preparation writes build outputs in the checkout, so it is not an atomic
release switch for an instance serving those files. Do not prepare
concurrently with another preparation or against files a live instance serves.
To restart with minimal downtime, warm the shared Turbo cache from a separate
staging checkout, then stop the instance, update and prepare its checkout, and
launch. Moving the serving checkout changes the instance's default data
directory and ports.

Cache hits restore cached files but can leave extra files from an earlier
build. Built source servers load bundled plugins from
`packages/bundled-plugins/dist`; see
[official-plugin-release-process.md](official-plugin-release-process.md) for
adding a bundled plugin. The launcher sets `BB_BUILD_TOOLCHAIN` (Node, OS, and
architecture) to partition Turbo cache entries; do not set it yourself.

App production builds cache React Compiler transforms under
`<git-common-dir>/bb-cache/react-compiler`, shared across worktrees; delete it
while no build runs to clear it. `BABEL_SHOW_CONFIG_FOR` and
`ENABLE_REACT_COMPILER_TIMINGS=1` bypass that cache. Use
`pnpm exec turbo run build --filter=@bb/app --force` to rebuild without Turbo's
whole-task cache.

## Reviewing UI Code Splits

See [UI code splitting](ui-code-splitting.md) for the app's `defineSplit`
contract, explicit preload scopes, bundle-boundary guards, and parallel worker
handoff requirements. Use an isolated production build with browser request
interception to review loading and failure states and verify cold-download
behavior. Keep temporary review stories and fixtures out of the final diff.

## Server Move Markers

A server move or `bb server import` leaves JSON markers in the data
directory; check them when a server refuses to start or keeps redirecting:

- `server-import-journal.json`: an import is installing files. Without a
  matching `server-import.json` the import was interrupted, and the server
  refuses to start; rerunning `bb server import` into that directory rolls it
  back from `server-import-backup/`.
- `server-import.json`: the imported server on the target is waiting for
  activation (no plugins, sweeps, or daemon sessions run).
- `server-moved.json`: the old computer after the switch. The launcher refuses
  to start a server from that data and answers the old port with 410
  `server_moved`.
- `server-move-run.json`: the old server's durable move state, reconciled at
  boot.
- `last-server-move.json`: the new server's record of the move.
- `server-connect-hold.json`: an imported server starts without bb connect
  until `bb server allow-connect`.

During a move, `/health` on the new server reports
`serverMove: { moveId, state }` with `pending`, `activating`, or `ready`.
Usage is in `bb guide machines`.

## Daemon Protocol Mismatch

The server checks the daemon's protocol version before parsing session
payloads. A daemon on another `HOST_DAEMON_PROTOCOL_VERSION` is rejected with
`protocol_version_mismatch` and cannot serve workspace RPCs until it updates and
reconnects. Auto-update-enabled daemons install the server's matching `bb-app`
artifact; disabled or failed updates leave the machine disconnected until a
manual update succeeds. The commit that bumps the version records what changed.

## Opt-in server performance diagnostics

Collection needs both startup permission and the **Server performance
diagnostics** experiment; see [configuration.md](configuration.md) for the
flag, environment variable, and experiment. It covers the server only, not the
daemon. Leave it off for routine operation: profiling and extra logging add
overhead.

While on, the server logs database operations of at least 25 ms, API requests
of at least 100 ms, and event-loop stalls of at least 100 ms. Every five
seconds `Server performance sample` records process and main-thread CPU, loop
utilization and delay, GC, and memory; CPU values are interval totals, not
per-request attribution. A 1 ms V8 CPU profile is saved every 30 seconds to
`$BB_DATA_DIR/logs/performance/` (`Server CPU profile saved` logs its path,
PID, and UTC window). Profiles are kept for up to 12 hours and 1 GB total,
oldest first, so copy the ones you need. They use private permissions and
contain local paths and function names; inspect before sharing.

### Diagnose a captured stall

1. Note the request path and UTC time. Find its `Slow API request` and nearby
   `Event loop stalled` records; for timelines, also
   `Thread timeline build blocked the event loop` and its stage timings.
   `inFlightWorkAtObservation` can name an unrelated long poll; compare
   `longestSynchronousWork` and its wall/CPU times with the profile instead.
2. Load the `.cpuprofile` covering that time and PID in Chrome DevTools'
   JavaScript profiler, select the window, and read the bottom-up view.
   Match function names against the exact source revision of the build.
3. Compare stacks with `mainThreadCpuMs`, GC totals, and SQL `cpuDurationMs`.
   A slow SQL operation with little CPU indicates waiting but does not identify
   the lock owner or prove disk I/O.
4. Repeat with a small control workload. Expected long polls log slow requests
   without blocking the loop; require corroborating loop delay, stage timings,
   or sampled execution before calling them stalls.

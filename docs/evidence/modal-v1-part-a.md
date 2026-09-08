# Modal v1.0 part A evidence

Implementation: `1eaae416ea22d82922a9b38359add696d909fc9b` on
`bb/env-providers-2b-modal-v1`, based on `2426719e03` from
`bb/env-providers-2-machines`. No separate PR or stack link: this branch is for
integration into PR #3231 after A–D finish.

## Delivered

The plugin owns migrated SQLite `recipes`, `contexts`, `builds`, `build_events`,
`images`, `project_images`, `verifications`, and `image_references`. Supporting
owner, request-key, source-observation, upload/chunk, and base-artifact tables
provide durable ownership, transfer, and exact daemon package provenance.
Indexed scalar keys accompany validated JSON records. Claims and CAS use SQLite
transactions and unique constraints, including one active build per account.

`bb modal` commands: project inspect/configure/show; recipe put/show/list;
context upload; image build/logs/status/cancel/list/gc. Each supports `--json`.
Typed RPC names: project.inspect/configure/show; recipe.put/get/list;
context.prepare/upload/complete; build.start/events/get/cancel; image.list/gc.
CLI and RPC call the same handlers. SDK adds experimental bounded CLI continuation
and revision-conflict transport, with audit, Guide inventory, and SDK 0.4.56 bump.

The isolated TypeScript worker uses pinned modal@0.10.0 behind build/reconcile/
delete/resolve operations. It prepends bb's base, translates the documented
Dockerfile subset, persists intent before submission, publishes immutable
owner/account/app/hash-scoped images, and reconciles uncertain outcomes by name.
Logs have monotonic cursors, bounded pages, a 10 MiB retention limit, explicit
truncation, and redaction across vendor chunk boundaries. Cancellation of a
reader never cancels the shared build. Rebuilds are explicit.

Launch uses images.fromId and v4 resources pin build/image/account/app/resources/
policy. The v3 migration remains supported. Images include no enrollment,
server instance URL, pool token, or agent login state. The versioned Debian
bookworm / Node 22.19.0 base contains npm, git, curl, CA certificates,
build-essential, Python 3, exact-server bb CLI/daemon, Codex 0.153.4 and Claude
Code 2.1.263. The daemon tarball SHA-256 and protocol version enter the build hash
and image manifest.

Implementation diff against the base: **3,818 added / 101 removed lines**
(3,919 changed, excluding this evidence document; generated artifacts excluded).

## Verification

Command:

```sh
pnpm exec turbo run typecheck lint test --concurrency=1 --filter=bb-plugin-environment-modal-sandbox --filter=@get-bb/plugin-sdk --filter=@bb/cli --filter=@bb/server --filter=@bb/plugin-build --filter=@bb/plugin-api-map --filter=@bb/domain
```

Verbatim summary, with ANSI styling removed:

```text
@bb/domain:test:  Test Files  33 passed (33)
@bb/domain:test:       Tests  194 passed (194)
@bb/plugin-api-map:test:  Test Files  10 passed (10)
@bb/plugin-api-map:test:       Tests  76 passed (76)
@get-bb/plugin-sdk:test:  Test Files  22 passed (22)
@get-bb/plugin-sdk:test:       Tests  245 passed (245)
bb-plugin-environment-modal-sandbox:test:  Test Files  5 passed (5)
bb-plugin-environment-modal-sandbox:test:       Tests  47 passed (47)
@bb/plugin-build:test:  Test Files  10 passed (10)
@bb/plugin-build:test:       Tests  138 passed | 1 skipped (139)
@bb/cli:test:  Test Files  57 passed (57)
@bb/cli:test:       Tests  586 passed (586)
@bb/server:test:  Test Files  239 passed | 1 skipped (240)
@bb/server:test:       Tests  2415 passed (2415)
 Tasks:    22 successful, 22 total
Cached:    5 cached, 22 total
  Time:    1m44.702s 
```

Integration command and final verbatim summary:

```sh
pnpm exec turbo run test --filter=@bb/integration-tests -- --maxWorkers=2
```

```text
@bb/integration-tests:test:  Test Files  27 passed (27)
@bb/integration-tests:test:       Tests  76 passed (76)
 Tasks:    8 successful, 8 total
Cached:    3 cached, 8 total
  Time:    1m35.523s 
```

The catalogue tests use the plugin's real migrated SQLite database; core transport
tests use the core migrated database harness. Coverage includes concurrent hash/key
claims, CAS conflict, interrupted build reconciliation, stale worker fencing,
redaction/cursors/truncation, a disconnected shared watcher, malformed archives,
missing images, protected GC, owner isolation, and unsupported Dockerfile lines.

Initial highly concurrent checks hit timeouts. Limiting Turbo package concurrency
resolved them. A progress-event server test passed on focused rerun and the full
rerun. The run also found and fixed the new API's missing symbol-index entry and
macOS temporary-directory canonicalization in two packaging assertions.

## Live proof

The own-worktree `pnpm start:worktree` instance used server 19081, daemon 27081,
and data directory `~/.bb-dev/projects-bb-modal-v1-builds-46b99791639f`.
All CLI calls targeted that instance. Its public test tunnel supplied direct
machine access. Credentials were subshell-sourced from the authorized dotenv
file and never printed. The protected checkouts and default bb instance were
not mutated.

The local source was a real git/npm fixture with package.json and package-lock.json,
project `proj_xm67nwjzpw`, local thread `thr_syaakfdh8a`, environment
`env_sxuz8sqivk`, commit `d97da8312da2f4d40a21441830f616157f4b578b`.
The CLI inspected it, stored recipe `r_c23e8ff7-f8f2-471a-ae8f-51ccbe317267`,
and uploaded tracked files plus an explicitly reviewed lockfile overlay.
The recipe warmed an npm cache with `npm ci --ignore-scripts`.

| Phase | Measured time | Result |
| --- | ---: | --- |
| Inspect changed source | 0.579 s | Lockfile evidence and dirty path reported |
| Upload reviewed context | 0.981 s | Hash-validated context sealed |
| Corrected build, queued to ready | 50.034 s | Modal image build itself reported 45.04 s |
| Same inputs, new request key | 1.644 s | Same ready build, reused:true |
| Changed lockfile, queued to ready | 51.783 s | Different build and image; Modal reported 47.16 s |
| Allocate and enroll machine | 7.194 s | host_9kyg9vfx9h connected |
| Remove machine | 1.388 s | Core removal succeeded |
| GC mark | 2.273 s | All four test images marked, none deleted |
| GC delete after grace | 4.259 s | All four test images deleted |

Corrected images were `im-0er62KlzHS148wkL96l51m` and
`im-zXiiAIyp5zd0pcMg4Vfbar`. The connected machine used v4 pinned state and the
preinstalled `/usr/local/bin/bb`. A vendor exec probe returned exit 0, confirmed
`bb machine enroll --help`, and reported `no-agent-login-files`.
The baked package digest was
`3d11badeb298a9f78cb14b69f4ae3dc5c6dbf8f3520f1a21cf077db111fa26fe`,
version 0.42.1, daemon protocol 189.

The first live build exposed that the published npm bb-app 0.42.1 lacked the
branch's enrollment commands. The implementation now embeds the exact server's
credential-free host package. The initial machine-access failure also exposed a
pre-allocation reference leak; references now follow enrollment preparation and
absent-intent cleanup releases interrupted claims, covered by regression tests.
One old development-only reference was removed after core confirmed cleanup and
the vendor inventory confirmed zero sandboxes. Both early images were GC'd with
the corrected proof images.

## Cleanup

Dedicated Modal app: `bb-modal-v1-a-46b99791639f` (`ap-WN0pOiCgQRRLzb5WK2mBch`).
Starting inventory had no app, tags, or sandboxes. GC first proved the connected
machine's build was reference-protected. After removal and the grace interval,
all four owned images returned NotFound and sandbox listing was empty.
Modal retains tag tombstones and the empty app metadata; no live owned image or
sandbox remains. No private recovery snapshots were created. The shared registry
import cache was never claimed or deleted as an owned artifact.

Final CLI output:

```json
{"candidates":[],"blockedReferences":[]}
{"images":[],"nextCursor":null}
```

Raw evidence is preserved locally in `/tmp/modal-v1-live`: timing JSONL, build
state/event timings, probe result, connected resource, GC receipts and before/after
vendor inventory. The own dev instance and temporary tunnel were stopped.

## Remaining work

- **B:** readiness, pinned workspace setup/cache stamps, authenticated agent smoke,
  verification orchestration and project image promotion. A connected daemon alone
  is not an agent-ready claim.
- **C:** deadline observation, idle/retirement policy enforcement, drain/snapshot/
  restore maintenance and fencing. Stored policy fields are seams, not enforcement.
- **D:** settings editor/log viewer/launch inputs, full setup skill, estimates and
  end-to-end UI/CLI documentation and browser verification.

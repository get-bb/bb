# Repo Simplification Roadmap

Last updated: 2026-06-15 after checking `origin/main` at `ee9302837`.

This is the live remainder of the repo simplification work. The original audit
identified five root causes: contract change amplification, duplicated
frontend state, ownerless async lifecycle state, overgrown timeline
classification, and stale package/topology weight. A large part of that work is
already on `origin/main`; this file now tracks only the useful next steps.

## Landed On `origin/main`

- [x] **Dead feature cleanup.** Replay/capture plumbing and apps/workflow
      residue were removed.
- [x] **Contract de-amplification.** Route descriptors, split API files,
      desktop contract extraction, SDK type derivation, and host-daemon command
      descriptors landed in `edf67fdfd`.
- [x] **Typed route coverage.** File-content routes are in the public contract.
- [x] **Barrel and package-input cleanup.** Domain/contract barrels were
      reduced to structural exports, test alias mirroring was removed, and
      root Turbo inputs were deduped.
- [x] **Dead daemon file-write commands removed.** The old host file
      write/delete command surface is gone.
- [x] **Daemon runtime ownership.** Agent-runtime owns active turn/session
      state; RuntimeManager's parallel state copy and polling loop were
      removed in `89b6ce197`.
- [x] **Stale host daemon sessions.** Session reconnect/liveness handling
      improved in `7f25ea9aa`.
- [x] **Server-side execution defaults.** Composer/execution defaults now
      resolve primarily on the server side.
- [x] **Some frontend state cleanup.** Secondary-panel tab ownership was
      improved, but the larger frontend-state phase is not done.

## In Flight In PR #149

- [ ] **Lifecycle product simplification.**
      PR #149 removes `stopRequestedAt`, turns stop intent into the `stopping`
      thread status, removes `created`/thread `provisioning`, introduces
      environment `retiring`, removes `cleanupRequestedAt`, and regenerates the
      lifecycle diagrams from smaller product state machines.

Exit criteria for this item:

- PR #149 is merged.
- The final PR validation remains green:

```bash
pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/db --filter=@bb/server --filter=@bb/app --filter=@bb/cli
pnpm exec turbo run test --filter=@bb/domain --filter=@bb/db --filter=@bb/server --filter=@bb/app --filter=@bb/cli
```

- A follow-up pass either runs or explicitly defers the live dev-app smoke:
  stop mid-start, archive/unarchive, retiring follow-up revival, destroyed
  environment rejection.

## Remaining Work

### Phase 1: Lifecycle Recovery And Host Storage

- [ ] **Thread storage cleanup.** Restore the missing `thread.deleted` host
      cleanup path for per-thread storage directories. Prefer dispatch at
      delete time plus session-open reconciliation for historical leaks; do not
      add a new periodic sweep.
- [ ] **Recovery/backstop sweep shrink.** After PR #149 lands, audit
      `periodic-sweeps.ts` and remove lifecycle retry jobs now covered by
      status + reconnect reconciliation. Keep only real backstops, such as lost
      environment destroy results, where no self-settling event exists.
- [ ] **Reconnect reconciliation coverage.** Ensure daemon session open handles
      stopped/deleted/destroying state consistently for the connecting host.

Exit criteria:

- Deleted threads eventually remove host-local thread storage.
- The lifecycle retry sweep family is smaller than it was before PR #149.
- Recovery tests cover daemon reconnect after stop/delete/destroy interruption.

Validation:

```bash
pnpm exec turbo run test --filter=@bb/db --filter=@bb/server
pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/repo-roadmap-integration.txt 2>&1
```

### Phase 2: Package Topology And Shared Types

- [ ] **Package folds.** Re-evaluate and fold only packages whose boundaries
      are still dishonest after the contract work:
      `secret-storage`, `agent-providers`, `host-watcher`, `host-workspace`,
      and any remaining single-consumer utility packages.
- [ ] **Shared wire records.** Move truly shared host/workspace/provider record
      shapes to the package that owns the concept instead of maintaining
      parallel server/daemon shapes.
- [ ] **Utility consolidation.** Merge duplicate helpers such as `assertNever`,
      sleep/delay wrappers, retry helpers, and process-spawn wrappers.
- [ ] **Rename or fold `core-ui`.** It mostly owns cross-surface formatting,
      not UI primitives.

Exit criteria:

- Package count drops only where ownership is clearer, not just lower.
- No package remains solely because of historical placement.
- New shared shapes have one source of truth.

Validation:

```bash
pnpm exec turbo run typecheck build test
```

### Phase 3: Daemon Command And Runtime Surface

- [ ] **Command floor audit.** For each host-daemon command, decide whether it
      is a real host-local primitive or server policy leaking across the
      boundary.
- [ ] **Lanes as data.** Use the command descriptor metadata to declare
      provider/env/serial/barrier lane requirements, then collapse the
      hand-rolled lane variants into one keyed-lock utility.
- [ ] **Runtime singleton cleanup.** Merge remaining ownerless maintenance
      runtimes and remove CWD-as-workspace leakage.
- [ ] **Daemon-side product defaults.** Remove fallback policy defaults such as
      `permissionMode ?? "default"` from daemon/runtime code; the server should
      send explicit policy.

Exit criteria:

- Adding a daemon command requires one descriptor edit.
- No command silently runs without an intentional lane choice.
- Product defaults are required at the server/daemon boundary.

Validation:

```bash
pnpm exec turbo run typecheck --filter=@bb/host-daemon-contract --filter=@bb/host-daemon --filter=@bb/agent-runtime
pnpm exec turbo run test --filter=@bb/host-daemon-contract --filter=@bb/host-daemon --filter=@bb/agent-runtime
```

### Phase 4: Timeline Pipeline

- [ ] **Collapse timeline representations.** Reduce the pipeline to one
      provider-neutral event-to-row builder plus app rendering/layout.
- [ ] **Event taxonomy as data.** Classify provider event kinds through an
      explicit table; unknown provider noise should not render as user-visible
      errors.
- [ ] **Stable row caching.** Cache by stable row id instead of whole
      `TimelineRow[]` array identity.
- [ ] **Story fixtures from real events.** Replace hand-built projected shapes
      with event fixtures that flow through the builder.
- [ ] **Scroll ownership.** Keep one scroll restoration writer around async
      mutations.

Exit criteria:

- Adding a tool/event kind touches one timeline module.
- The timeline has two conceptual stages: event enrichment and rendering.
- Unknown provider events are quiet by default and observable in logs/tests.

Validation:

```bash
pnpm exec turbo run test --filter=@bb/thread-view --filter=@bb/app
```

Manual QA should cover a long real timeline, live streaming, load-older
pagination, approvals, delegation rows, background tasks, and tool output.

### Phase 5: Frontend State Simplification

- [ ] **One secondary-panel state owner.** Finish consolidating panel/tab state,
      including browser-view ownership, URL projection, and persisted state.
- [ ] **Hints-only realtime.** Replace broad cache mirroring with small change
      hints plus canonical query refetches. Keep surgical cache writes only
      where measured latency requires them.
- [ ] **Shrink god components.** Split `ThreadDetailView` and promptbox
      internals into layout/routing shells plus focused modules.
- [ ] **Co-locate fetcher/key/hook.** Make a new endpoint one domain-module
      edit instead of an API/query-key/hook/cache-registry chain.

Exit criteria:

- `setQueryData` is rare and documented.
- Panel state has one canonical owner.
- `ThreadDetailView` is a layout/routing component, not a workflow owner.

Validation:

```bash
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run test --filter=@bb/app
```

Manual QA should cover browser tabs, file/diff tabs, thread switches, reloads,
load-older timeline, and rapid realtime updates.

### Phase 6: Guardrails

- [ ] **Generated artifacts enforced.** CI regenerates generated files and
      fails on diff.
- [ ] **Dead-code gate.** Add a repo-wide dead export/import check such as
      knip, with an explicit allowlist.
- [ ] **Dependency catalog.** Move common dependency versions into a pnpm
      catalog.
- [ ] **Layout primitive.** Centralize chrome/panel/header spacing so inset
      fixes do not repeat per surface.
- [ ] **`bb-app` package honesty.** Declare real workspace dependencies, move
      packaging out of `packages/` if appropriate, and split launcher code.

Exit criteria:

- CI catches stale generated artifacts and dead exports.
- Package dependency ownership is visible in package manifests.
- Shared app chrome has one primitive path.

Validation:

```bash
pnpm exec turbo run typecheck build test
```

## Roadmap Maintenance

Delete this file once the remaining phases are complete or superseded. When
updating it, verify current repo state with `git grep` or `rg`; do not preserve
old audit claims just because they were true on 2026-06-11.

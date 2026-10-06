---
name: test-audit
description: "Gate new or changed tests, and audit existing tests for low value, implementation coupling, duplication, and the test-only production seams they keep alive. Use when writing, changing, reviewing, or sweeping tests."
---

# Test Audit

Three modes, one value bar. Authoring mode gates every new or changed test at
write time. Audit mode runs focused sweeps of tests that re-assert source,
duplicate stronger proof, couple behavior to implementation, or keep test-only
production seams alive. Continue broad audits as separate coherent follow-up
PRs; optimize for confidence, not deletion count. Campaign mode prunes one
whole subsystem's test surface (every test file a plugin, app, or package
owns); before starting one, read [CAMPAIGN.md](CAMPAIGN.md).

## Authoring gate

Before adding any test, answer four questions; a missing answer means do not
add it yet:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch that failure? Each contract has
   one primary test owner at the strongest boundary; another layer needs its
   own distinct risk, such as a transport or lifecycle failure the owner cannot
   reach. Prefer extending a table-driven case or shared fixture over a
   near-duplicate test; consolidate duplicated setup in the same change.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no
   production caller needs? If yes, move the test to the real boundary instead.

Then check the test against every [junk pattern](#junk-patterns); a match fails
the gate unless the [retention bar](#retention-bar) names the contract it
independently guards. A test that would break under behavior-preserving
refactoring is asserting implementation, not behavior; rewrite it at the
owning boundary before landing it.

Bug regression tests must fail on the pre-fix code for the intended reason and
pass after the owner-boundary repair. A regression test that never demonstrably
failed proves the mock, not the fix. One regression at the owner boundary
covers the bug; do not replay the same scenario at every layer it crosses.

bb test rules: never mock the database; use `createConnection(":memory:")`
and `migrate(db)` from `@bb/db`. Vitest projects come from
`sharedWorkerProjects` in `vitest.shared.ts`: Node test files share workers
(`isolate: false`), and files that use `vi.mock`, `vi.stubGlobal`, fake timers,
`process.env` writes, or global assignments are isolated automatically.
Restore any other global state a test changes. Tests follow the no-comments
rule.

## Junk patterns

The shared checklist for both modes: the authoring gate rejects a new test that
matches one, and audits hunt for existing tests that do.

- assertion-free coverage probes;
- self-comparisons and identity copiers;
- copied fixtures, inventories, manifests, or export lists;
- exact source, import, or string greps;
- private predicate or call-shape tests duplicated at real boundaries;
- duplicate invocations of the same contract;
- provider-local replays of shared helpers;
- tests whose only purpose is preserving test-only exports, globals, or wrappers;
- dead production code whose only callers are tests;
- expected values produced by the helper or renderer under test;
- mocks that implement the asserted behavior, or one identical mock standing in
  for different APIs;
- fakes that skip the real code they front, such as a hand-rolled `bb` stub or
  fake provider that never loads the real plugin entry, bridge, or extension;
- fixtures that supply the receipt, admission, or callback ordering the owner
  should produce, or persistence asserted against a store the path never writes;
- capability tests that restate declared flags instead of exercising the
  delivery or acknowledgement the flag promises;
- negative controls that pass for an unrelated reason, such as a denial from a
  different guard or a rejection the production path never reaches;
- names or fixtures that promise more than the input exercises, such as a
  "retires the window" test asserting the window was not cleared.

## Value bar

Tests justify their maintenance cost by protecting behavior, a credible
regression, or an independently meaningful contract. In an audit, an existing
test that must change for behavior-preserving source reorganization is suspect,
not automatically deletable; the authoring gate still rejects new ones.

Before judging a candidate, read the complete test and production owner, its
entry point, callers, callees, sibling implementations, overlapping tests, CI
routing (`turbo.json` task inputs and `.github/workflows/ci.yml` shards), and
relevant history. Read `AGENTS.md` first. When the test claims
dependency-backed behavior, inspect the dependency source or types directly.

## Discovery

Keep discovery read-only and report evidence before editing. For broad scope,
run parallel discovery lanes when available:

- app UI: `apps/app` (the largest suite), `apps/web`, `apps/mobile`,
  `apps/desktop`, `packages/thread-view`, `packages/client-core`;
- server and data: `apps/server`, `packages/db`, `packages/domain`;
- host and runtime: `apps/host-daemon`, `packages/agent-runtime`,
  `packages/provider-bridge-*`, `packages/host-*`;
- plugins and SDK: `plugins/` (built-in and `provider-*` plugins),
  `packages/plugin-sdk`, `packages/plugin-build`;
- CLI, tooling, and end to end: `apps/cli`, `packages/sdk`, `packages/scripts`,
  `packages/bb-app`, `tests/integration`;
- a cross-cutting pattern sweep.

Outside campaign mode, prefer a few high-confidence candidates over a large
speculative inventory. Hunt for the [junk patterns](#junk-patterns).

## Retention bar

Keep a test when it independently enforces a public API, Plugin SDK, protocol,
config, migration, storage, security, platform, default, prompt-byte, generated
cross-language, package, release, or architecture contract. In bb that
includes server/daemon wire shapes behind `HOST_DAEMON_PROTOCOL_VERSION`
(`packages/host-daemon-contract/src/protocol.ts`) and Plugin Guide surfaces and
anchors (`plugins/plugin-api-docs/src/surfaces.ts`, `anatomy-manifest.json`).
Also keep:

- call ordering when order is observable behavior;
- regressions with a credible failure mode;
- source inspection when it is the cheapest independent guard: it fails when
  the contract changes (the user-facing key, byte, or path) and survives an
  identifier-only refactor;
- a retained test that fails on the baseline: treat it as a possible product
  bug, reproduce it, and repair the owner rather than deleting it.

Static or slow is not a deletion reason. A test that resembles implementation
may still be the independent contract; prove otherwise before removing it.

An unprefixed export of a published `@get-bb/plugin-sdk` subpath is public API,
not a test-only seam, even with zero in-repo consumers. Removing one needs an
entry under "Scheduled removals (next major)" in `docs/api_to_audit.md`.

Provider event shapes and timeline rows are owned by the recorded parity
conformance (`packages/provider-parity`, recordings in
`packages/provider-bridge-protocol/recordings/`) and the provider corpus gates
(`apps/server/test/provider-corpus/`). A plugin test that replays a recorded
case is a candidate; one covering a case recordings cannot capture is not.

## Candidate evidence

Record every field below before editing. A missing field means the candidate is
not ready for deletion:

- exact test name and location;
- what failure it can actually detect;
- non-test callers of the covered production or support seam;
- stronger remaining owner-boundary proof, or why no proof is needed;
- relevant history and the reason the test or seam exists;
- production or test-support deletion unlocked;
- risk and the focused validation command.

## Edit shape

Choose one coherent owner-boundary batch. Delete obsolete test-only exports,
globals, wrappers, and dead production paths instead of preserving aliases.
Move retained regressions to their canonical owners. Consolidate repeated
package or dependency assertions into one generic contract.

Prefer net-negative production LOC. Do not add replacement tests that restate
the same implementation, and do not convert uncertain candidates into cleanup
to increase deletion counts. Generated modules (`packages/templates/src/generated/`,
`packages/plugin-build/src/generated/`, `packages/plugin-sdk/bundled-types/`)
are gitignored; never commit them or add a `--check` mode to guard them.

## Validation

Never edit source or tests while Vitest is running in the checkout. Never run
`git checkout <rev> -- .` for a baseline in a checkout with uncommitted edits;
it overwrites them. Commit a WIP first, then compare through
`git worktree add --detach <dir> <rev>` or `git show <rev>:<path>`.

1. Run the smallest owner and sibling tests through Turbo. Arguments after `--`
   go to `vitest run`; paths are relative to the package directory. Plugin
   packages are named `bb-plugin-<id>`. Pipe slow output to a file:
   `pnpm exec turbo run test --filter=@bb/server -- test/<file>.test.ts -t "<name>" > /tmp/test.log 2>&1`.
2. `turbo run test` skips some suites; when a touched test or its owner
   belongs to one, run it too (list them with
   `rg -n '^\s*"(@bb/[a-z-]+#)?(test|smoke)[a-z:_-]*"\s*:' turbo.json`).
   Suites that need credentials must still pass setup and discovery; see
   `docs/debugging-and-qa.md` for corpus and parity inputs.
   - `packages/agent-runtime/src/integration*.test.ts`:
     `pnpm exec turbo run test:integration --filter=@bb/agent-runtime`;
   - `tests/integration/real/`:
     `pnpm exec turbo run test:integration --filter=@bb/integration-tests`;
   - `apps/server/test/provider-corpus/` (skips without `BB_PROVIDER_CORPUS_DIR`):
     `pnpm exec turbo run test:provider-corpus --filter=@bb/server`;
   - provider bridges: `pnpm parity --old <before-worktree> --new .`;
   - packaging: `pnpm exec turbo run smoke:tarball --filter=bb-app`, and the
     `@bb/desktop` `smoke:*` tasks.
3. For removed source greps or plan assertions, run the executable script or
   dry-run that owns the real contract.
4. Run `pnpm exec oxfmt <changed-paths>`, then
   `pnpm exec turbo run lint typecheck --filter=<pkg>`, then `git diff --check`.
5. Rule out environment-only failures before calling a baseline failure a
   product bug: `apps/server/test/internal/internal-skill-trees.test.ts`
   fails under umask 0002, and `apps/host-daemon/src/command-discovery.test.ts`
   and `plugins/provider-acp/src/native-roots/native-roots.test.ts` fail when
   `/tmp/.agents` or `~/.agents` exists. Turbo drops `TMPDIR`, so after a Turbo
   run has built dependencies, rerun those with
   `TMPDIR=/var/tmp/<dir> pnpm --filter <pkg> exec vitest run --config vitest.config.ts <file>`.
6. For every removed or merged test, prove no coverage was lost: write the bug
   it caught as a mutation of the production owner, confirm it fails the old
   test in a before-worktree and at least one keeper in the after-worktree,
   then restore the source byte for byte. A past cleanup lost 19 real
   assertions despite the author's own mutation checks, so have an independent
   agent run this. Use `--concurrency=1` when the machine is loaded.
7. Inspect `git diff --numstat`; report production/tooling separately from
   tests and test support.
8. After final audit edits, review the diff against `docs/CODE_REVIEW.md`
   (for example with `/code-review`) and run the `deslop` skill.

## Landing and continuation

Commit, push, open a PR, or land only when authorized. Fill
`.github/PULL_REQUEST_TEMPLATE.md` and end the body with `> AGENT GENERATED`.
Use the `close-out` skill to land when it is available. Land one coherent PR
at a time; after landing, refresh from current `main` and rerun read-only
discovery for the next high-confidence batch.

## Handoff

Report:

- root cause and removed low-value categories;
- production owner simplifications;
- retained false positives and why they remain valuable;
- focused and full proof actually run, including off-pipeline suites;
- production versus test LOC;
- PR and merge state;
- named follow-ups.

# Provision, claim, spawn, and reconcile

Status: local unpublished candidate for independent review.

This change was prepared from upstream commit
`b9fdeece5de171ea28c5f60566c596617f46ee88` on branch
`df80-provision-claim-spawn-reconcile`. It has not been pushed, installed, or
used against a live BB server, provider, controller, campaign, or task.

The first frozen candidate at `87641123135e78af33387913b3f2353af59185c8`
was rejected by Dark Factory commit `0a4f4cc`; report SHA-256
`147aebb842e845415f13e7727be8aa5e46ebccd904a7e011ce242edd70dfa611`.
This correction keeps that counterexample as RED evidence. It adds exact
persisted-environment validation, replaces the caller-selected claim method
with a factory-registered installed-artifact capability, closes the V2 and
Unicode canonicalization boundary, removes the pre-claim `claiming` row, and
adds file-backed restart and public end-to-end coverage.

## Root cause

BB could create a non-worktree environment only as part of thread creation, so
an external controller could not bind a stable environment identity before
authorizing a spawn. The plugin API also separated authorization from
`threads.spawn`; a caller could validate request `R` and then deliver a
different request `R'`, or repeat delivery after losing the first response.

## Change

`POST /api/v1/environment-provisions`, the SDK, and
`bb environment provision` now attach one exact existing project source without
creating a thread or starting a provider. A stable request id and request digest
are stored on the environment. Exact concurrent or restarted replay returns the
same environment identity; a changed request refuses.

`bb.experimental_effects.experimental_spawnClaimed` now owns the effect
boundary. BB canonicalizes the complete attributed SDK request, persists the
claim and attempt identities, and invokes the plugin's factory-registered method
from the currently installed host artifact. Only a strict claim response
containing the same authority, authorization, claim, attempt, and request digest
permits that exact in-memory request to reach `threads.spawn`. Authorization
ids, attempt ids, and claim ids are durable uniqueness fences.

Before delivery, BB writes `delivering`. A created thread carries a reserved
claim marker in plugin metadata. After a lost response or restart, BB recovers
an exact thread with that marker and matching project, environment, and provider.
If no such result is provable, or the returned binding differs, the durable
result is `delivery_uncertain`; replay never resends it.

The exact ready provision row is checked before the authority call, again in
the claim-persistence transaction, again in the delivery transaction, and after
a returned or recovered thread. A stale or foreign environment can therefore
neither create a local claim nor become a completed result.

## Authority and exactly-once boundary

A digest supplied by the caller is not authorization. The server computes the
digest itself and obtains the claim through the installed plugin host artifact
on the requested connected host. The returned object is schema-checked and
must match the server's identities, including the caller-named controller
authorization id. A replay refusal is typed and creates no local row. Fresh
task, dependency, flow, directive, Factory, route, and authorization checks
remain the controller's responsibility inside that current host call.

BB guarantees one durable delivery intent and no automatic resend after an
unknown external result. It does not claim exactly one provider process start:
that stronger guarantee requires the receiving provider boundary to consume an
idempotency key. A transport loss without a durable BB thread remains
`delivery_uncertain`.

## Acceptance-vector binding

The implementation is bound to Outcome Forge commit
`0ba9e61137f9b36f31cf4db7b099520a452d7cec`, aggregate
`02274af3eda00c5b9ac3c1573051066aade9e40157a5b05b759cd43ee327dec0`.
Its fixture contains 8 invariants, 28 vectors, and 14 success/recovery pairs:
27 require a platform boundary and `A02_COOPERATIVE_DIGEST_CONTROL` is the one
deliberately inadequate cooperative control.

| Vectors                                         | Measurable implementation oracle                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `P01`, `P02`, `P03`, `P04`, `P05`, `P06`, `X01` | one provision request row and environment id; exact concurrent/restart replay; changed request and worktree refusal; no thread/provider effect |
| `C01`, `C02`, `C03`, `C04`, `I01`, `I02`, `U01` | current registered installed-host call; typed replay refusal; exact authority and authorization; no row or spawn before a fresh matching claim |
| `S01`, `S03`, `S05`, `S06`, `A01`               | persisted claim then persisted delivery boundary; process-local coalescing plus database uniqueness; changed request refuses                   |
| `S02`, `S04`, `R01`, `R02`, `X02`               | reserved durable thread marker recovers a matching thread; completed replay returns the same result                                            |
| `R03`, `R04`, `U02`                             | project/environment/provider mismatch or unprovable response becomes stable `delivery_uncertain`; no resend                                    |
| `A02`                                           | remains a negative control: caller-local hashing alone is not accepted as authority                                                            |

One running-server test composes the real public provision HTTP route, the
registered plugin host-RPC claim, the loopback SDK thread route, and durable
completed replay against the same migrated SQLite store. Separate file-backed
SQLite restart tests close and reopen the database across every durable state;
they do not simulate a new OS process. Host commands and provider delivery use
isolated captures and doubles, and no real provider is contacted.

## TDD and verification

The public environment tests were first run without the route and failed. The
plugin test was first run without `experimental_effects` and failed. The
implementations were added only after those RED observations. Generated Drizzle
migrations were produced from the schema rather than edited by hand.

Verification after the independent rejection and correction:

- server public environment, response, registered-authority, public composition,
  file-backed recovery, and authoring documentation: 101 tests passed;
- full DB suite: 520 tests passed across 40 files;
- server contract: 79 tests passed;
- public SDK: 112 tests passed;
- plugin SDK: 277 tests passed;
- plugin API map: 72 tests passed;
- CLI: 609 tests passed;
- Turbo typechecks: 13 tasks passed across the 8 affected package scopes;
- Turbo builds: 9 tasks passed for server, CLI, SDK, and plugin SDK;
- `git diff --check`: passed.

The 21 changed paths other than `packages/db/test/migrate.test.ts` pass targeted
`oxfmt`. That migration harness file retains its pre-existing whole-file format;
formatting it would create unrelated churn. A direct `oxfmt --check` therefore
still reports that one file. The repository-wide `pnpm format:check` remains red
on 231 pre-existing paths outside this change.

A full `@bb/server` test run was also attempted: 2,649 tests passed and 53
failed for host-test infrastructure reasons outside this fence. The failures
were dominated by a percent-encoded checkout path passed to shell fixtures,
an unwritable existing npm cache, and the process file-watcher limit. The five
focused server files were then rerun alone and passed 101/101. The full-suite
failures are not waived release checks; they remain an upstream release-gate
gap for a normal checkout and test environment.

The tests exercise migrated in-memory and temporary file-backed stores, an
in-process loopback BB server, host-command captures, and provider doubles. No
test contacted an installed BB server, external controller, or provider.

## Release boundary

This candidate adds an experimental plugin API and a public HTTP/SDK/CLI
surface. It requires independent source review, normal upstream acceptance, a
released BB build, and an isolated canary before any controller flow can consume
it. It grants no authority to resume DF-74.

The related Factory diagnostic-retention audit is bound separately at commit
`20e8923` and report SHA-256
`210230d734f2feb844a5b397b58faa31cce154349f83132288a9c11c196ee93d`.
Its mandatory private diagnostic root and bounded-retention patch is future
Factory hardening, not a prerequisite or hidden part of this BB change.

# Provision, claim, spawn, and reconcile

Status: local unpublished candidate for independent review.

This change was prepared from upstream commit
`b9fdeece5de171ea28c5f60566c596617f46ee88` on branch
`df80-provision-claim-spawn-reconcile`. It has not been pushed, installed, or
used against a live BB server, provider, controller, campaign, or task.

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
claim and attempt identities, and invokes the plugin's currently installed host
artifact. Only a strict claim response containing the same claim, attempt, and
request digest permits that exact in-memory request to reach `threads.spawn`.
Authorization ids, attempt ids, and claim ids are durable uniqueness fences.

Before delivery, BB writes `delivering`. A created thread carries a reserved
claim marker in plugin metadata. After a lost response or restart, BB recovers
an exact thread with that marker and matching project, environment, and provider.
If no such result is provable, or the returned binding differs, the durable
result is `delivery_uncertain`; replay never resends it.

## Authority and exactly-once boundary

A digest supplied by the caller is not authorization. The server computes the
digest itself and obtains the claim through the installed plugin host artifact
on the requested connected host. The returned object is schema-checked and
must match the server's identities. Fresh task, dependency, flow, directive,
Factory, route, and authorization checks remain the controller's responsibility
inside that current host call.

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
| `C01`, `C02`, `C03`, `C04`, `I01`, `I02`, `U01` | current installed host call; strict matching result; unique claim/attempt/authorization; no spawn before a matching claim                      |
| `S01`, `S03`, `S05`, `S06`, `A01`               | persisted claim then persisted delivery boundary; one in-process operation; exact request digest; changed request refuses                      |
| `S02`, `S04`, `R01`, `R02`, `X02`               | reserved durable thread marker recovers a matching thread; completed replay returns the same result                                            |
| `R03`, `R04`, `U02`                             | project/environment/provider mismatch or unprovable response becomes stable `delivery_uncertain`; no resend                                    |
| `A02`                                           | remains a negative control: caller-local hashing alone is not accepted as authority                                                            |

The public-boundary tests use in-memory migrated SQLite stores, host-command
captures, and provider transport doubles. They do not contact a real provider.

## TDD and verification

The public environment tests were first run without the route and failed. The
plugin test was first run without `experimental_effects` and failed. The
implementations were added only after those RED observations. Generated Drizzle
migrations were produced from the schema rather than edited by hand.

Final focused verification on the candidate:

- server public environment, recovery, response, claimed-spawn, and authoring
  documentation: 82 tests passed;
- DB migrations and environment/metadata data access: 32 tests passed;
- public SDK: 61 tests passed;
- CLI environment command: 36 tests passed;
- plugin SDK public types: 6 tests passed;
- Turbo typechecks: 12 tasks passed across the 7 affected package scopes;
- Turbo builds: 9 tasks passed across server, CLI, SDK, and plugin SDK;
- `git diff --check`: passed.

All changed paths pass `oxfmt`. The repository-wide `pnpm format:check` remains
red on 231 pre-existing paths outside this change; none of this candidate's
paths appears in that output.

The tests exercise only migrated in-memory stores, host-command captures, and
provider doubles. No test contacted a live BB server, controller, or provider.

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

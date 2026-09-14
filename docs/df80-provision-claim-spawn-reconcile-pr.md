## Human comments

## What was wrong

BB could not provision a stable unmanaged environment identity without also
creating a thread. The first claimed-spawn implementation then trusted a
caller-selected host RPC contract, did not prove that the requested environment
still matched its durable provision record, and could leave an ambiguous local
state around process loss. That meant a controller could not authorize one
fully bound request at the actual effect boundary.

## What changed

- Add replay-safe `POST /api/v1/environment-provisions`, SDK, and
  `bb environment provision` surfaces. The result exposes the stable request id
  and server-computed request digest without creating a thread or provider.
- Add factory-time `experimental_registerClaimAuthority` and closed V2
  `experimental_spawnClaimed` plugin APIs. The server fixes the installed host
  artifact, host, contract, and method before handlers can request an effect,
  and requires the exact controller authorization identity in the claim result.
- Validate the exact ready, unmanaged, non-worktree provision record before the
  current claim, in claim persistence, in the delivery transaction, and after a
  returned or recovered thread.
- Persist the canonical environment-binding bytes and digest with the claim,
  then refuse a coherent A-to-B row/binding change before claimed or delivering
  resume can recover or spawn.
- Canonicalize the complete attributed request with the RFC 8785 rules relevant
  to its closed string/null shape. Unknown fields, `undefined`, invalid Unicode,
  stale bindings, and mismatched claim receipts fail closed.
- Persist claim, attempt, authorization, delivery intent, and terminal result.
  File-backed restart tests cover interruption before delivery, possible
  delivery with and without a recoverable thread, stale identity, and stable
  uncertainty without redelivery.
- Compose the public provision route, installed host claim, loopback SDK spawn,
  and durable replay in one running-server acceptance test.
- Decode the install-machine fixture URL before passing it to `sh`, and give the
  composed machine-lifecycle integration chain explicit local observation and
  whole-case budgets so host scheduling cannot leak unfinished work.
- Document the experimental API in the Plugin Guide and API audit map. This is
  a server/API change only; `HOST_DAEMON_PROTOCOL_VERSION` is unchanged because
  no server/daemon command or result shape changed.

The boundary guarantees one durable BB delivery intent and no automatic resend
after an unknown result. It deliberately does not claim exactly one provider
process start without receiver-side idempotency.

## How you verified

The new public environment, registered-authority, stale-environment, strict V2,
and file-backed recovery tests were observed failing before their corresponding
implementation changes and passing afterward. The public composition test also
failed first at its host binding and RPC result boundaries, then passed through
the real HTTP and SDK surfaces. Verification uses migrated isolated databases,
an in-process loopback server, captured host commands, and provider doubles; it
does not contact an installed server, controller, or provider.

- `pnpm exec turbo run test --filter=@bb/server -- --run test/public/public-environments.test.ts test/services/plugins/plugin-sdk.test.ts test/services/plugins/claimed-thread-spawn-recovery.test.ts`
- affected DB, SDK, CLI, plugin SDK, API-map, template, and server tests
- Turbo typechecks for every affected package
- full `@bb/server` Turbo suite with isolated external tmp/npm cache,
  concurrency 2, and Vitest `--maxWorkers=2`: 9/9 tasks, 265 files passed,
  3 skipped, 2,704 tests passed, 1 skipped, 0 failed in 2m44.412s; retained log
  SHA-256 `99ea8b0da7cfca5b799bceb8b28bfe8a39a943a90fb54df79ccc90f92ae8049c`
- `pnpm exec oxfmt --check` on every changed source, test, and document
- `git diff --check`

Fixes #

> AGENT GENERATED

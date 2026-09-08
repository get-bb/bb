---
name: modal-catalogue
description: Inspect project inputs, store Dockerfile recipes, and explicitly build or manage Modal images through bb modal.
---

# Modal recipe catalogue

Recipes are stored per server owner/project in plugin SQLite, never in the repo.
All commands accept `--json`; CLI and SDK use the typed `modalRpcContract` in
`catalogue/contract.ts` through the existing plugin RPC transport.

- `bb modal project inspect --project X --environment E --json` reads facts,
  lockfiles and hooks without running project scripts.
- `bb modal recipe put --project X --stdin --expected-revision N --json` reads
  a literal Dockerfile or a JSON envelope with `dockerfileText`, `setupScriptText`,
  `contextRules:{include:[],exclude:[]}`, and `smoke:{commands:[],timeoutSeconds:120}`.
  Start at revision 0. Save conflicts report HTTP 409 and the latest revision.
- `bb modal recipe show --project X --json`; `recipe list --cursor ID --limit 50 --json`.
- `bb modal context upload --project X --environment E --recipe R --revision N --json`
  transfers files from E's host. Use `--reviewed-dirty-json '["path"]'` with the
  exact dirty-path list returned by inspect. Review the contents first. Contexts
  contain tracked files at the recorded commit plus this reviewed overlay;
  secrets, caches, `.git`, and `.worktreeinclude` matches are excluded.
  Explicit include rules are required to transfer files. Archives are capped at
  256 MiB, validated in bounded chunks, and expire after 24 hours.
- `bb modal image build --project X --recipe R --revision N --context C --key K --json`
  starts a durable build. Identical inputs reuse a build. Keys cannot change
  payload. Builds are explicit and serialized per Modal account.
- `bb modal image logs B --follow --cursor 0 --json` streams JSON event pages.
  Retention is 10 MiB; truncation is explicit and cursors remain monotonic.
- `bb modal image status B --json`; `image cancel B --json`. Cancelling a running
  build requests cancellation; it does not claim Modal terminated it. Stopping
  log following never cancels a shared build.
- `bb modal image list --project X --json`; `image gc --dry-run --json` previews
  candidates. `image gc --apply --json` marks unused images; after a one-minute
  grace, run it again to delete. Project pointers, verification and machine
  references prevent deletion. Recovery snapshots are excluded.
- `bb modal project configure --project X --expected-revision N --json-input
'{"resources":{"cpuCores":1,"memoryMiB":4096},"policy":{"idleMinutes":15,"lifetimeMinutes":1440,"retentionDays":30}}' --json`.
- `bb modal project show --project X --json` reports configuration and staleness.
  Inspect again to refresh lockfile evidence. Staleness never starts a build.

The versioned base includes Node 22.19.0, Debian bookworm, npm, build tools, bb,
Codex and Claude Code. Its credential-free provenance is in
`/opt/bb-project/base-manifest.json`; the exact server bb package SHA-256 and
daemon protocol version are in `/opt/bb-project/image-manifest.json`. Project Dockerfiles support RUN, COPY,
ENV, WORKDIR and ARG. FROM is supplied by bb. Other instructions, heredocs,
flags, symlinks, submodules and LFS contexts are rejected with actionable errors.
COPY supports literal regular-file paths; use JSON syntax for spaces.
Never include enrollment, server URLs, provider credentials or runtime secrets.

New machines accept `--machine-inputs '{"buildId":"B"}'` with an explicit ready
build for the project. They pin image/account/app/resources/policy in v4 state.
Verification/promotion, readiness setup, lifecycle enforcement and the Settings
editor are subsequent implementation parts; stored smoke/setup/policy fields
are their durable inputs, not evidence that readiness has passed.

SDK callers import `modalRpcContract` from the plugin and call
`bb.sdk.plugins.callRpc({pluginId:"environment-modal-sandbox", method:"build.get",
input:{buildId}, outputSchema:modalRpcContract["build.get"].output})`.
The RPC method names are `project.inspect`, `recipe.put/get/list`,
`context.prepare/upload/complete`, `build.start/events/get/cancel`, `image.list/gc`,
and `project.configure/show`. Context upload tokens are scoped transport credentials
and never part of reusable image provenance.

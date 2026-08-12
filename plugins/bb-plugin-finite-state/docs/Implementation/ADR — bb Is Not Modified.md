# ADR — bb is not modified; Finite State ships as a plugin

*Status: accepted, 2026-08-12. Owner: Matt Wyckhouse. Supersedes the parts of
`IMPLEMENTATION PLAN — Master.md` §1 that treat the bb fork as a product
artifact.*

---

## Decision

**We do not modify bb. The Finite State product ships as an ordinary bb plugin
and installs the way any third-party plugin installs.**

The fork at `mattwyckhouse/bb` is a **disposable development container**. It
exists for workspace resolution, the `@bb/plugin-sdk/testing` harness, and
`plugins/tasks` as a reference implementation. It is not something we ship,
and it is not something we change.

## Context

The master plan chose to fork the bb monorepo and develop at
`plugins/bb-plugin-finite-state/`. The stated reasons were workspace
resolution, no dev build step, direct `@bb/shared-ui` imports, an in-tree
reference implementation, a wired test harness, and *"SDK changes (we will need
some)"*.

By the end of the first build day, that last reason had not materialised, and
the fork's cost had. An audit of every out-of-plugin change showed **not one was
a bb capability the product required**:

| Change | Actual reason |
|---|---|
| `.nvmrc`, `.bb-env-setup.sh` | Node pinning for the fork's worktrees |
| FS-90: `.node-version`, root `package.json`, `check-node-version.mjs`, three test files, `docs/platform-support.md`, **six GitHub workflow files** | Node pin and CI *for the fork* |
| `.bb/workflows/*` | Build orchestration we introduced, then quarantined |
| WP-02: `builtin-registry.ts` | Only needed to ship as an *official bundled* plugin |

Every one is overhead created by living inside the fork. None is a capability
the plugin needs.

The measured coupling to the monorepo is also small: 31 imports of
`@bb/plugin-sdk`, one import of `@bb/domain` in a single test, and **zero**
`@bb/shared-ui`. `@bb/plugin-build` and `@bb/tsconfig` are replaceable by
`bb plugin build` with a `bb-app` devDependency and a local tsconfig.

The decisive case was FS-95. It proposed adding per-agent capability
boundaries, a readiness hook, and an environment mutex to `plugins/workflows` —
the first genuine bb-core modification in the program. Its only purpose was to
un-quarantine a saved-workflow factory we had introduced ourselves. The product
never required it.

## What follows from this

1. **The plugin installs as a plugin.** `bb plugin install <path>` and
   `bb plugin dev` are the loop. A path install loads TypeScript directly with
   no build step, exactly as any third-party plugin does.
2. **No builtin registration.** Bundling into bb's builtin registry is what
   converts "a plugin" into "a modified bb that we ship." That is a BB release
   decision, not part of authoring this product, and it is out of scope unless
   BB adopts the plugin officially.
3. **A required bb change is a design smell, not a work item.** If a capability
   appears to need a bb modification, the design is wrong. Find the
   plugin-level solution, or drop the capability. Do not open a task to change
   bb.
4. **CI needs no fork.** `bb-app` is published on npm at the pinned release, and
   `bb plugin build` needs no server. A test instance can run from a plain
   read-only bb checkout.
5. **Extraction stays cheap and is the expected end state.** With bb-core
   changes at zero, the fork delta reduces to Node and CI pinning.
   `FORK-DELTA.md` keeps the extraction path honest.

## Consequences

**Cancelled by this ADR:** FS-95 and its lanes FS-95a/b/c/d (tasks FS-95,
FS-96, FS-97, FS-98, FS-99). The saved-workflow factory under `.bb/workflows/`
is removed with them; it was quarantined and never ran.

**Deferred:** WP-02 builtin registration, pending a BB product decision that is
not ours to make.

**Retained:** the fork as a development container, and the existing
`FORK-DELTA.md` entries for Node and CI pinning, which are development-
environment concerns rather than product changes.

**Accepted cost:** orchestration stays manual — the coordinator dispatches
through Tasks and explicit review threads. Measurement on 2026-08-12 supports
this: dispatch *latency* was the bottleneck, not the absence of automation, and
nine dependency-complete packages sitting unpromoted cost far more than any
workflow engine would have saved.

## The rule, stated for agents

> Everything we build lives under `plugins/bb-plugin-finite-state/`. Changes
> outside it are limited to development-environment concerns already recorded in
> `FORK-DELTA.md`. **No work package may modify bb's source, its builtin
> plugins, or its builtin registry.** If you believe you need to, stop and
> report it as a design problem.

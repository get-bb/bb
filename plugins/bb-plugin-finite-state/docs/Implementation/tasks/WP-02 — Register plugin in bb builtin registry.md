# WP-02 — Register plugin in bb builtin registry

**Lane:** L0 Foundation · **Spec refs:** SPEC 00 §3, §11 · Master Plan §1, §4.3 · RECON §1.4, §1.10, §1.14 · **Effort:** 0.5 d · **Status:** unassigned
**Depends on:** WP-01 · **Blocks:** official distribution and G0
**Produces a FROZEN artifact:** no — this is the one sanctioned bb registry change; every out-of-plugin edit is recorded in `FORK-DELTA.md`

## Files you own
`apps/server/src/services/plugins/builtin-registry.ts`
`apps/server/src/services/plugins/official-plugins.test.ts`
`apps/server/src/services/plugins/builtin-plugins.test.ts`
`docs/official-plugin-release-process.md`
`plugins/bb-plugin-finite-state/FORK-DELTA.md` *(append this WP's entries only)*
`turbo.json` *(only if the verified SDK-build-first dependency requires it)*

## Files you must not touch
`plugins/bb-plugin-finite-state/server.ts`, `app.tsx`, any frozen interface, `pnpm-lock.yaml`, SDK source or generated SDK declarations, and every other plugin. Do not edit `turbo.json` pre-emptively.

## Context
Workspace discovery already comes from the `plugins/*` pnpm glob; this WP is about official/builtin distribution, not making local development work. bb keeps the official registry and two hard-coded assertion lists in lockstep. Missing any one of the three makes either server tests or the official release process lie. The exact entry shape and sort order must be copied from the neighboring official plugins in the target bb fork; RECON deliberately does not claim those identifiers.

## What to build
1. Read the current registry implementation and both named tests before editing. Identify the canonical plugin id, package path, enabled/default behavior, and list ordering from adjacent official entries.
2. Add exactly one `finite-state` / `bb-plugin-finite-state` entry using the existing entry type. Do not add a second discovery path or special-case loader.
3. Update the assertion arrays in `official-plugins.test.ts` and `builtin-plugins.test.ts` in the same canonical order as their production sources.
4. Add Finite State to `docs/official-plugin-release-process.md`, including the package path and the same release/build expectations used by peer official plugins.
5. Run the plugin build from a cold SDK state. Add a `turbo.json` dependency edge only if the failure demonstrates that the SDK must build first; mirror the existing `bb-plugin-tasks#build` block byte-for-shape and substitute only the plugin task key.
6. Append every edit outside `plugins/bb-plugin-finite-state/` to `FORK-DELTA.md`, with reason and owning WP.

## Interface contract
The repository's current registry entry type is the contract. Verify its identifier names against the fork; do not paste an assumed shape from this spec. The semantic invariant is:

```json
{
  "pluginId": "finite-state",
  "packageName": "bb-plugin-finite-state",
  "workspacePath": "plugins/bb-plugin-finite-state",
  "classification": "official/builtin exactly as peer official plugins encode it"
}
```

If a build-order edge is proven necessary, it must be equivalent to:

```jsonc
{
  "tasks": {
    "bb-plugin-finite-state#build": {
      "dependsOn": ["@bb/plugin-sdk#build"]
    }
  }
}
```

The property names above are descriptive, not permission to invent a registry schema. The checked-in bb source wins.

## Acceptance criteria
- [ ] The server resolves the builtin id `finite-state` to `plugins/bb-plugin-finite-state` using the ordinary official-plugin path.
- [ ] Both lockstep tests contain the new id once, in canonical order, and pass.
- [ ] The official plugin release document names the plugin and its package path.
- [ ] Local workspace discovery still relies on `plugins/*`; no redundant loader or workspace registration was added.
- [ ] `turbo.json` is unchanged unless a captured cold-build failure proves the edge is required; if changed, it mirrors the verified tasks-plugin pattern.
- [ ] `FORK-DELTA.md` accounts for every out-of-plugin edit made by this WP.
- [ ] `pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state` is green.

## Test plan — `builtin-registration`
- `official registry exposes finite-state once` — run the focused official-plugin registry test.
- `builtin assertion list matches production registry` — run the focused builtin plugin test.
- `unknown builtin id still fails closed` (**error path**) — existing unknown-id test remains green; add a focused assertion only if the suite lacks one.
- `cold plugin build respects task order` — remove only generated build outputs through the repo's documented clean target, then run the filtered build; do not manually delete broad directories.

## Do not
- Do not change manifest fields here; WP-01 owns the manifest.
- Do not add dependencies or regenerate the lockfile.
- Do not edit registry types, loader behavior, or SDK code to accommodate this plugin.
- Do not guess line numbers from RECON; locate identifiers in the current fork.

## Open questions
1. Does the target fork still use the exact three files named by RECON, or were registry tests moved? Verify with `rg`; if moved, edit the equivalent files and record the path drift in `FORK-DELTA.md`.
2. Is the tasks plugin build-order block still present? If not, do not recreate it without a reproducible failure.

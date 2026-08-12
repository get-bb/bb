# WP-09 — CI gates, custom lint rules & dependency freeze

**Lane:** L0 Foundation · **Spec refs:** Master Plan §4, §8, §10 · AGENTS.md non-negotiables/UI rules · RECON §1.10, §1.14 · **Effort:** 1 d · **Status:** unassigned
**Depends on:** WP-01 · **Blocks:** safe parallel lane development
**Produces a FROZEN artifact:** no — it protects frozen artifacts

## Files you own
`plugins/bb-plugin-finite-state/scripts/check-frozen-artifacts.mjs`
`plugins/bb-plugin-finite-state/scripts/check-ui-rules.mjs`
`plugins/bb-plugin-finite-state/scripts/check-dependency-freeze.mjs`
`plugins/bb-plugin-finite-state/frozen-artifacts.json`
`plugins/bb-plugin-finite-state/scripts/*.test.ts`
The existing CI workflow file that owns plugin validation *(verify exact path in fork)*
Root/package script metadata only where the verified monorepo requires it, recorded in `FORK-DELTA.md`

## Files you must not touch
Contents of `server.ts`, `app.tsx`, or any frozen file; `pnpm-lock.yaml`; SDK/codegen sources; lane sources except read-only scanning. Do not install a lint plugin.

## Context
Nine lanes can only move in parallel if the collision rules are executable. This WP snapshots the two composition roots and five frozen interfaces, rejects undocumented changes, enforces token/icon rules, and detects dependency drift. The guard must permit an intentional amendment only when `AMENDMENTS.md` contains a structured entry tied to the changed artifact and `CONTRACT_VERSION` advances where required; a generic prose edit cannot disable protection.

## What to build
1. Create `frozen-artifacts.json` with repository-relative POSIX paths and SHA-256 baselines for `server.ts`, `app.tsx`, `shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, and a deterministic tree hash for `test/mock-remote/fixtures/**`. Generate/update it only through an explicit `--accept <amendment-id>` mode.
2. Implement frozen guard: default mode hashes current bytes, reports exact changed artifacts, and fails unless a matching approved amendment id and baseline update are in the same diff. Do not infer approval from “AMENDMENTS.md changed.”
3. Implement UI rule scan over `plugins/bb-plugin-finite-state/lanes/**/*.{ts,tsx,css}`: reject hex, `oklch(`, arbitrary Tailwind color values, Lucide imports/packages, and emoji in JSX/text literals. Allow raw colors only in `themes/fsds-dark.css`; avoid false positives on hashes/CVEs via syntax-aware or narrowly contextual patterns.
4. Implement dependency guard: compare plugin dependency/devDependency/peerDependency/optionalDependency keys and versions to the accepted manifest baseline and fail on drift outside a designated amendment/batch. Also reject a second zod version and direct dependency additions from lanes.
5. Wire the four-command gate into the current CI idiom: `turbo run typecheck test lint build --filter=bb-plugin-finite-state`, plus the three guards. Do not create a parallel CI system if the repo has a reusable workflow.
6. Add fixture tests proving guards fail closed and print recovery instructions: “file an amendment; do not edit the frozen artifact locally.”

## Interface contract
```json
// frozen-artifacts.json
{
  "version": 1,
  "artifacts": {
    "plugins/bb-plugin-finite-state/server.ts": { "sha256": "<64 hex>", "amendment": null },
    "plugins/bb-plugin-finite-state/app.tsx": { "sha256": "<64 hex>", "amendment": null },
    "plugins/bb-plugin-finite-state/shared/contract.ts": { "sha256": "<64 hex>", "amendment": null },
    "plugins/bb-plugin-finite-state/lib/store/schema.ts": { "sha256": "<64 hex>", "amendment": null },
    "plugins/bb-plugin-finite-state/lib/sync/registry.ts": { "sha256": "<64 hex>", "amendment": null },
    "plugins/bb-plugin-finite-state/lib/remote/types.ts": { "sha256": "<64 hex>", "amendment": null },
    "plugins/bb-plugin-finite-state/test/mock-remote/fixtures/**": { "treeSha256": "<64 hex>", "amendment": null }
  },
  "dependencyBaseline": { "dependencies": {}, "devDependencies": {}, "peerDependencies": {}, "optionalDependencies": {} }
}
```

Commands:

```text
node scripts/check-frozen-artifacts.mjs
node scripts/check-frozen-artifacts.mjs --accept AMD-0001   # fails unless structured approved entry exists
node scripts/check-ui-rules.mjs
node scripts/check-dependency-freeze.mjs
```

Verify the actual amendment log format/file exists in the target fork. If it is free-form, this WP defines and documents a small parseable heading contract before accepting any amendment; do not invent silent bypass environment variables.

## Acceptance criteria
- [ ] A one-byte edit to either composition root or any frozen artifact fails CI with the path named.
- [ ] A prose-only `AMENDMENTS.md` edit does not bypass the guard.
- [ ] The explicit accept flow requires an approved amendment id, updates only named hashes, and remains review-visible.
- [ ] Hex/oklch/arbitrary color, Lucide import, and JSX emoji fixtures each fail; bb token classes and hashes/CVEs pass.
- [ ] Any plugin dependency change fails outside the accepted batch; zod remains repo-pinned 4.3.6 with no plugin-specific duplicate.
- [ ] CI runs the guards and the exact four-command filtered gate.
- [ ] Scripts use only Node built-ins and work on Linux/macOS with POSIX-normalized paths.

## Test plan — `parallel-lane-guards`
- `clean baseline passes`.
- `root/frozen/fixture-tree mutation fails separately` (**error paths**).
- `unapproved and malformed amendment cannot accept` (**error path**).
- `approved amendment updates only selected artifact`.
- `UI forbidden/allowed fixture matrix` — include `#CVE`/SHA strings to prevent false positives.
- `dependency addition/version drift/second zod fail` (**error paths**).
- `CI command presence is asserted from the verified workflow`.

## Do not
- Do not weaken checks because current work is inconvenient; use the amendment protocol.
- Do not add ESLint packages after the dependency freeze; standalone Node checks are sufficient.
- Do not auto-commit or silently rewrite baselines in ordinary CI.
- Do not hash generated build output or platform-dependent metadata.
- Do not edit the protected artifacts while implementing their guard.

## Open questions
1. Confirm the current CI workflow/reusable-task path in the fork before editing it; record the sanctioned out-of-directory change in `FORK-DELTA.md`.
2. A structured amendment approval marker is not fully specified by existing docs. Human review must approve the minimal parseable format before `--accept` is usable.

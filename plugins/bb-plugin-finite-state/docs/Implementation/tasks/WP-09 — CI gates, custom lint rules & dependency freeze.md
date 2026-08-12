# WP-09 — Lean contract tripwires, compiler/ESLint policy, and CODEOWNERS

**Lane:** L0 Foundation · **Depends on:** WP-01 and the merged FS-89 freeze · **Status:** implemented by FS-23, pending review

## Intent

GitHub review policy and branch protection are the authorization boundary. The
repository keeps only cheap, maintainable application-code tripwires:

- byte/tree hashes catch accidental edits to the fixed frozen scope;
- a structured amendment entry drives explicit baseline acceptance;
- one dependency check preserves the Zod/package freeze;
- TypeScript makes a fourth action-tool classification unrepresentable;
- ordinary ESLint configuration enforces Finite State UI color/icon policy.

No guard performs wording analysis, registry regex scanning, module-graph
security analysis, or ad hoc UI source scanning.

## Owned surfaces

- `frozen-artifacts.json`
- `scripts/check-frozen-artifacts.mjs`
- `scripts/check-dependency-freeze.mjs`
- `scripts/guard-scripts.test.ts`
- `lib/agentic/registry.ts` and its compile-time test
- `AMENDMENTS.md` structured-entry documentation
- root `eslint.config.mjs`, `.github/CODEOWNERS`, and the existing stable CI job
- the matching `FORK-DELTA.md` record

Do not edit the semantic contents of `server.ts`, `app.tsx`,
`shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, or
`lib/remote/types.ts`. Do not touch mock fixtures, register/load the plugin,
create a database, or modify the quarantined workflow factory.

## Frozen baseline

The artifact map has a fixed, exact path set: both composition roots, the four
FS-89 frozen contracts, and the deterministic mock-fixture tree. The fixture
tree stays inactive until its owning WP lands through an approved structured
amendment. The initial baseline records FS-89, PR #6, Matt's approval evidence,
the approved head, and merge commit
`1062b0c799a8a538da8131d298175a9e47ed2a38`.

Default mode only recalculates active hashes and names mismatched paths. It is
an accidental-edit tripwire, not an authorization system. CODEOWNERS and FS-91
branch protection provide the review boundary.

An acceptance entry must be an unfenced level-three `A-*` or `AMD-*` heading
with these exact fields:

```md
### AMD-0002 — Brief title

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
- Contract version: 2
```

Fenced examples, including the `AMD-0001` example in `AMENDMENTS.md`, are
documentation and cannot authorize acceptance. The amendment must name exactly
the changed artifact/dependency targets. A shared-contract change must also
advance `CONTRACT_VERSION` to the recorded value.

## Compiler and ESLint policy

`lib/agentic/registry.ts` is the canonical sixteen-tool metadata seam. Its
`ActionToolName` union contains exactly:

- `fs_verification_run`
- `fs_bench_run`
- `fs_firmware_materialize`

The mapped registry type permits `class: "action"` only for that union. The
type-test includes an expected compiler rejection for a fourth classification.

Root ESLint `no-restricted-syntax` rejects raw hex, raw `oklch()`, and
arbitrary color utilities in Finite State TSX. `no-restricted-imports` rejects
non-Hugeicons icon libraries. Approved semantic token classes and Hugeicons
imports pass. No lint plugin or bespoke UI scanner is used.

## Dependency freeze

The dependency guard requires:

- the plugin dependency sections to match `frozen-artifacts.json`;
- direct plugin `zod` to remain `^4.3.6`;
- the plugin lockfile importer to resolve the root override `4.3.6`;
- exactly one `zod@4.3.6` package resolution and no alias/second copy.

## Commands and CI

```text
node plugins/bb-plugin-finite-state/scripts/check-frozen-artifacts.mjs
node plugins/bb-plugin-finite-state/scripts/check-frozen-artifacts.mjs --accept AMD-0002
node plugins/bb-plugin-finite-state/scripts/check-dependency-freeze.mjs
pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state
```

The two tripwires run inside the existing unconditional
`Finite State guard gates (ubuntu-latest, Node 22.19.0)` job. The same job then
runs the filtered Turbo lifecycle once; no parallel CI pipeline is introduced.

Focused tests cover a clean baseline, byte/tree mutation diagnostics, fenced
example rejection, real structured acceptance, and Zod/lockfile drift. Removed
wording/UI scanners have no retained adversarial corpus.

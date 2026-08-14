# Journey beat backlog

Beat specs for the WP-65 Golden Loop E2E harness, accumulated by fix tasks for sweep-found defects until the harness exists (owner ruling, 2026-08-14 — QA restructuring package, part 3). The WP-65 implementer consumes this file: every entry becomes a harness beat, and the entry is then marked `harnessed` with the beat's test id. After WP-65 lands, fix PRs add their beat directly to the harness instead of appending here.

Entry format — one section per defect:

- **Source**: task key + the sweep finding it came from
- **Journey**: the user-visible sequence that broke, step by step, through registered surfaces (RPC names or panel path)
- **Broke because**: one line on the defect
- **Beat asserts**: the observable outcome(s) the harness must pin

## Backlog

### FS-168 — bulk triage apply silent no-op (sweep #5)

- **Harnessed**: `golden-loop.e2e.test.ts` — beat 2, `FS-168 bulk triage writes`
- **Journey**: triage panel → select multiple findings → bulk apply decision → confirm
- **Broke because**: `commitBulk` swallowed unresolved-scope failures; click produced no toast, no file, no error, no log
- **Beat asserts**: YAML files exist on disk after confirm; a failure path renders a visible error

### FS-171 — bench panel dead surface (sweep FS-140 cluster)

- **Pending — not Harnessed**: `golden-loop.e2e.test.ts` — beat 3, `FS-171 bench dispatch durability`, pinned to `No puller is registered for verificationRun` until FS-201 lands the production Bench bootstrap path
- **Journey**: bench panel → select project/version → view runs → dispatch run → verdict renders
- **Broke because**: queued checkpoint outside the `try`; throwing resolver recorded no run row; cross-scope version auto-select
- **Beat asserts**: run row appears in the registered runs list; a failed dispatch still records a row with a visible failure state

### FS-172 — SBOM panel dead end (sweep FS-140 cluster)

- **Harnessed**: `golden-loop.e2e.test.ts` — beat 4, `FS-172 recoverable SBOM pull`
- **Journey**: SBOM panel first use → pull → components render → pull again after failure
- **Broke because**: orphaned staging sqlite made every later pull fail forever; `pullError` rendered only in the empty state
- **Beat asserts**: a failed pull is recoverable by retry; the error is visible outside the empty state

### FS-167 — Sync Review first-use dead end (sweep #5)

- **Harnessed**: `golden-loop.e2e.test.ts` — beat 1, `FS-167 fresh sync review`
- **Journey**: fresh workspace → sync panel → first pull → review changes → accept
- **Broke because**: first-use paging dead-ended the review flow
- **Beat asserts**: the accept path completes from a fresh workspace

### FS-193 — all-quarantined findings pull (sweep #6)

- **Harnessed**: `golden-loop.e2e.test.ts` — beat 5, `FS-193 quarantined finding recovery`
- **Journey**: `bb finite-state pull finding --json` against a partially-degenerate corpus → inspect fetched/quarantined/published counts in CLI and Findings panel → pull an all-unkeyable corpus → repair remote → same pull again
- **Broke because**: one degenerate row aborted the whole pull; then the failed staging generation resumed forever, never contacting the repaired remote
- **Beat asserts**: partial quarantine publishes keyable rows and reports the same truthful per-generation quarantine count in CLI JSON and the Findings panel; all-quarantined fails loudly with truthful counts and preserves the accepted generation; the next same-kinds pull against a healthy remote succeeds and publishes

### FS-194 — triage single write YAML silent no-op (sweep #6)

- **Harnessed**: `golden-loop.e2e.test.ts` — beat 6, `FS-194 single triage write and undo`
- **Journey**: triage panel → single finding → write YAML with unresolved scope ids
- **Broke because**: `commitSingle` early-returned with the button enabled; undo announced success while the YAML never changed
- **Beat asserts**: the write either completes (file on disk) or renders a visible truthful refusal; undo reverts what it claims to revert

### FS-198 — explicit Platform-to-Assurance-Studio project selection (sweep #6)

- **Journey**: fresh disposable workspace → Sync Review → Platform project/version scope → Product Security surface → choose bb workspace project → inspect all four equally-primary linked AS candidates → explicitly save one candidate → status and plan render from the selected AS project; repeat without a bb project and without an AS selection
- **Broke because**: connected TARA reads sent the disjoint Platform project id to Assurance Studio, and the real product linkage is ambiguous (verified four-way and two-way groups), so every connected surface 404ed and no heuristic could choose safely
- **Beat asserts**: the four candidates remain visible and unselected until the operator saves one; the saved AS id alone scopes remote adapter and resolver reads while Platform ids retain cache identity; the connected Product Security status/plan render after selection; missing workspace shows `WORKSPACE_PROJECT_REQUIRED` and missing AS choice shows `AS_PROJECT_SELECTION_REQUIRED`, with no status or plan request sent in either refusal state

### FS-199 — full-shape finding enrichment fidelity (sweep #6)

- **Journey**: disposable bb data dir with the mock Platform remote → Findings panel → pull the 29-key binary-SAST specimen through registered `syncPull` → open `FS-500-006`
- **Broke because**: the five-key seed projection hid unmapped warning/violation counts, and string-valued EPSS was silently discarded
- **Beat asserts**: `FS-500-006`, `ca-certificates.crt`, EPSS `0.4%`, two warnings, and one violation render after the real-shape pull; invalid/null enrichment publishes as null with value-free advisory reason counts while identity-invalid rows alone increment quarantine

### FS-195 — scoped SBOM pull and file-path component identity (sweep #6)

- **Journey**: bound workspace → SBOM panel → select the bound Platform project/version → Pull SBOM → inspect path-named components → open a component whose purl matches an accepted finding
- **Broke because**: the component request omitted the documented project/projectVersion filter and pulled the tenant-global portfolio; fallback identity rejected file paths, while one odd row aborted the complete corpus
- **Beat asserts**: every included/excluded component request carries the exact selected Platform project/version filter; the panel renders only that scope including `/apps/*.elf` and purl-less path rows; the component detail shows the joined finding; odd unkeyable rows are isolated and the CLI reports their truthful generation-total quarantine count

### FS-201 — bench requirement puller dead-end loop (sweep #7)

- **Harnessed**: `golden-loop.e2e.test.ts` — beat 7, `FS-201 requirement-to-bench loop`
- **Journey**: bench panel with no cached version → follow the product's own instruction ("Pull a version through Sync first") → `pull requirement` → bench enabled → run → WP-55 verdict card renders
- **Broke because**: no puller is registered for `requirement`; the product's instruction is impossible, bench unreachable in every flow
- **Beat asserts**: the full loop completes: sync pull → accepted version → bench run → verdict card visible

### Performance budgets on the largest seeded surfaces (supervisor audit, 2026-08-14)

- **Journey**: seed the largest standard datasets (findings and SBOM at FS-195 scale: ~900 components / ~6k findings) → open the Findings panel and the SBOM panel → initial render → sustained scroll through the virtualized lists → read renderer heap
- **Broke because**: nothing broke — this beat is preventive. The 2026-08-14 frontend audit was clean (idle 0% CPU / ~210MB RSS / 124MB JS heap; all six heavy surfaces virtualized via `@tanstack/react-virtual`), and this beat pins those properties so a regression surfaces in the harness rather than in a sweep
- **Beat asserts**: initial render of each panel completes within its budget on the seeded dataset; scroll remains responsive (virtualization intact — DOM row count stays bounded during sustained scroll); JS heap stays within a ceiling derived from the ledgered 124MB baseline (see `patch-verifications-matrix-visibility-gating` for the full baseline numbers). Budget values are set by the implementer from first measurement on the CI runner class, recorded in the beat itself, and tightened only deliberately

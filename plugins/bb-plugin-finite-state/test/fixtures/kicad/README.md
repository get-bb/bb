# KiCad sample projects — L9 test fixtures

Real KiCad projects used by the L9 Hardware Design Plane lane (WP-72…WP-81) for
parser, extraction, and overlay tests.

**This directory is NOT part of the frozen fixture tree.** The freeze covers
`test/mock-remote/fixtures/**` only. L9 owns this directory.

## What belongs here

One subdirectory per project, containing the files as KiCad saves them:

```
test/fixtures/kicad/<project-name>/
  <name>.kicad_pro        # required — discovery keys off this
  <name>.kicad_sch        # required — root sheet (plus any hierarchical sheets)
  <name>.kicad_pcb        # optional — enables board/fab test coverage
```

Requirements for a useful fixture:

- **KiCad 7 or newer** (S-expression format with embedded `lib_symbols`).
  KiCad 5 files are out of scope by spec (SPEC 07 §9).
- At least one multi-unit symbol (e.g. an op-amp: U3A/U3B) and at least one
  part with an `MPN` custom field, so the join-key and HBOM-ingest paths get
  exercised. Parts with *no* MPN are also valuable — that case must stay legal.
- Small enough to live in git. A few sheets is plenty; do not add a
  production-scale board here.

## What tests may assume

- Parsing (`kicadts`) runs with **no KiCad installed** — CI has no `kicad-cli`.
- Anything requiring `kicad-cli` (SVG/GLB export, gerbers, DRC/ERC) must be
  behind a capability check and skip cleanly when the binary is absent.
  Committed expected-output artifacts, if any, live beside the project in an
  `expected/` subdirectory with a note naming the `kicad-cli` version used.

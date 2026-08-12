# Finite State contract amendments

Frozen contracts may change only through an amendment entry approved by the contract owner and one affected-lane reviewer. Pre-freeze architecture corrections retain their accepted `A-*` identifiers; post-freeze contract changes use `AMD-*`. CI, not an implementation lane, updates baseline hashes after approval.

Each amendment must record:

- identifier and status;
- old and new artifact hashes;
- reason and migration plan;
- affected work packages and gates;
- approver/reviewer identities;
- broadcast and merge commits.

No amendment is implied by an implementation task, code comment, or local workaround.

## Approved amendments

### A-000 — Direct APIs and optional Forge compute

- Status: approved and merged
- Prior artifact hashes: pre-freeze; no contract baseline existed
- New artifact hashes: `BASELINE.json` records the approved spec and vendored-input hashes
- Reason: replace Forge-as-data-gateway with direct typed Platform and Assurance Studio REST while retaining only unique Forge compute
- Migration: update the handoff, ADR, Product Specs, remote contracts, mocks, registry ownership, and all affected WPs before implementation dispatch
- Affected WPs and gates: WP-01, WP-03–06, WP-10–19, WP-22, WP-29, WP-40, WP-43, WP-50, WP-64; G0–G6
- Contract owner: Matt Wyckhouse (product-owner approval in the coordinating thread)
- Affected-lane reviewer: independent agent thread `thr_ib9at8u34a`
- Approved specification commit: `3e37cae40405f6857d6ff1f6f628baff134d8436`
- Merge commit: `b18f9878bc6c0b183603885687178480df56b309`
- Broadcast commit: `4f5431306245d2aef2abaa6aac342d947c780bdf` (initial target-repository corpus import)
- Result: Platform and Assurance Studio are direct typed REST data planes. Forge is nullable and restricted to the checksummed compute manifest. `prepareFirmwareRoot` is deliberately unresolved and must be removed or proven before WP-06 freezes.

## Pending amendments

None.

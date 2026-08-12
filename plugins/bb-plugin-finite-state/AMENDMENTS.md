# Finite State contract amendments

Frozen contracts may change only through an `AMD-*` entry approved by the contract owner and one affected-lane reviewer. CI, not an implementation lane, updates baseline hashes after approval.

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
- Approved specification commit: `3e37cae40405f6857d6ff1f6f628baff134d8436`
- Merge commit: `b18f9878bc6c0b183603885687178480df56b309`
- Reviewer thread: `thr_ib9at8u34a`
- Result: Platform and Assurance Studio are direct typed REST data planes. Forge is nullable and restricted to the checksummed compute manifest. `prepareFirmwareRoot` is deliberately unresolved and must be removed or proven before WP-06 freezes.

## Pending amendments

None.

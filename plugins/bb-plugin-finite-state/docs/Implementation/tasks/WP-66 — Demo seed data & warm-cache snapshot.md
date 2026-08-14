# WP-66 — Demo seed data & warm-cache snapshot

**Lane:** L8 Demo & E2E · **Spec:** SPEC 06 §6, §9 step 6.5 · **Effort:** 1.5 d · **Status:** unassigned
**Depends on:** WP-08, WP-65 · **Blocks:** WP-67, WP-68, WP-69, WP-70
**Produces a FROZEN artifact:** no — these are E2E-owned derivatives; WP-08's fixture corpus is governed by the fixture-fidelity rule after the 2026-08-13 freeze retirement

## Files you own

```
plugins/bb-plugin-finite-state/test/e2e/golden-loop/seed/generate.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/seed/manifest.json
plugins/bb-plugin-finite-state/test/e2e/golden-loop/seed/worktree/**
plugins/bb-plugin-finite-state/test/e2e/golden-loop/seed/warm-cache/**
plugins/bb-plugin-finite-state/test/e2e/golden-loop/seed/attestations/**
plugins/bb-plugin-finite-state/test/e2e/golden-loop/seed/seed.test.ts
```

## Files you must not touch

`test/mock-remote/fixtures/**` (excluded by ownership and governed by fixture fidelity, not frozen), production source, frozen interfaces, composition roots, external tenant data, or dependencies.

## Context

The demo needs a small, deterministic story layered over the representative WP-08 corpus: AX3000 v2.3→v2.4, carry-forward loss, one held KEV finding, THREAT-22, a missing requirement, source code that can be fixed, a fully materialized firmware mount, and an offline-verifiable bench result. The warm cache is a tested artifact with provenance, not an undocumented developer database.

## What to build

1. Generate E2E data deterministically from a committed seed/version. Reuse WP-08 fixtures read-only and write only derived Golden Loop artifacts.
2. Seed v2.3/v2.4 with stable component identities, 412 new untriaged findings, 306 policy matches of which one is KEV-held, 305 writable decisions, 14 carry-forward misses recoverable by overlay, 9 stale decisions, and 2 orphans.
3. Include reachable KEV `CVE-2026-31337` on `httpd`, `COMP-httpd`, `THREAT-22`, a WAN-crossing attack path, CRA clause fixture, check fixture, and absent `REQ-118` at start.
4. Include source/firmware pairs where the later source edit and binary/run evidence can be traced. Pin all identities and expected SHA-256 digests in `manifest.json`.
5. Build `.fs-firmware/<pv>/rootfs` plus `manifest.sqlite` using the production migration/open path. Mark v2.4 fully materialized; include explicit, non-fatal unpack-gap fixture elsewhere to test honesty without breaking the flagship path.
6. Build `data.db` through production migrations and pull/import services, never by copying an unversioned developer DB. Include freshness timestamps controlled by the harness clock.
7. Include a deterministic offline run/event sequence and DSSE/in-toto fixture whose subject digest equals v2.4. Store verification material needed for offline signature/structure checks; clearly label test identity and never imply public Rekor inclusion.
8. Write a manifest of every artifact, logical purpose, byte hash, schema version, and generator version. Add `--verify` mode that performs no writes.
9. Keep generated bulk data compact enough for the repo. Prefer deterministic generators over committing thousands of repetitive files, but the harness copy must expose the claimed tree/count.

## Interface contract

```ts
type GoldenSeedManifest = {
  seedVersion: 1;
  sourceSeed: string;
  generatedAt: string; // deterministic epoch
  products: {
    v23: { pvId: string; firmwareDigest: string; fileCount: number };
    v24: { pvId: string; firmwareDigest: string; fileCount: number };
  };
  expected: {
    newUntriaged: 412;
    policyMatches: 306;
    policyWritten: 305;
    heldKev: 1;
    carryForwardRecovered: 14;
    stale: 9;
    orphans: 2;
  };
  artifacts: Array<{
    path: string;
    sha256: string;
    purpose: string;
    schemaVersion?: number;
  }>;
};

export function generateGoldenSeed(
  destination: string,
  seed: number,
): Promise<GoldenSeedManifest>;
export function verifyGoldenSeed(root: string): Promise<void>;
```

## Acceptance criteria

- [ ] Two generations from the same seed are byte-identical except explicitly excluded SQLite nondeterminism, whose semantic dumps are identical.
- [ ] All expected counts and cross-links match the manifest.
- [ ] Warm DBs are created/migrated by production code and open without network.
- [ ] Firmware trees expose the manifest counts and the exact digests consumed by bench fixtures.
- [ ] Attestation subject equals the seeded firmware digest and is clearly a test/offline fixture.
- [ ] The WP-08 fixture corpus is not changed by this lane; any future fixture change follows the fixture-fidelity rule and needs no amendment.
- [ ] `--verify` detects one-byte corruption, schema mismatch, and broken cross-link.
- [ ] No real customer identifiers, secrets, tokens, or production evidence appear.

## Test plan

`seed.test.ts`

- `same seed yields same manifest and semantic database dump`.
- `expected drift, policy, KEV, threat, and trace counts hold`.
- `all manifest hashes verify`.
- `corrupted cache artifact fails with exact path` (**integrity error path**).
- `attestation subject mismatch is rejected` (**evidence safety path**).
- `generator writes nothing under the separately owned mock fixture path`.

## Do not

- Do not hand-edit generated databases or claim live/public attestation provenance.
- Do not commit secrets, customer data, private firmware, or a production token.
- Do not modify WP-08 fixtures to fit the demo story.
- Do not silently omit unpack gaps or unresolved links.
- Do not let timestamps/random ids make the seed irreproducible.

## Open questions

1. Set the final file-count claim after measuring repository/runtime cost; the logical mount may synthesize unchanged entries from the generator as long as UI and manifest truth agree.
2. Decide whether binary SQLite snapshots are committed or generated in CI. Prefer generated plus semantic hash if checkout size is material.

# WP-63 — Skills tree — root plus per-surface

**Lane:** L7 Agentic surfaces · **Spec:** SPEC 06 §3, §8 · RECON §1.9 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-58, WP-59, WP-60 and completed surface contracts · **Blocks:** WP-65, WP-67–70
**Produces a FROZEN artifact:** no

> **SPEC 07/08 intake note (2026-08-12).** The tree later gains
> `fs-hardware` (WP-81) and `fs-bringup` / `fs-debug-bench` / `fs-citation` /
> `fs-porting` / `fs-instruments` (WP-96 — hand-written by hardware
> bring-up practitioners; scaffolded there, not here). Keep the root skill's
> surface directory extensible and reserve those names now so no later
> collision forces a rename.

## Files you own
```
plugins/bb-plugin-finite-state/skills/fs-finite-state/SKILL.md
plugins/bb-plugin-finite-state/skills/fs-sync/SKILL.md
plugins/bb-plugin-finite-state/skills/fs-triage/SKILL.md
plugins/bb-plugin-finite-state/skills/fs-product-security/SKILL.md
plugins/bb-plugin-finite-state/skills/fs-bom/SKILL.md
plugins/bb-plugin-finite-state/skills/fs-firmware/SKILL.md
plugins/bb-plugin-finite-state/skills/fs-bench/SKILL.md
plugins/bb-plugin-finite-state/skills/fs-docs/SKILL.md
plugins/bb-plugin-finite-state/test/skills/skill-contract.test.ts
plugins/bb-plugin-finite-state/test/skills/trigger-eval.test.ts
plugins/bb-plugin-finite-state/test/skills/fixtures/trigger-cases.json
```

## Files you must not touch
Manifest, composition roots, frozen interfaces, tool implementations/schemas, CLI metadata, domain source, dependencies, or fixture corpus.

## Context
Skills teach agents identity, workflow, evidence discipline, and stopping points. RECON overrides SPEC 06's earlier unprefixed directory plan: plugin skills lose collisions to project/user skills, so every directory and matching frontmatter `name` is namespaced `fs-*`. The root carries universal invariants; surface skills carry domain craft. A skill must describe the tools that actually shipped, not an aspirational API.

## What to build
1. Create eight directories/files with directory exactly equal to frontmatter `name`: `fs-finite-state`, `fs-sync`, `fs-triage`, `fs-product-security`, `fs-bom`, `fs-firmware`, `fs-bench`, `fs-docs`.
2. Write trigger-oriented descriptions naming common user phrases, capped at the SDK limits. Avoid descriptions so broad that every request loads every skill.
3. Root skill: shared workspace model; VERSIONED/CACHED/OVERLAY/ACTION classes; stable-key overview; agent writes local intent; human pushes/resolves/accepts; exactly three action exceptions; directives/mentions; “verified” only from evidence.
4. Sync: status/plan mental model, stale/offline semantics, conflict etiquette, plan directive, and absolute prohibition on push by the agent.
5. Triage: stable-key tier ladder, six statuses/five responses/nine justifications, `CODE_NOT_REACHABLE` exact pin, KEV holdback, policy dry-run, evidence craft, and directive pairing.
6. Product security: slugs/file map, EARS six-pattern decision table, excluded/derived fields, trace links, TARA concurrency awareness, and verification honesty.
7. BOM: SBOM read posture; HBOM proposals, field-level provenance, numeric confidence, page/cell source refs, human-only acceptance, and image-only/OCR stop condition.
8. Firmware/bench/docs: primary standalone unpack and byte gaps; exact digest/materialization; tier mapping and verdict etiquette; page/region extraction and no fabricated citations.
9. Every write-oriented skill ends: summarize work, point to paths/diff and `fs_sync_plan`, emit the relevant directive, stop for human review. No skill tells an agent to call CLI push.
10. Add deterministic structural tests and a 20-case triggering evaluation. At least 18/20 cases select the intended skill; adversarial cases verify no skill recommends forbidden actions.

## Interface contract
```yaml
---
name: fs-triage
description: Vulnerability findings, CVEs, VEX, reachability, false positives, and firmware triage in a Finite State workspace.
---
```

Each body follows:
```
# Purpose and when to use
## Identity first
## Workflow
## Evidence and review expectations
## Tools and native-file boundaries
## What to render
## Never
```

The exact tool names/signatures come from `AGENT_SURFACE`. The contract test extracts backticked `fs_*` names from positive tool/workflow sections and rejects unknown ones. In `Never`/prohibition text it permits only the explicitly forbidden `fs_sync_push` identifier, and verifies that the surrounding statement is negative rather than instructional.

## Acceptance criteria
- [ ] Eight skills exist; directory and frontmatter names match and are all `fs-*` namespaced.
- [ ] Root names exactly three actions and says the agent cannot push, resolve conflicts, accept HBOM cells, or attest manually.
- [ ] Every surface skill teaches stable identity before verbs and pairs ids with directives.
- [ ] No skill repeats stale claims about per-tool approval, API-first full-rootfs materialization, unprefixed plugin skills, or agent push.
- [ ] All positively referenced tools/directives exist in the canonical registry; `fs_sync_push` appears only in negative `Never`/prohibition prose, never as an available command or callable instruction.
- [ ] Trigger eval routes at least 18/20 cases and includes negative/safety prompts.
- [ ] Skills remain readable, bounded, and do not duplicate the full CLI tree.

## Test plan
`skill-contract.test.ts`
- parses frontmatter; asserts names, descriptions, directory equality, and namespace.
- extracts positive tool/directive references and validates registry membership; separately validates the one allowed negative `fs_sync_push` prohibition.
- `forbidden-instruction scan rejects push, human-review resolution, or invented approval metadata` (**safety error path**).
- asserts required identity/evidence/review sections per surface.

`trigger-eval.test.ts`
- 20 scripted asks spanning all eight skills, including ambiguous component/CVE and document/HBOM prompts.
- at least two adversarial asks request server mutation or fabricated evidence; expected response remains refusal/review workflow.
- fail threshold below 18/20; record model/provider version with results.

## Do not
- Do not use unprefixed names from stale SPEC 06 §3.
- Do not document tools, flags, or SDK behavior that does not exist.
- Do not teach push, conflict resolution, HBOM acceptance, or attestation writing to the agent.
- Do not claim an action has a configurable per-tool approval prompt.
- Do not let durable reasoning live only in prose; teach agents to write evidence into tracked decisions.

## Open questions
1. Confirm the eval harness used elsewhere in the bb monorepo; keep the fixture provider-independent if no standard exists.
2. If the broad root skill crowds specialized skills, narrow its description but do not duplicate invariants across all bodies.

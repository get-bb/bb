# WP-96 — Firmware-authoring agentic surfaces — hand-written skills, tools, directives, CLI

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §3.1, §6 · SPEC 06 conventions via WP-57 · AMD-0013 · decisions 9.3, 9.5 · IoT-SkillsBench finding · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-57, WP-82–91 · **Blocks:** WP-98
**Produces a FROZEN artifact:** no — implements handlers and surfaces for tool specs already declared in the AMD-0013-amended `lib/agentic/registry.ts` (WP-71 owns that file)

## Files you own

    plugins/bb-plugin-finite-state/lanes/agentic-fw/tools/ground.ts
    plugins/bb-plugin-finite-state/lanes/agentic-fw/tools/cite.ts
    plugins/bb-plugin-finite-state/lanes/agentic-fw/tools/hw-status.ts
    plugins/bb-plugin-finite-state/lanes/agentic-fw/tools/actions.ts
    plugins/bb-plugin-finite-state/lanes/agentic-fw/directives/*.tsx
    plugins/bb-plugin-finite-state/lanes/agentic-fw/cli/fw.ts
    plugins/bb-plugin-finite-state/lanes/agentic-fw/register.ts
    plugins/bb-plugin-finite-state/lanes/agentic-fw/**/*.test.{ts,tsx}
    plugins/bb-plugin-finite-state/skills/fs-bringup/SKILL.md
    plugins/bb-plugin-finite-state/skills/fs-debug-bench/SKILL.md
    plugins/bb-plugin-finite-state/skills/fs-citation/SKILL.md
    plugins/bb-plugin-finite-state/skills/fs-porting/SKILL.md
    plugins/bb-plugin-finite-state/skills/fs-instruments/SKILL.md

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lib/agentic/registry.ts (consume the amended union; never edit), lanes/agentic/** (WP-57–64), the WP-82–91 lane internals beyond their exported services, WP-63's eight skills, package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

This WP is the seam between everything L10 built and the agent. It follows WP-57's conventions exactly: reads return summaries with ids, writes return the path plus a bounded diff summary, errors teach recovery, every list is paged under the token budget, and every tool pairs with a directive. The tool specs (class, server access, `destructive` flag) already exist in the AMD-0013-amended registry; this WP implements handlers by delegating to owner services — grounding (WP-82/83), citations (WP-85), build/flash (WP-86), serial (WP-87), devices (WP-88), probes (WP-89) — behind WP-90's `requireDebugMode` and destructive-grant guards.

**The skills are the load-bearing part, and they are hand-written by people who have brought up hardware.** IoT-SkillsBench is unambiguous: expert-authored skills achieve near-perfect success where self-generated skills fall materially short. This WP's job for the five skills is therefore scaffolding, not authorship: directory structure, frontmatter, section skeletons, the contract tests, and a review checklist — with a named human owner responsible for the prose of each skill, tracked to sign-off. An agent may draft placeholders; a placeholder cannot ship as reviewed.

The CLI subtree extends `bb finite-state` with `fw`. WP-64's rule binds here: the `commands` metadata array is agent-readable and generated without executing plugin code, so no CLI flag can be a trusted human boundary. `fw flash --confirm` is therefore a human-only *executable* path in exactly one sense: `--confirm` never mints authorization — it consumes a live WP-90 destructive grant (minted only from the human-facing bench surface) and executes; without one it exits 3 and prints how a human arms the flash. Destructive execution never bypasses the in-turn rule via CLI flags. Namespace everything `fs-*`.

## What to build

1. Read tools: `fs_ground_query` — federates catalog (WP-83) and project documents (WP-82), returns **cited passages** with doc/page/anchor (catalog facts with their `source_file`), labels every result with its plane and confidence, never raw chunks, paged. `fs_hw_status` — the WP-88 enumeration with claim state, summarized.
2. Write tools (local YAML only): `fs_ground_add` — registers a document for indexing, writing local metadata; `fs_cite_write` — writes citation overlay YAML via WP-85 and **quarantines uncited values** rather than refusing or inventing; both return path + diff summary per WP-57.
3. ACTION tools per the AMD-0013 union: `fs_build` and `fs_serial` delegate to WP-86/87; `fs_probe` delegates to WP-89 behind `requireDebugMode`; `fs_flash` is `destructive: true` — its handler's first statement is WP-90's `consumeDestructiveGrant`. `fs_serial` read is plain; send sits behind confirmation per AMD-0013. No tool touches Platform/AS; there is no push tool.
4. Directives: `::fs-citation{file,symbol}` (the value, its source, clickable back to the page/anchor), `::fs-probe{id}` (probe result with captures), `::fs-serial{lines}` (bounded serial excerpt), `::fs-build{id}` (build result surfacing the diagnostic that matters). Attributes arrive as untrusted strings — parse and validate. Components self-fetch by id, use theme tokens and Hugeicons only, and design all four states (loading skeleton, empty, error with retry, `needsConfiguration`).
5. The CLI `fw` subtree per SPEC 08 §6: `ground add|list|query`, `build`, `flash [--confirm]`, `serial [--filter]`, `devices`, `claim`, `release`, `probe run|list`, `bringup`, `port` — metadata-only `commands` array, handlers routed to owner services (WP-95's workflows for `bringup`/`port`, gate preflight exposed under `fw gate`). Lists are JSON-capable, cursor-paged, 1 MiB-capped per WP-64.
6. Skill scaffolds with review machinery: five directories whose names equal frontmatter names; section skeletons (`# Purpose and when to use / ## Identity first / ## Workflow / ## Evidence and review expectations / ## Tools and native-file boundaries / ## What to render / ## Never`); an owner/status marker (`<!-- fs-skill-owner: <name> · status: draft|reviewed -->`); and a review checklist per skill naming what its human owner must verify on hardware.
7. Required skill content contracts (the scaffold pins these; the owner writes the prose): `fs-debug-bench` teaches Observe → Hypothesize → Probe → Verify with **likelihood × ease-of-verification ranking**, the D0–D3 cascade ladder quoting WP-91's rule table, and the hard rule that D1/D2 may refute but never confirm timing/power/analog. `fs-citation`: never emit an uncited hardware constant — quarantine and ask. `fs-bringup`: research before code, cite every constant, verify on serial before declaring done. `fs-porting`: capability diffing, staged gates. `fs-instruments`: which instrument answers which question, claim/release, the destructive boundary.
8. Registration: `lanes/agentic-fw/register.ts` exports one `registerFirmwareAuthoringSurface(bb, ctx)` invoked through the agentic composition seam (see open question 1); register once per factory execution, reload-safe.
9. Contract tests in the WP-63 style: every positively referenced tool/directive exists in the amended registry; destructive prose matches the mechanism; no skill or metadata advertises push, and `fs_flash` is nowhere described as agent-safe.

## Interface contract

    export const FW_TOOLS = [
      "fs_ground_query", "fs_ground_add", "fs_cite_write", "fs_hw_status",
      "fs_build", "fs_flash", "fs_serial", "fs_probe",
    ] as const;                              // classes/flags come from the AMD-0013 registry, not here

    export const FW_DIRECTIVE_IDS = ["fs-citation", "fs-probe", "fs-serial", "fs-build"] as const;

    export interface GroundQueryResult {
      plane: "catalog" | "document";
      confidence: number;
      passages: Array<{
        text: string;
        citation:
          | { doc: string; page: number; anchor: string | null }
          | { sourceFile: string; vendor: string };
      }>;
      nextCursor: string | null;
    }

    export const FW_CLI_SUBTREE = {
      name: "fw",
      commands: [/* static metadata: ground, build, flash, serial, devices, claim, release, probe, bringup, port, gate */],
    } as const;

    export function registerFirmwareAuthoringSurface(bb: BbPluginApi, ctx: PluginContext): void;

Tool handlers return WP-57 `ToolResult<T>` envelopes via `ok()`/`fail()`; do not invent a second envelope.

## Acceptance criteria

- [ ] All eight tools exist with handlers delegating to owner services; classes and the `destructive` flag match the AMD-0013 registry exactly, asserted against the union.
- [ ] `fs_ground_query` returns plane-labeled cited passages, never raw chunks; catalog facts always carry `source_file`.
- [ ] `fs_cite_write` quarantines an uncited value and reports it; it cannot write an uncited constant as accepted.
- [ ] `fs_flash` without a live WP-90 grant refuses before any side effect; `fs_probe` outside debug mode refuses likewise; WP-90's nine-tool test passes with these handlers wired.
- [ ] `fs_serial` send requires confirmation; read does not.
- [ ] `fw flash --confirm` consumes a grant or exits 3 with arming instructions; tests prove no CLI flag combination executes a flash without a grant, including in noninteractive environments.
- [ ] The four directives validate untrusted attributes, self-fetch by id, and render all four states with theme tokens and Hugeicons only.
- [ ] Five `fs-*` skills exist with directory/frontmatter name equality, the required sections, and an owner/status marker; a `status: draft` skill fails the release-readiness check.
- [ ] Contract tests verify every referenced tool/directive against the registry and reject any push or approval-metadata claim.
- [ ] All lists paged; no new npm dependency; CI green with no hardware or Python present.

## Test plan

- tools.test.ts — per-tool happy path against fake owner services; unclaimed/out-of-mode refusals (safety error paths); pagination and budget envelopes; `fs_ground_query` plane labeling and raw-chunk absence.
- flash-safety.test.ts — grant present/absent/expired/consumed matrix for `fs_flash` and the CLI path, proving refusal precedes side effects (safety error path).
- cite.test.ts — cited write, uncited quarantine, and malformed citation rejected with a recovery hint (error path).
- directives.test.tsx — attribute validation, four states per directive, and hostile attribute strings do not crash render (error path).
- cli.test.ts — metadata snapshot for the `fw` subtree, JSON paging/cap, `--confirm` semantics, and unconfigured-host guidance without a stack trace.
- skills-contract.test.ts — WP-63-style structural checks, registry-membership of referenced tools, owner/status markers, and the forbidden-instruction scan.

## Do not

- Do not edit `lib/agentic/registry.ts` or WP-57's conventions modules; consume them.
- Do not let an agent-authored draft ship as a reviewed skill, or soften the IoT-SkillsBench requirement to "the agent wrote it and a human skimmed it".
- Do not describe `--confirm`, a plan approval, or workflow state as satisfying the in-turn destructive rule.
- Do not return raw grounding chunks, unbounded serial logs, or firmware bytes through any tool.
- Do not add a push tool, a server-mutating tool, or a tenth ACTION tool.
- Do not duplicate owner-service logic inside handlers or the CLI.

## Open questions

1. The composition hook: WP-57's `lanes/agentic/register.ts` enumerates the registration functions it calls, and adding `registerFirmwareAuthoringSurface` plus the `fw` CLI subtree touches L7-owned files. That one-line wiring needs the L7 owner's coordinated edit or inclusion in the AMD-0015/WP-71 stub set — resolve with the coordinator before dispatch; do not edit another lane unilaterally.
2. Named human owners for the five skills — required before the WP can close as `reviewed`. The `fs-debug-bench` and `fs-instruments` owners must have bench time on the actual Eagle hardware.
3. Whether `fw bringup`/`fw port` start WP-95 workflow runs directly or only print the workflow-panel handoff in v1; starting a run is non-destructive, but resumable-run UX may argue for panel-first. Decide with the WP-95 owner.

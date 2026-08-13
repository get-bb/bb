# WP-64 — CLI — the full `bb finite-state` tree

**Lane:** L7 Agentic surfaces · **Spec:** SPEC 00 §9 · SPEC 06 §2.4–2.5 · RECON §1.9 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-57 and completed domain services · **Blocks:** WP-65, WP-70
**Produces a FROZEN artifact:** no

> **SPEC 07/08 intake note (2026-08-12).** Two subtrees join later without
> re-registering the root: `hw` (discover/extract/parts/nets/drc/erc/link,
> WP-81) and `fw` (ground/build/flash/serial/devices/claim/release/probe/
> bringup/port, WP-96). Structure the command tree and the metadata
> `commands` array so a lane can contribute a subtree; destructive verbs
> (`fw flash`) obey the AMD-0013 in-turn rule and are never satisfiable by a
> `--yes`-style bypass.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/agentic/cli/register.ts
plugins/bb-plugin-finite-state/lanes/agentic/cli/parser.ts
plugins/bb-plugin-finite-state/lanes/agentic/cli/render.ts
plugins/bb-plugin-finite-state/lanes/agentic/cli/metadata.ts
plugins/bb-plugin-finite-state/lanes/agentic/cli/cli.test.ts
plugins/bb-plugin-finite-state/lanes/agentic/cli/metadata.test.ts
```

## Files you must not touch
Composition roots, frozen interfaces, owner services, agent tools, skills, manifest, dependencies, or fixtures.

## Context
bb generates its `plugin-commands` skill from static CLI registration metadata without executing plugin code, so every command and flag is also agent-readable and reachable from a shell-capable agent. Therefore v1 cannot honestly make an executable CLI push or HBOM acceptance “human-only” with TTY detection, a typed prompt, or a bypass flag. Those verbs remain for workflow continuity, but are non-mutating handoffs that validate state and direct the operator to the appropriate human review panel. Only those panels own upstream push and HBOM acceptance/rejection. Register once per factory execution under the non-reserved name `finite-state`.

## What to build
1. Register `bb.cli.register({name:"finite-state",summary,commands,run})` using the exact current SDK metadata shape verified against an official plugin.
2. Implement the canonical tree from SPEC 06 §2.4: connect; project list/use; top-level pull/status/plan/push; triage; tara; req; ears; verify; bom sbom/hbom; firmware; bench; doc.
3. Keep sync verbs verb-first at top level. Surface-scoped `triage pull|status|plan|push` are documented aliases routed to the same handler, not duplicate logic; both `push` spellings perform the same review handoff.
4. Make every list JSON-capable and cursor-paged. Cap JSON output at 1 MiB with an explicit truncation/cursor record; human tables use shared pure formatters.
5. Route all commands through owner services. CLI does not reimplement sync, validation, export, materialization, or run logic.
6. `push` never calls the upstream mutation service. It refreshes/validates the selected plan, prints the review-panel route and unresolved-conflict/blast-radius summary, and returns exit 3 while review is required. Likewise, `bom hbom accept|reject` validates the selected review item and hands off to the HBOM review panel without calling `hbom.review.resolve`. Do not implement `--yes`, confirmation input, environment bypasses, or any CLI path to either human-only mutation.
7. Preserve stdout for data and stderr for diagnostics; return stable non-zero codes for usage, configuration, validation/conflict, partial failure, and transport failure.
8. Write metadata summaries as recovery-aware agent documentation: “prepare/inspect the plan, then hand off to a human in the review panel.” Explicitly state that the CLI command does not push upstream; never advertise push as an agent tool.
9. Snapshot help/metadata and assert every canonical command and alias appears once.

## Interface contract
```ts
export const FINITE_STATE_COMMAND = {
  name: "finite-state",
  summary: "Work with Finite State findings, product-security models, BOMs, firmware evidence, and reviewable sync plans.",
  commands: [/* static canonical metadata; no plugin execution required */],
} as const;

export type CliExit = 0 | 2 | 3 | 4 | 5;
// 0 success; 2 usage/configuration; 3 validation/conflict; 4 partial failure; 5 transport/internal

export function registerFiniteStateCli(bb: BbPluginApi, ctx: PluginContext): void;
export function parseFiniteStateArgv(argv: readonly string[]): ParsedCommand;
export function runFiniteStateCommand(command: ParsedCommand, services: CliServices): Promise<CliExit>;
```

Canonical tree:
```text
connect; project list|use
pull|status|plan|push [surface]
triage list|set|apply-policy|import-vex|orphans|pull|status|plan|push
tara show; req list|show; ears convert; verify matrix|run|results
bom pull; bom sbom list|export; bom hbom seed|ingest|status|review|accept|reject|export
firmware pull|status|hydrate|diff
bench run|list|show|verdict
doc list|show|search
```

## Acceptance criteria
- [ ] One `finite-state` registration exposes the complete canonical tree and documented aliases.
- [ ] Metadata is static, accurate, and sufficient for the auto-generated `plugin-commands` skill.
- [ ] Top-level sync verbs are canonical; aliases call identical service functions.
- [ ] All list commands support JSON and paging; output cannot exceed 1 MiB silently.
- [ ] Both CLI `push` spellings and HBOM `accept|reject` are non-mutating review handoffs; tests prove they cannot reach `sync.push` or `hbom.review.resolve`, including under a TTY or noninteractive environment.
- [ ] Exit codes, stdout/stderr separation, and partial failure behavior are stable and tested.
- [ ] `bench run` takes positional `pv_id`; `--target` is optional.
- [ ] CLI uses owner services and adds no new dependencies.

## Test plan
`metadata.test.ts`
- snapshot canonical commands, summaries, aliases, and flags.
- `metadata can generate plugin-commands skill without running plugin code`.
- `reserved-name and duplicate-command assertions` (**registration error path**).

`cli.test.ts` through `harness.runCli`
- happy-path table and JSON for each command family.
- top-level and triage-scoped sync aliases call one service with same args.
- `push with or without resolved conflicts exits 3, prints the review route, and never invokes upstream` (**safety path**).
- `push rejects --yes as an unknown flag and never invokes upstream` (**agent-shell safety path**).
- `hbom accept/reject prints the exact review-panel route and never invokes resolution` (**agent-shell safety path**).
- oversized JSON prints cursor/truncation envelope and remains valid JSON.
- unconfigured Forge returns setup guidance without stack trace.

## Do not
- Do not make surface-first sync forms canonical or implement duplicate handlers.
- Do not add `--yes`, TTY/typed-confirmation gates, hidden flags, environment bypasses, or any CLI call to upstream push, conflict resolution, HBOM acceptance/rejection, lifecycle review transitions, or manual attestation; none is a trustworthy human boundary for an agent-readable shell command.
- Do not expose arbitrary Forge paths, raw SQL, or server UUID-oriented commands.
- Do not mix diagnostics into JSON stdout.
- Do not describe `push` as agent-safe merely because it appears in generated command docs.

## Open questions
1. Verify the current nested `commands` metadata schema and help-render behavior in the bb fork before finalizing snapshots.
2. Decide whether `--json` envelopes reuse tool cursors byte-for-byte; prefer reuse unless CLI stability requires versioned wrapping.
3. A future executable CLI push requires a bb platform primitive that proves a distinct human authorization and is not mintable or replayable from an agent shell. Until that primitive is verified, do not weaken the review-panel-only boundary.

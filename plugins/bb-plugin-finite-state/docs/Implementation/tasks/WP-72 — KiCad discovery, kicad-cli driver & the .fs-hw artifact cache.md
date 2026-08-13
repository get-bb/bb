# WP-72 — KiCad discovery, kicad-cli driver & the .fs-hw artifact cache

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §2, §4, §5 (`hw_project`/`hw_artifact`), §9 · SPEC 01 §2 (CACHED class) · SPEC 00 §5 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-71 · **Blocks:** WP-73, WP-74, WP-76, WP-77
**Produces a FROZEN artifact:** no — consumes the WP-71-amended schema, contract, and lane stub; owns only lane-local modules

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/register.ts
    plugins/bb-plugin-finite-state/lanes/hardware/discovery.ts
    plugins/bb-plugin-finite-state/lanes/hardware/extract/driver.ts
    plugins/bb-plugin-finite-state/lanes/hardware/extract/cache.ts
    plugins/bb-plugin-finite-state/lanes/hardware/extract/provenance.ts
    plugins/bb-plugin-finite-state/lanes/hardware/extract/watch.ts
    plugins/bb-plugin-finite-state/lanes/hardware/**/*.test.ts
    plugins/bb-plugin-finite-state/test/fixtures/kicad/**  (additions only; see its README)

The registration file replaces WP-71's hardware backend stub and wires the `hardware.projects.list` / `hardware.artifacts.status` / `hardware.extract.*` handlers to lane modules. Where WP-73/77 modules do not exist yet, create compiling NOT_IMPLEMENTED placeholders at their exact future-owned paths.

## Files you must not touch

`server.ts`, `app.tsx`, `shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `lib/agentic/registry.ts`, `test/mock-remote/fixtures/**`, `package.json`, `pnpm-lock.yaml`, any other lane, or any `.kicad_*` file — KiCad owns those; this lane is read-only over them.

## Context

KiCad remains the editor; this WP is the extraction seam under everything else in L9. The KiCad project is source in the worktree, never our data. Derived artifacts (sheet SVGs, board SVG/GLB, BOM, netlist, gerbers, drill, DRC/ERC JSON) are CACHED: regenerable, content-addressed by the hash of the source file they were made from, gitignored, indexed in `hw_project`/`hw_artifact`.

`kicad-cli` ships with KiCad 7+ and runs headless — a background job, not an integration. But it is a host prerequisite CI does not have: every capability that needs it sits behind `bb.status.needsConfiguration`, and parsing (WP-73) must keep working when it is absent. Two projects per worktree are supported; `project_key` (relative path of the `.kicad_pro`) is the discriminator.

The cache mirrors the `.fs-firmware` discipline from WP-47, including its ignore tripwire: verify `.fs-hw` is gitignored before writing, and fail with `HW_CACHE_NOT_IGNORED` rather than polluting diffs.

## What to build

1. Replace the hardware backend stub. Registration is reload-safe, uses `ctx.service` for shared handles, and exports the extract action service for WP-81's `fs_hw_extract` and command handlers for the CLI WP — it does not call `bb.agents.registerTool` or `bb.cli.register` itself.
2. Discovery: scan the worktree for `.kicad_pro` files, resolve each project's root schematic and optional `.kicad_pcb`, hash the sources, read the file-format version for compat gating, and upsert `hw_project`. Ignored/untracked projects get the `.worktreeinclude` hint in the status payload (SPEC 07 §2).
3. `kicad-cli` detection: locate the binary, parse `kicad-cli version`, require 7+, and publish a capability record consumed by `needsConfiguration` and by the panel's unconfigured state. Detection failure is a degraded capability, not an error.
4. The driver: one function per export in SPEC 07 §4 (sheet SVG with `--no-background-color --exclude-drawing-sheet`, BOM CSV, netlist, ERC JSON, board SVG/GLB, gerbers, drill, DRC JSON). Non-zero exit captures stderr verbatim into the failure result — the error state renders it.
5. Cache layout `.fs-hw/<project-hash>/…` per artifact kind, with sheet SVGs under `sheets/`. Before any write, verify the ignore rule (step 8 of WP-47's pattern). Content addressing: an artifact is fresh iff its recorded `source_hash` equals the current source file hash; re-export only on change, `--force` overrides.
6. Provenance per artifact into `hw_artifact`: source path, `source_hash`, `cli_version`, `generated_at`. Every derived value must be able to name where it came from.
7. Extract jobs: `hardware.extract.start` enqueues per-project extraction with per-artifact results (partial failure allowed — a missing `.kicad_pcb` skips board artifacts, it does not fail the sch exports); `hardware.extract.status` reports progress. Publish `hardware:changed` as a refetch hint only.
8. File-watch on the discovered KiCad sources: on change, mark affected artifacts stale and publish the hint so panels show a re-extract banner. **Never auto-regenerate — not on watch events, and never during an agent run.** Regeneration happens only via explicit UI action, CLI, or `fs_hw_extract`.

## Interface contract

    export interface KicadCapability {
      installed: boolean;
      cliPath: string | null;
      version: string | null;      // "8.0.4"; null when not installed
      supported: boolean;          // version >= 7
    }

    export type HwArtifactKind =
      | "sheet_svg" | "board_svg" | "glb" | "bom" | "netlist"
      | "gerber" | "drill" | "drc" | "erc";

    export interface HwArtifactStatus {
      projectKey: string;
      kind: HwArtifactKind;
      sheetPath: string | null;    // null except sheet_svg
      path: string;                // inside .fs-hw/<project-hash>/
      sourceHash: string;
      cliVersion: string | null;
      generatedAt: string;
      fresh: boolean;              // sourceHash === current source hash
    }

    export interface ExtractResult {
      projectKey: string;
      produced: HwArtifactStatus[];
      failures: { kind: HwArtifactKind; exitCode: number; stderr: string }[];
    }

    export function discoverProjects(worktreeRoot: string): Promise<KicadProjectRow[]>;
    export function detectKicadCli(): Promise<KicadCapability>;
    export function runExtract(worktreeRoot: string, projectKey: string,
      kinds: HwArtifactKind[], opts?: { force?: boolean }): Promise<ExtractResult>;

The worktree root comes from the verified invoking execution context, as WP-47 established — never from process cwd.

## Acceptance criteria

- [ ] A fixture worktree with two `.kicad_pro` projects yields two `hw_project` rows keyed by relative path, each with correct source hashes.
- [ ] With `kicad-cli` absent, discovery and status RPCs work, extraction returns a typed `KICAD_NOT_INSTALLED` failure, and the capability record drives `needsConfiguration`.
- [ ] Extraction is skipped when `source_hash` is unchanged and re-runs when it differs or `--force` is set; provenance rows record path, hash, CLI version, and timestamp.
- [ ] A failing export surfaces the verbatim `kicad-cli` stderr in the result; other artifact kinds in the same run still complete.
- [ ] Writing into a non-ignored `.fs-hw` aborts with `HW_CACHE_NOT_IGNORED` before any file is created.
- [ ] A source edit marks artifacts stale and publishes `hardware:changed`; nothing regenerates without an explicit request.
- [ ] All list RPC handlers return `{items, total, cursor}`; real SQLite throughout.

## Test plan

- `discovery.test.ts` — zero/one/two projects, missing pcb, KiCad 5 project recorded with `supported: false`, hash stability across re-scan. Uses `test/fixtures/kicad/` projects.
- `driver.test.ts` — command construction per kind; version parse of real and garbage output; **error path:** non-zero exit yields stderr in the failure and no artifact row; binary absent yields `KICAD_NOT_INSTALLED`. Live-export cases skip cleanly when `kicad-cli` is absent (CI has none).
- `cache.test.ts` — content-address freshness truth table, force re-export, partial-failure run leaves prior fresh artifacts intact; **error path:** un-ignored `.fs-hw` aborts before write.
- `watch.test.ts` — edit → stale + hint published, no subprocess spawned; agent-run guard refuses auto-regeneration.

## Do not

- Do not write, format, or "fix" any KiCad file; do not follow symlinks out of the worktree when hashing.
- Do not auto-regenerate on file change or mid-agent-run; the banner-and-explicit-action flow is the contract.
- Do not put artifacts, `.fs-hw`, or placeholder files in git, or store artifact bytes in SQLite — rows index files.
- Do not parse S-expressions here (WP-73 owns semantics) or render anything (WP-74+).
- Do not register agent tools, CLI, mentions, or directives; export services for their central WPs.

## Open questions

1. `kicad-cli` flags drift across 7/8/9 (e.g. ERC JSON arrived in 8). Decide the true minimum version per artifact kind during implementation and gate per-capability, not globally; record what the fixture `expected/` outputs were generated with.
2. Is `<project-hash>` the hash of the `project_key` string (stable across edits) or of source content (changes every save)? Recommendation: hash of `project_key`, with content hashes living at the artifact level — confirm before the layout ships.
3. Very large sheets produce heavy SVGs (SPEC 07 §9). Measure on the real fixture project before adding any coarse-render optimization here.

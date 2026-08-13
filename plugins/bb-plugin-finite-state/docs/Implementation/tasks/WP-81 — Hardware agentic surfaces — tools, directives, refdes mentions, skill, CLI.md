# WP-81 — Hardware agentic surfaces — tools, directives, `#refdes` mentions, skill, CLI

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §8 · SPEC 06 §2.5, §4, §5.3 · AMD-0013 · WP-57 conventions · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-57, WP-73–80 · **Blocks:** — (WP-98's v2 beat consumes these surfaces but degrades to the v1 stub without them)
**Produces a FROZEN artifact:** no — consumes the AMD-0013-amended agentic registry; the closed `ActionToolName` union stays WP-71's

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/agentic/tools.ts
    plugins/bb-plugin-finite-state/lanes/hardware/agentic/tool-schemas.ts
    plugins/bb-plugin-finite-state/lanes/hardware/agentic/directives.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/agentic/mentions.ts
    plugins/bb-plugin-finite-state/lanes/hardware/agentic/cli.ts
    plugins/bb-plugin-finite-state/lanes/hardware/agentic/**/*.test.ts
    plugins/bb-plugin-finite-state/lanes/hardware/agentic/**/*.test.tsx
    plugins/bb-plugin-finite-state/skills/fs-hardware/SKILL.md

Replace WP-72's compiling NOT_IMPLEMENTED placeholders in place. Registration flows through existing seams: tools/directives via the hardware lane registration (WP-72), the mention source and CLI subtree as exports the L7-owned `fs-intel` provider and `finite-state` tree consume — this WP registers no second `#` provider and no second top-level CLI command.

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts, lib/agentic/registry.ts, lanes/agentic/**, lanes/hardware/register.ts, other lanes, skills outside `skills/fs-hardware/`, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml.

## Context

Four tools per SPEC 07 §8, all obeying WP-57's laws: reads return **summaries with references, not dumps**; pagination defaults 50/caps 200 under the ~4 KiB soft budget; writes return `{path, op, diff_summary}`; errors are `{code, message, hint, retryable}` with hints naming the next call. `fs_hw_extract` is the fourth ACTION-class tool — a **local subprocess** (`kicad-cli`), closer to `fs_firmware_materialize` than to anything server-touching. Its allowlist entry already exists in the amended union (AMD-0013, nine names); this WP implements the handler and must not grow the union. `kicad-cli` absence is `needsConfiguration`, and every test that would need it skips cleanly with a named reason. Naming note: `fs_hw_part` has no verb, deviating from SPEC 06 §2.5 — it is spec'd by SPEC 07 §8 and grandfathered like `fs_hbom_review`; do not rename and do not cite it as precedent.

Directives mount self-fetching domain components owned by WP-74–77; attributes arrive as untrusted strings and are validated per-directive. Mentions extend the consolidated `fs-intel` on `#` to resolve reference designators (`#U3`) — disambiguated by pattern, the surface named in the result label so `#U3` never silently resolves to a software package, and `resolve()` never throws. The CLI `hw` group registers through the WP-64 tree with a metadata-only `commands` array feeding bb's auto-generated plugin-commands skill.

## What to build

1. `fs_hw_query` (read): `kind: projects | symbols | nets | violations` with per-kind filters (sheet, value/footprint substring, net name, severity, rule). Paged summaries carrying refdes/net/violation ids and freshness; the description names its paired directives.
2. `fs_hw_part` (read): everything about one reference designator across linked surfaces — units, value, footprint, MPN, HBOM cell summary with provenance, SBOM components with open-CVE counts, threat node, requirements, firmware paths, latest DRC state — assembled from the WP-79 resolver. Gaps arrive as explicit readiness reasons, never omissions.
3. `fs_hw_link_write` (write): proposes `links/hardware.yaml` entries through the WP-79 CAS path with `by: agent` and no `accepted` record — **YAML only**. Returns path/op/diff summary; a CAS conflict returns `HW_LINKS_STALE` with a reload hint.
4. `fs_hw_extract` (ACTION): dispatches the WP-72 extract job (`kinds`, `force`). Returns a job reference for status polling, not a completion claim; marked non-idempotent — on ambiguity, check status via `fs_hw_query {kind:"projects"}`, never re-dispatch. Missing `kicad-cli` returns `kicad_cli_unavailable` with install guidance, `retryable: false`. Never auto-triggered by a read tool during an agent run.
5. Strict Zod parameter schemas; unknown keys fail; cursors opaque; enums from the owning contracts.
6. Directives `::fs-schematic{project,sheet,focus}`, `::fs-part{ref}`, `::fs-board{project,view}`, `::fs-drc{project}`: per-directive schemas over string attributes (bounded ids, `view: "2d"|"3d"` default `2d`), each mounting the owner lane's self-fetching component under the shared boundary — loading skeleton, cold-cache "extract to load" state, retryable error, unconfigured. Theme tokens, `@bb/shared-ui`, Hugeicons only; the schematic directive is height-clamped and links "Open in panel".
7. The `fs-intel` refdes source: `search` matches the refdes pattern (`^[A-Z]{1,4}[0-9]+[A-Z]?$`) against `hw_symbol`, cache-only, deadline-bound, results labeled *"U3 — hardware part (schematic)"* with ids namespaced `hw:`; `resolve` returns a compact context block (identity, value/footprint/MPN, link summary, freshness, `::fs-part` syntax) and converts every failure — including a deleted symbol — to safe explanatory context. Exported for the L7 provider; if WP-62's implementation lacks a source seam, coordinate the one-line L7 change rather than editing it.
8. CLI `bb finite-state hw discover | extract [--force] | parts [--sheet] | nets [--name] | drc | erc | link <ref> --hbom <part>`: metadata + handlers exported for the WP-64 tree; every list `--json`-capable and cursor-paged under the 1 MiB cap; `drc|erc` and `extract` report `needsConfiguration` guidance without a stack trace when `kicad-cli` is absent; `link` writes a `by: agent`-equivalent proposal (`by: human` requires the panel — the CLI is agent-readable and cannot prove a human).
9. `skills/fs-hardware/SKILL.md` (directory name equals frontmatter `name: fs-hardware`): trigger-style description; the refdes-as-join-key vocabulary up front; the query→id→directive pairing; the four directive syntaxes; the extract etiquette (check freshness, never re-extract mid-run); and the concrete NEVER list — never edit KiCad files (KiCad owns them), never assert an HBOM value the design doesn't support, always propose links, never write them as fact.

## Interface contract

    export function registerHardwareAgentTools(bb: BbPluginApi, ctx: PluginContext): void;
    export function registerHardwareDirectives(app: PluginAppBuilder, ctx: AppContext): void;
    export const hardwareIntelSource: {
      pattern: RegExp;                                     // refdes match, e.g. ^[A-Z]{1,4}[0-9]+[A-Z]?$
      search(query: string, signal: AbortSignal): Promise<MentionItem[]>;   // ids "hw:<project>:<ref>"
      resolve(itemId: string): Promise<{ context: string }>;                // never throws
    };
    export const HW_CLI_GROUP: { name: "hw"; summary: string; commands: readonly CliCommandMeta[] };
    export function runHwCommand(command: ParsedCommand, services: HardwareCliServices): Promise<CliExit>;

    // fs_hw_query → Page<{ id; kind; reference?; net?; value?; footprint?; sheet?; severity?; rule? }>
    // fs_hw_part  → { reference, projectKey, units, value, footprint, mpn,
    //                 hbom: { partId, cellSummary } | { reason },
    //                 sbom: { components: [{purl, openCves, proposal}] } | { reason },
    //                 threatNode, requirementIds, firmwarePaths, drc: { state, sourceHash },
    //                 freshness } — paired directive: fs-part
    // fs_hw_link_write { reference, patch } → { path, op: "create"|"update"|"noop", diff_summary }
    // fs_hw_extract   { projectKey, kinds?, force? } → { jobId, projectKey, status: "started" }

    export const hardwareDirectiveSchemas = {
      "fs-schematic": z.strictObject({ project: boundedId, sheet: boundedPath.optional(), focus: boundedRef.optional() }),
      "fs-part":      z.strictObject({ ref: boundedRef, project: boundedId.optional() }),
      "fs-board":     z.strictObject({ project: boundedId, view: z.enum(["2d", "3d"]).default("2d") }),
      "fs-drc":       z.strictObject({ project: boundedId }),
    } as const;

Registry entries for the four tools and four directive ids are WP-71's under the approved AMDs; implementations here must match them exactly or stop and report.

## Acceptance criteria

- [ ] Exactly four tools register, matching the amended registry's names, classes, and server access; `fs_hw_extract` is the only ACTION and invokes only the local extract service.
- [ ] No tool returns SVG bytes, GLB bytes, gerber contents, full netlists, or unpaged symbol dumps; seed-project responses meet the WP-57 budget policy.
- [ ] `fs_hw_link_write` writes YAML proposals only; no path to `accepted`, no push, no server mutation reachable from any handler import.
- [ ] All four directives validate attributes, render all four UI states, survive cold cache offline, and reuse owner components without forking them.
- [ ] `#U3` search names the hardware surface in its label; a colliding software match remains separately listed; `resolve()` never throws, including for a vanished refdes.
- [ ] The `hw` CLI group appears once in the WP-64 tree; metadata alone generates correct plugin-commands documentation; lists page and cap JSON output.
- [ ] Missing `kicad-cli` yields `needsConfiguration` guidance everywhere it matters, and affected tests skip cleanly with a named reason rather than failing.
- [ ] Skill directory name equals frontmatter name; the skill's prohibitions match the safety model verbatim.

## Test plan

- tools.test.ts — schema/shape per tool including unknown-key rejection; `part summary for a fully linked refdes stays under budget`; `link_write CAS conflict returns HW_LINKS_STALE with reload hint` (**write error path**); `extract without kicad-cli returns kicad_cli_unavailable guidance` (**configuration error path**); static import scan: no non-action handler reaches an action/subprocess module.
- directives.test.tsx — valid/malformed attributes per schema; cold- and warm-cache renders; `RPC failure renders retry card without crashing the message` (**runtime error path**); no directive triggers an extract.
- mentions.test.ts — refdes pattern routing beside CVE/purl/MPN without duplicate results; `resolver exception converts to safe context` (**send-blocking error path**); deleted symbol resolves as missing.
- cli.test.ts via `harness.runCli` — table and JSON per command; `link writes a proposal and prints the review expectation`; oversized JSON emits cursor/truncation envelope.

## Do not

- Do not add a fifth tool, extend the ACTION union, or edit `lib/agentic/registry.ts` — that is WP-71's, under amendment only.
- Do not register a second `#` mention provider or a second top-level CLI command.
- Do not let any surface edit KiCad files, write HBOM cells, accept links, or auto-run `kicad-cli` from a read path.
- Do not dump raw parse trees, embed artifact bytes in tool results, or exceed page caps.
- Do not use hex colors, Lucide, or emoji; do not skip the four states.

## Open questions

1. Confirm WP-71 added the four directive ids to the guarded registry's directive set alongside the AMD-0013 tool entries; if it only grew the tool union, file the gap against WP-71 before registering directives.
2. The exact refdes regex (multi-letter prefixes like `SW`, `FB`, unit suffixes) should be derived from the fixture projects' actual reference population, not folklore; record the final pattern here.
3. Whether `fs_hw_query {kind:"projects"}` doubles as extract-job status or a dedicated status shape is needed; prefer reuse unless polling ergonomics demand otherwise.

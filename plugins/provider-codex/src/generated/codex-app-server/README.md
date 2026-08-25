# Codex App-Server Type Generation

`plugins/provider-codex/src/generated/codex-app-server/schema/` is generated directly from the local `codex` binary.

## Regenerate (stable API surface)

```bash
codex app-server generate-ts --out <tmp-dir>
```

## Regenerate (stable + experimental API surface)

```bash
codex app-server generate-ts --experimental --out <tmp-dir>
```

## What the generator does

1. Runs `codex app-server generate-ts --out <tmp-dir>`.
2. Copies the generated schema files into `schema/`.
3. Rewrites relative imports to include `.js` extensions for NodeNext.
4. Writes `export *` barrels (`index.ts`, `schema/index.ts`, `schema/v2/index.ts`).

## Committed state: pruned to the reachable subset

We do **not** commit the generator's full output. The hand-written Codex
adapter imports concrete schema files directly (e.g.
`schema/v2/SandboxPolicy.js`) and never imports the barrels, so most emitted
types are unreachable. The committed tree is therefore pruned to the
transitive type-import closure of the hand-written importers:

- `translator.ts`, `visibility.ts`, `interactive-requests.ts`,
  `session-params.ts`, `bridge/bridge.ts`, and their `*.test.ts` files.

At the last regenerate (Codex 0.149.1) that was 235 of the 663 emitted
files; the unreachable files and all three `export *` barrels (`index.ts`,
`schema/index.ts`, `schema/v2/index.ts`) were removed. Nothing imports the
barrels, so their removal is type-safe.

### Re-prune after regenerating

A regenerate (the commands above) re-emits the full set plus the barrels.
The committed tree matches the **stable** surface; the hand-written code
uses no experimental fields. After copying the schema in, rewrite relative
imports to `.js` specifiers, delete everything not reachable from the
importers listed above (and the barrels), then verify:

```bash
pnpm exec turbo run typecheck --filter=bb-plugin-provider-codex
```

TypeScript reports any over-deletion as a missing-module error; a green
typecheck plus `pnpm exec turbo run test --filter=bb-plugin-provider-codex` confirms
the kept subset is complete. Keep it pruned to avoid re-vendoring dead types.

## Source of truth

- `schema/*.ts`: generated from Codex app-server, pruned to the reachable subset (see above).
- `index.ts` / barrels: intentionally **not** committed; the adapter imports concrete `schema/**` files directly.
- `plugins/provider-codex/src/event-translation.ts`: translates Codex app-server events into bb thread events.

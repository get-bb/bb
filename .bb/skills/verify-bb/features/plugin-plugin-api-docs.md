# Plugin Guide

Status: **source-documented; live execution pending**.

## Setup and entry points

Open Plugin Guide; source of surface inventory is packages/plugin-api-map/src/surfaces.ts. This is the in-app public API guide.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/plugin-api-docs/package.json`
- `plugins/plugin-api-docs/server.ts`
- `plugins/plugin-api-docs/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Guide maps | Visit app window, palette, composer, home, settings, plugin detail, and backend maps. | Each map renders its annotated fixture and matching numbered cards. |
| Cards and symbols | Select representative cards, inspect SDK symbols/examples, and follow internal links. | Card, annotation, symbol and example describe the same current API surface. |
| Navigation and agent context | Reload a surface URL, use Copy for agent, and resolve an @surface mention. | Selection survives routing; copied/resolved context identifies the correct surface and symbols. |
| Inventory reconciliation | Compare every surface in surfaces.ts with visible Guide cards, especially after a public SDK change. | No source surface lacks its documented map/card; use plugin-guide-maintenance for actual guide repairs. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.

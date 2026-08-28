---
name: plugin-guide-maintenance
description: Keep the Plugin Guide aligned with public Plugin SDK changes that affect its documented contract. Use this skill when an addition, change, rename, stabilization, or removal in @get-bb/plugin-sdk, app.slots.*, or BbPluginApi changes a Guide card, API symbol list, fixture, or SDK inventory. Do not use it for internal API work or interface-only changes that leave the Guide accurate.
---

# Maintain the Plugin Guide for a public API change

The Plugin Guide is bb's public Plugin SDK reference. Use this workflow only
when a public API change affects its documented contract.

## Confirm the trigger

Build the declarations and inspect the SDK change:

```sh
pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk
git diff -- packages/plugin-sdk/package.json packages/plugin-sdk/src
```

Continue only when the API change affects a Guide card, API symbol list,
fixture, or SDK inventory. If the Guide remains accurate, do not change it.

New public members also require:

- an `experimental_` name, or an `Experimental` type name;
- an entry in `docs/api_to_audit.md`;
- compatibility with released SDK users unless the user approves the break.

## Find the product source

For a visible method, inspect these sources:

1. The app component that shows the surface.
2. The slot, collector, or adapter that inserts the plugin content.
3. The closest app test that defines the real states.

Record stable source paths and anchors in
`packages/plugin-api-map/src/anatomy-manifest.json`. Use labels, roles, data
attributes, class constants, and state names as anchors.

For a method without a visible surface, use the Plugin backend group. Do not
invent interface elements.

## Add the Guide entry

For a new Guide entry, run the scaffold command with its sources and symbols:

```sh
pnpm exec turbo run scaffold:surface-entry --filter=@bb/plugin-api-map -- \
  --id <stable-id> \
  --title "<visible-product-object>" \
  --group <group> \
  --source <source-path> \
  --api-symbol <exported-name>
```

Complete the applicable changes:

- Update `packages/plugin-api-map/src/surfaces.ts`.
- Prefer an existing card unless the API creates a new product surface.
- Keep existing surface IDs stable and list each exact exported symbol.
- For a visible method, update `wireframes.tsx` and its marker.
- Match the real ownership, labels, roles, order, states, actions, and outcome.
- Keep Guide annotations separate from the product interface.
- Add focused tests for the entry, source anchors, trigger, and outcome.

## Refresh the SDK inventory

Refresh the inventory after the Guide represents the API change:

```sh
pnpm exec turbo run update:sdk-inventory --filter=@bb/plugin-api-map
```

Review `packages/plugin-api-map/sdk-public-api.json`. Do not edit its hashes.

## Verify the result

```sh
pnpm exec turbo run test typecheck \
  --filter=@get-bb/plugin-sdk \
  --filter=@bb/plugin-api-map \
  --filter=@bb/app \
  --filter=bb-plugin-plugin-api-docs
bb plugin build plugins/plugin-api-docs
```

For a visible API change, start `scripts/bb-dev-app current`. Inspect the
affected entry and each reachable action.

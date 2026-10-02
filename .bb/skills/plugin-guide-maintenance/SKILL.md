---
name: plugin-guide-maintenance
description: "Update Plugin Guide cards, fixtures, and annotations when public SDK contracts or Guide presentation change."
---

# Maintain the Plugin Guide

The Plugin Guide is bb's public Plugin SDK reference. For a public API change,
follow the full workflow. For annotation-only maintenance, start at Maintain
annotation layout, skip the public-API section, and then follow the
annotation-only verification path.

## Confirm a public API change

Build the declarations and inspect the SDK change:

```sh
pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk
git diff -- packages/plugin-sdk/package.json packages/plugin-sdk/src
```

Continue only when the API change affects a Guide card, API symbol list, or
fixture. If the Guide remains accurate, do not change it.

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
`plugins/plugin-api-docs/src/anatomy-manifest.json`. Use labels, roles, data
attributes, class constants, and state names as anchors. The `@bb/app` tests
check the anchors against the source.

For a method without a visible surface, use the Plugin backend group. Do not
invent interface elements.

## Add the Guide entry

For a new Guide entry, run the scaffold command with its sources and symbols:

```sh
pnpm exec turbo run scaffold:surface-entry --filter=bb-plugin-plugin-api-docs -- \
  --id <stable-id> \
  --title "<visible-product-object>" \
  --group <group> \
  --source <source-path> \
  --api-symbol <exported-name>
```

Complete the applicable changes:

- Update `plugins/plugin-api-docs/src/surfaces.ts`.
- Prefer an existing card unless the API creates a new product surface.
- Keep existing surface IDs stable and list each exact exported symbol.
- Name example plugins in `firstParty` by display name. A plugin missing from
  `plugins/plugin-api-docs/src/first-party-plugins.json` needs a row there;
  the `@bb/scripts` tests check each row against the plugin's manifest.
- For a visible method, update `wireframes.tsx` and its marker.
- Match the real ownership, labels, roles, order, states, actions, and outcome.
- Keep Guide annotations separate from the product interface.
- Add focused tests for the entry, source anchors, trigger, and outcome.

## Maintain annotation layout

Annotation numbers follow the rendered fixture: columns from left to right,
then annotations within each column from top to bottom. Read annotations that
share a row from left to right.

Treat each annotation's badge, visible target, and interactive overlay as
separate layout contracts. Whenever an annotation is added, removed, moved, or
renumbered, or its target or surrounding layout changes:

1. Build and reload the real Plugin Guide at each relevant viewport. Redraw the
   complete affected sequence, then update `surfaces.ts` and the focused
   order test. `test/wireframes.test.ts` ("draws exactly the surfaces of each
   visual group on its fixture") fails until the fixture's targets match the
   group's surface ids.
2. Inspect each rendered badge footprint, including its outline, ring, and
   hover scaling. It must remain inside its container, not intersect another
   badge, and leave its annotated content readable.
3. Inspect target and overlay bounds, including shared edges and nested areas.
   An overlay must not enter a sibling surface, cover its content, or capture
   its hover, focus, or click behavior. A nested child must own its full visible
   target; do not rely on DOM order or `z-index` to resolve ownership.
4. Hover, focus, and click every affected badge and visible target. Confirm
   that only the matching annotation activates, the full target is reachable,
   and badge numbers, cards, and previous/next navigation agree.
5. Add or update a focused test for any boundary or ownership rule that could
   regress. Every annotation must appear exactly once; DOM nesting alone does
   not prove correct overlay ownership.

If responsive layouts cannot share one spatial order, fix the layout or define
one stable readable sequence before shipping.

## Verify the result

For a public API change, run:

```sh
pnpm exec turbo run test typecheck lint \
  --filter=@get-bb/plugin-sdk \
  --filter=@bb/app \
  --filter=bb-plugin-plugin-api-docs
bb plugin build plugins/plugin-api-docs
```

When `first-party-plugins.json` changes, also run
`pnpm exec turbo run test --filter=@bb/scripts`.

For annotation-only maintenance, use the affected package and Plugin Guide
checks required by repository validation policy. Start
`pnpm dev`; inspect the affected entry and reachable actions
for a public API change, or the affected annotations and adjacent interactive
surfaces for annotation-only maintenance.

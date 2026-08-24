---
name: plugin-guide-maintenance
description: Keep bb Plugin Guide synchronized with public @get-bb/plugin-sdk API changes. Use whenever adding, changing, stabilizing, renaming, or removing a public Plugin SDK export, BbPluginApi member, app.slots method, composer API, provider bridge API, host API, or testing API; and when the Plugin Guide API inventory test fails.
---

# Maintain bb Plugin Guide

The Plugin Guide is bb's only public Plugin SDK documentation. Update it in
the same change as every public API delta; do not refresh the inventory alone.

## 1. Establish the public contract delta

Build the portable declarations, then inspect the changed source contracts:

```sh
pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk
git diff -- packages/plugin-sdk/package.json packages/plugin-sdk/src
```

The generated declarations are gitignored. The inventory command below reads
them after the build. Include every non-internal package export: root, app,
host, AI services, provider bridge subpaths, and testing subpaths.

For a new public member, first enforce the repository contract:

- name it with `experimental_` (or `Experimental` for a type);
- add its audit entry to `docs/api_to_audit.md`;
- preserve compatibility with released SDK consumers unless the user has
  explicitly approved the exact break and migration.

## 2. Update the reader-facing surface

Edit `packages/plugin-api-map/src/surfaces.ts`.

- Put the API on the existing card that represents where or why authors use
  it. Create a card only when it introduces a genuinely new product surface.
- Add exact exported names to `apiSymbols`.
- Update the summary or bullets when behavior, ownership, lifecycle, or
  constraints changed. Keep the card concise; link related surfaces instead
  of repeating tutorials.
- Add or update `firstParty` examples only when a maintained in-repo plugin
  actually exercises the API.
- For a visual surface, update its marker/wireframe and focused tests. For a
  backend-only capability, place it in the Plugin backend group.

Surface `id` values are persisted reference identities used by “Copy for
agent.” Do not rename or reuse one casually. If a rename is unavoidable,
preserve resolution for the old id or treat it as a compatibility decision.

## 3. Refresh the exhaustive inventory

Only after the guide content represents the delta, update the canonical
comment-free declaration hashes:

```sh
pnpm exec turbo run update:sdk-inventory --filter=@bb/plugin-api-map
```

Review `packages/plugin-api-map/sdk-public-api.json`. A new package export must
appear as a new key; a changed hash must correspond to the contract delta you
just documented. Do not hand-edit hashes.

## 4. Verify

```sh
pnpm exec turbo run test typecheck \
  --filter=@get-bb/plugin-sdk \
  --filter=@bb/plugin-api-map \
  --filter=bb-plugin-plugin-api-docs
```

For a user-visible card or marker change, launch the exact bb desktop dev build
and verify the affected slide, annotation card, Copy for agent action, and
composer paste result. Confirm multiple copied surface references remain
distinct pills.

The CI packages shard runs `@bb/plugin-api-map#test`. It rebuilds the public SDK
declarations and compares every non-internal exported subpath with the checked-
in inventory, so an API delta fails CI until this workflow is completed.

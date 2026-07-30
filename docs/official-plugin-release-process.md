# Releasing BB Official plugins

Official plugins ship **bundled inside the BB app**. There is no separate
publish pipeline: at packaging time, `apps/server/scripts/copy-builtin-plugins.ts`
builds every plugin declared in `BUNDLED_PLUGINS`
(`apps/server/src/services/plugins/builtin-registry.ts`) — the auto-installed
builtins in `plugins/*` and the store-only official plugins in
`official-plugins/*` — and copies each prebuilt runtime layout into
`<server dist>/builtin-plugins/<name>`. The app in Tools → Plugins → Browse
installs official plugins from that local bundled copy; no network is involved.

The official plugins are:

| Directory                 | Package name             | Store entry | Plugin id      |
| ------------------------- | ------------------------ | ----------- | -------------- |
| `official-plugins/github` | `bb-plugin-github`       | `github`    | `github`       |
| `official-plugins/docs`   | `bb-plugin-simple-notes` | `docs`      | `simple-notes` |
| `official-plugins/memory` | `bb-plugin-memory`       | `memory`    | `memory`       |
| `official-plugins/tasks`  | `bb-plugin-tasks`        | `tasks`     | `tasks`        |

## Releasing a change

1. Land the plugin change on `main` like any other code change. Bump the
   plugin's `package.json` version when the change is user-visible — the
   version is shown in plugin management and drives startup reconciliation
   (an installed official plugin re-points to the new bundled copy when its
   version or root directory changes).
2. Ship a normal BB app release. The packaging step rebuilds and bundles every
   official plugin automatically; installed plugins pick up the new code at
   the next server start.

Never check in `official-plugins/*/dist`; packaging builds it.

## Adding a new official plugin

1. Create the plugin under `official-plugins/<name>` with a `bb` manifest
   block (`server`, optional `app`, `branding`, optional `skills`).
2. Add an entry to `OFFICIAL_PLUGINS` in
   `apps/server/src/services/plugins/builtin-registry.ts` with the store
   `name`, the derived `pluginId`, `defaultEnabled`, and a `category` for the
   Browse tab. The registry-invariant test
   (`apps/server/test/services/plugins/official-plugins.test.ts`) verifies the
   declared plugin id matches the manifest.

## Verify locally

```bash
pnpm exec turbo run build --filter=bb-app
ls packages/bb-app/server/dist/builtin-plugins
```

Every bundled plugin directory must contain a rewritten `package.json`
pointing at `./dist/server.js` plus the prebuilt `dist/` artifacts. Then, in a
dev build:

```bash
bb plugin search docs
bb plugin install docs --yes
bb plugin list
bb plugin remove simple-notes
```

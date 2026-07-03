# bb-plugin-linear

The full-stack "Linear" hero plugin — a backend that syncs your open Linear
issues into a local cache, plus a frontend bundle that renders them inside
the BB app. Click an issue and BB spawns an attributed agent thread working
on it.

What it demonstrates (every plugin layer):

- **Settings** — `apiKey` as `secret: true` (a Linear personal API key),
  `teamKey` with a default, and a `defaultProject` project picker used as
  the spawn target when the click site has no project context.
- **`bb.storage.sqlite()` + `storage.migrate`** — the issue cache
  (id, identifier, title, description, state, updatedAt) lives in the
  plugin's own SQLite database; `bb.storage.kv` holds the sync cursor and
  the thread↔issue links.
- **`bb.background.schedule("sync-issues", "*/5 * * * *")`** — fetches open
  issues from the Linear GraphQL API (filtered to `teamKey` when set) and
  replaces the cache. A missing API key throws a name-matched
  `NeedsConfigurationError`, so the plugin reports "needs configuration"
  instead of crash-looping.
- **`bb.realtime.publish("issues-updated", { count })`** — fired only when a
  sync actually changed the cache; the frontend refetches on the signal.
- **`bb.rpc`** — `listIssues`, `startWork`, `issueForThread`, `listLinks`:
  the frontend bundle's data plane.
- **`bb.sdk.threads.spawn`** — `startWork` spawns in the clicked project (or
  `defaultProject`), with the server-resolved project-default environment;
  BB fills in `origin: "plugin"` and `originPluginId: "linear"`.
- **`bb.ui.registerMentionProvider("linear-issue")`** — type `@ENG-123` in
  the composer; the picked issue's identifier, title, state, and description
  are attached as agent-only context at send time.
- **`bb.cli.register("linear")`** — `bb linear issues` and `bb linear sync`,
  so agents (via bash) and humans share the same surface.
- **Frontend slots** (`app.tsx`, built by `bb plugin build` or automatically
  at install): an "Open Linear issues" homepage section (click → start work
  → navigate to the new thread), a "Linear" nav panel with a full-width
  by-state board plus a `headerContent` sync affordance (issue count + Sync
  button) in the shared app header, and an "Issue" thread panel tab that
  appears only on threads spawned from an issue. The `logo.svg` at the
  plugin root shows up on every contribution surface (sidebar, header,
  composer menus, Settings → Plugins); `logo-dark.svg` is the white variant
  bb prefers while the app is in dark mode.

## Setup

1. Create a Linear personal API key: Linear → Settings → Security & access →
   API keys → "New API key".

2. Install and configure (requires the "Plugins" experiment):

   ```
   bb plugin install ./examples/plugins/linear
   bb plugin config linear set apiKey lin_api_...
   bb plugin config linear set teamKey ENG          # optional
   bb plugin config linear set defaultProject proj_...
   bb plugin reload linear
   bb linear sync
   bb linear issues
   ```

The homepage section, the "Linear" sidebar panel, and `@`-mentions fill in
as soon as the cache has issues. `bb plugin logs linear` shows sync activity.

## Settings

| Setting          | Type              | Meaning                                                        |
| ---------------- | ----------------- | -------------------------------------------------------------- |
| `apiKey`         | string (secret)   | Linear personal API key; sent as the `Authorization` header.   |
| `teamKey`        | string (default `""`) | Sync only this team's issues (e.g. `ENG`); empty = all teams. |
| `defaultProject` | project           | Spawn target for `startWork` when no project is in view.       |

## The sync-visible() pattern (threadPanelTab)

`threadPanelTab`'s `visible({ threadId })` predicate is **synchronous** by
contract — it runs per render and must be cheap. But "is this thread linked
to a Linear issue?" is server-side state. Registering the tab for every
thread and rendering an empty state would put a dead "Issue" tab on every
thread, which the design forbids.

The canonical answer is a tiny module-level cache in `app.tsx`:

1. The backend exposes a `listLinks` rpc returning every linked thread id.
2. The bundle primes a module-level `Set<string>` from `listLinks` once at
   load (guarded with `typeof document !== "undefined"` so evaluating the
   bundle outside a browser stays side-effect free).
3. Mounted components refresh the cache on the `issues-updated` realtime
   signal, and `startWork` adds the just-spawned thread id immediately.
4. `visible()` is a pure synchronous read of the cache — `false` until it
   loads, so the tab never flashes on unrelated threads.

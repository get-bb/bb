# Plugin System — Manual QA Catalog

Living checklist of things to test by hand. Automated coverage is listed only
where it changes what's worth manually checking. Builders: append a section
for every slice you land. Setup for everything below:

```bash
scripts/bb-dev-app current          # dev server on this branch (isolated data dir)
eval "$(scripts/bb-dev-app env)"    # point pnpm bb:dev at it
# Enable: Settings → Experiments → Plugins (or PUT /api/v1/settings/experiments)
```

## Verified live (2026-07-01 smoke)

- [x] Experiment gate: `bb plugin list` refuses while off; live toggle via the
      real experiments route, no restart.
- [x] `bb plugin install <path> --yes` (trust prompt), plugin `running` in list.
- [x] Top-level proxy: `bb docs search conventions` returns plugin output.
- [x] `bb plugin run agent-enrichment search conventions` (argv excludes the
      command name), `bb docs last` (KV round-trip), `bb plugin config`.
- [x] Generated `plugin-commands` skill exists in `<dataDir>/skills-generated/`.
- [x] **Agent e2e**: codex thread (`--permission-mode workspace-write`) ran
      `bb docs search conventions` via bash and returned the plugin's output.
      Readonly mode CANNOT do this — codex readonly sandbox has no network,
      so every `bb` CLI call fails there (looks like "unknown command").

## Phase 1 — for you to test

- [ ] **Settings UI toggle**: flip Plugins on/off in Settings → Experiments in
      the browser (`http://localhost:15237`); confirm plugins load/unload live
      (`bb plugin list` between flips).
- [ ] **Slack bot with real Slack** (`examples/plugins/slack-bot/README.md`):
      create the Slack app, point event subscriptions at
      `/api/v1/plugins/slack-bot/http/events` (needs a tunnel for Slack to
      reach localhost), set `botToken`/`signingSecret`/project via
      `bb plugin config slack-bot set …`, @mention the bot → BB thread spawns
      → reply posted on idle. Check `needs-configuration` status shows before
      tokens are set.
- [ ] **git install**: push a scaffold (`bb plugin new demo`) to a repo, then
      `bb plugin install git:github.com/you/bb-plugin-demo@main`; re-install
      same spec refreshes; `bb plugin remove` deletes the managed clone.
- [ ] **npm install**: `npm pack` a scaffold, publish (or use a scoped test
      package), `bb plugin install npm:bb-plugin-demo@0.1.0`; confirm
      `--ignore-scripts` (no postinstall runs) and engines hard-fail on a
      too-new range (on a packaged/real-version server — dev servers report
      0.0.0 and skip the engines gate by design).
- [ ] **Author loop**: `bb plugin new demo` → edit server.ts → `bb plugin
      install ./bb-plugin-demo --yes` → edit → `bb plugin reload demo` →
      change visible. (Note: `bb plugin dev` watch mode is a known gap, below.)
- [ ] **Logs**: `bb plugin logs agent-enrichment -f` while running `bb docs`;
      lines appear within ~1s.
- [ ] **Schedules/services in list**: install slack-bot unconfigured →
      `bb plugin list` shows service state + `needs-configuration`; a plugin
      with a `*/1 * * * *` schedule shows next-run advancing each minute.
- [ ] **Reload under live service**: with slack-bot configured and connected,
      `bb plugin reload slack-bot` — no duplicate replies afterward (tested
      automatically; worth one real-world confirmation).
- [ ] **Plugin thread attribution**: after the Slack bot spawns a thread,
      `curl /api/v1/threads/<id>` shows `origin: "plugin"`,
      `originPluginId: "slack-bot"` (UI badge lands with the frontend phase).
- [ ] **Laptop-sleep schedule behavior**: with a 5-min schedule, sleep the
      machine >5 min, wake — the missed run fires on the next sweep tick.

## Known gaps / backlog (not bugs, decisions)

- `bb plugin dev` (watch + auto-reload) not built yet — design §6 lists it;
  manual `bb plugin reload` is the loop for now.
- Unknown-command proxy fails silently when the server is unreachable (e.g.
  no-network sandboxes) — consider a stderr hint "plugin lookup failed".
- Settings are only configurable while a plugin is running (schema exists
  after the factory runs).
- `bb plugin remove` keeps `plugin_kv` rows and `data.db` on purpose (data
  survives reinstall); secrets and settings are deleted.
- `sdk.on` realtime from plugin backends is wired but untested.

## Phase 2 — appended as slices land

(builders: add your slice's manual QA items here)

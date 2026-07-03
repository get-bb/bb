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

## Verified live in the browser (2026-07-02, autonomous dev-browser session)

All checks against the dev app with the linear + agent-enrichment +
small-ux-pack examples installed and a real Linear API key configured:

- [x] Homepage "Open Linear issues" section renders real synced issues.
- [x] Click "Start work" → thread spawned, titled from the issue, prompt
      carries identifier/state/description, agent starts (thr_wmzu6jbvs7).
- [x] "Issue" threadPanelTab appears ONLY on the issue-linked thread
      (sync visible() pattern) and renders issue details via plugin rpc.
      *(Historical: threadPanelTab was reworked into threadPanelAction on
      2026-07-03 — see the threadPanelAction section below.)*
- [x] Linear board nav panel at /plugins/linear/board (Todo column + card).
- [x] Settings → Plugins: both plugins with status pills; linear form with
      secret [set] field, team key, and the project picker; save works.
- [x] Thread actions "Summarize thread" + "Copy status" appear in the
      thread header immediately after installing small-ux-pack (live
      contributions refetch, no refresh).
- [x] /standup listed under a "Plugin commands" group in the command menu.
- [x] @TES mention shows a "Linear issues" group with the synced issue.
- [x] Full author loop: bb plugin new --app → install → bb plugin dev →
      edit app.tsx → homepage hot-swaps WITHOUT page reload (window marker
      survived the whole session) → injected throw → crash chip, siblings
      alive (Linear section + app chrome) → fix → save-to-heal recovery.
- [x] Fixed during the session: settings form hidden for
      needs-configuration plugins; settings save now auto-reloads a
      needs-configuration plugin; Tailscale/LAN origin 403s; node:fs
      scaffold leak crashing the browser bundle.

Observation for later polish: startWork into a repo-less default project
(e.g. Personal) gives the agent nothing to code against — consider a
project picker on the homepage card or an issue→project mapping setting.

## Verified live — GitHub hero authored from scratch on a packaged instance (2026-07-02)

A worker agent wrote `bb-plugin-github` end to end on a PACKAGED bb-app
(`:41100`, fresh data dir — not the dev server), the user iterated on it,
and a second agent migrated it to the stock-shadcn UI kit. Now checked in
as `examples/plugins/github`. What that flow proved:

- [x] **Packaged-app author loop**: `bb plugin new github --app` (scaffold
      with bundled `types/*.d.ts`) → edit → `bb plugin install .` → edit →
      reload, all against the packaged build — surfaced and then confirmed
      the fix for the toolchain packaging bug (esbuild/@tailwindcss/jiti now
      ship as bb-app deps; no symlink workaround).
- [x] **Install-time build + serving on a prod build**: path install built
      `dist/` itself; inventory shows `app.hasApp: true`, hash-busted
      `jsUrl`/`cssUrl`, `compatible: true`; the app loads the bundle and
      renders the panel.
- [x] **navPanel + headerContent + logos**: sidebar entry renders the
      plugin's `logo.svg` (dark variant shipped too), panel title bar shows
      logo + title with the plugin's `headerContent` on the right.
- [x] **rpc under real load**: 328 handler calls / 0 errors in
      `bb plugin list --json` after an evening of browsing issues/PRs.
- [x] **Realtime + background service**: `sync` service `running`; panel
      refreshes via `issues-updated`-style signals while browsing.
- [x] **CLI command registration**: `bb github` listed in contributions and
      `bb plugin list`.
- [x] **Settings (project picker)**: declared `extraRepos` (string) +
      `defaultProject` (project) render in Settings → Plugins and
      `bb plugin config github`.
- [x] **Stock-shadcn kit migration**: an agent moved the app to the new kit
      (Tabs/Select/DropdownMenu/Badge/Skeleton/Input/Textarea/toast) from
      the migration brief + authoring skill; typechecks against the bundled
      types standalone.
- [x] **Reinstall-from-files recovery**: after the instance db was lost,
      `bb plugin install <surviving dir>` restored the plugin with its
      `data.db` intact (kv/sqlite survive reinstall by design).

## Verified live — autonomous CLI pass on the dev instance (2026-07-02, post-removals HEAD)

Run against `scripts/bb-dev-app` on this branch (slash-command and
addContext removals included), with agent-enrichment + small-ux-pack +
slack-bot + scratch plugins:

- [x] Both hero examples install and run clean on post-removal HEAD.
- [x] Schedule actually FIRES: `*/1` cron ran on the minute (`last: ok`)
      and next-run advanced.
- [x] Plugin CLI return-shape validation: a wrong `run()` return prints
      `cli run() must return { exitCode: number, stdout?, stderr? }` and
      counts a handler error — clear contract error, plugin stays running.
- [x] Degraded → running recovery: a plugin marked
      `degraded (service ... did not stop)` returns to `running` on the
      next reload once the service respects the abort.
- [x] `bb plugin remove` removes the command + list entry immediately.
- [x] FINDING (fixed): the scaffold's commented service example slept
      through the abort signal (`await sleep(60_000)` in the loop), so any
      plugin copying it went `degraded (service did not stop)` on every
      reload. The scaffold now shows an abort-aware sleep.
- [x] Catalog correction: thread attribution rides `originPluginId` on the
      wire; the thread response has no `origin` field (`originKind` is the
      fork/side-chat relationship) — the Phase-1 item text predated the
      rename.

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
- [x] **Author loop**: `bb plugin new demo` → edit server.ts → `bb plugin
      install ./bb-plugin-demo --yes` → edit → `bb plugin reload demo` →
      change visible. (Verified 2026-07-02 via the github hero, authored
      from scratch on a packaged instance — see the section above.)
- [x] **Logs**: `bb plugin logs agent-enrichment -f` while running `bb docs`;
      lines appear within ~1s. (Verified 2026-07-02: load + invoke lines
      visible via `bb plugin logs <id> -n` immediately after the call.
      Note: a plugin only gets a log file once it first calls `bb.log`.)
- [x] **Schedules/services in list**: install slack-bot unconfigured →
      `bb plugin list` shows service state + `needs-configuration`; a plugin
      with a `*/1 * * * *` schedule shows next-run advancing each minute.
      (Verified 2026-07-02: slack-bot `needs-configuration` with the
      configure hint; scratch plugin's service `running`, schedule next-run
      advanced AND fired with `last: ok`.)
- [ ] **Reload under live service**: with slack-bot configured and connected,
      `bb plugin reload slack-bot` — no duplicate replies afterward (tested
      automatically; worth one real-world confirmation).
- [x] **Plugin thread attribution**: after a plugin spawns a thread,
      `curl /api/v1/threads/<id>` shows `originPluginId: "<id>"` (the
      response has no `origin` field — `originKind` is the fork/side-chat
      relationship). (Verified 2026-07-02 via a scratch plugin's
      `bb.sdk.threads.spawn` with `environment: { type: "project-default" }`.)
- [ ] **Laptop-sleep schedule behavior**: with a 5-min schedule, sleep the
      machine >5 min, wake — the missed run fires on the next sweep tick.

## Known gaps / backlog (not bugs, decisions)

- `bb plugin dev` (watch + auto-reload) landed in P3.4: it rebuilds the
  frontend bundle and reloads on change, and open pages pick up frontend
  changes live (no page refresh). See "### P3.4 live reload + bb plugin dev".
- Unknown-command proxy fails silently when the server is unreachable (e.g.
  no-network sandboxes) — consider a stderr hint "plugin lookup failed".
- Settings are only configurable while a plugin is running (schema exists
  after the factory runs).
- `bb plugin remove` keeps `plugin_kv` rows and `data.db` on purpose (data
  survives reinstall); secrets and settings are deleted.
- `sdk.on` realtime from plugin backends is wired but untested.
- (Phase 2) Native-tool provider matrix: codex and claude-code have manual
  e2e steps in P2.2/P2.6; pi and acp still need a live pass (plumbing is
  shared, risk is provider behavior).
- (Phase 2) Tool-set changes apply on the next session start by design; no
  hot-add of tools to a running provider session.
- (Phase 2) Plugin dependency resolution is plain Node resolution from the
  plugin directory — a stray `~/node_modules` can shadow it (bit us with a
  zod v3 there). The examples avoid it by being pnpm workspace members with
  their own `node_modules`; a loader-provided zod alias is possible
  follow-up.
- (The earlier "contributions refresh only on the ≤30s stale time" gap is
  fixed: the server now broadcasts `plugins-changed` and open pages refetch
  contributions live.)

## Phase 2 — appended as slices land

(builders: add your slice's manual QA items here)

### P2.1 Plugin skills tier

(bb.agents.addContext also shipped in this slice and was REMOVED 2026-07-02:
per-turn programmatic instruction injection was invisible-to-the-user prompt
text with a per-turn latency budget; plugin `skills/` directories cover
standing agent knowledge declaratively. Its checklist items are gone below.)

Prereq: `plugins` experiment on; dev server via `scripts/bb-dev-app` with
`eval "$(scripts/bb-dev-app env)"`.

- [ ] **Plugin skill reaches a thread**: `pnpm bb:dev plugin install
      ./examples/plugins/agent-enrichment`, then spawn a thread
      (`pnpm bb:dev thread spawn --project proj_personal --provider codex
      --permission-mode readonly --prompt "List your available skills; reply
      with their names only." --json`) — the reply includes
      `repo-conventions` (the plugin's `skills/` dir, auto-imported).
- [ ] **Precedence**: create `<dataDir>/skills/repo-conventions/SKILL.md`
      with the same name but a distinct description → the next spawned
      thread sees the data-dir copy (user skills override plugin skills).
      Delete it; the plugin copy returns. Plugin skills override builtins of
      the same name.
- [ ] **New skill after reload**: add another
      `examples/plugins/agent-enrichment/skills/<new-name>/SKILL.md`
      (frontmatter `name` must match the dir name), run `pnpm bb:dev plugin
      reload agent-enrichment` — the next thread turn lists the new skill.
      No server restart needed.
- [ ] **Experiment gate**: turn the `plugins` experiment off — the next turn
      has no plugin skills.

### P2.2 Native dynamic tools (bb.agents.registerTool)

Prereq: `plugins` experiment on; dev server via `scripts/bb-dev-app` with
`eval "$(scripts/bb-dev-app env)"`. Native tools ride the session's
dynamicTools, so tool-set changes apply on the NEXT thread/turn start (a
tool registered or reloaded mid-session is not hot-added).

- [ ] **Install a tool plugin**: `mkdir -p /tmp/bb-plugin-fruit`, write
      `package.json` with `{ "name": "bb-plugin-fruit", "version": "0.1.0",
      "bb": { "server": "./server.ts" } }` and `server.ts` with:
      `export default (bb: any) => { bb.agents.registerTool({ name:
      "fruit_lookup", description: "Look up today's featured fruit.",
      instructions: "When asked about the featured fruit, call fruit_lookup
      instead of guessing.", parameters: { type: "object", properties: {},
      additionalProperties: false }, execute: () => "papaya" }); };`
      then `pnpm bb:dev plugin install /tmp/bb-plugin-fruit` —
      `bb plugin list` shows `fruit` running.
- [x] **codex e2e**: `pnpm bb:dev thread spawn --project proj_personal
      --provider codex --permission-mode workspace-write --prompt "Use the
      fruit_lookup tool and reply only with its result." --json` — the reply
      is `papaya` and the thread transcript shows a `fruit_lookup` tool call
      (not a bash workaround). (Verified 2026-07-02: reply was exactly
      `papaya`; the tool has no CLI/bash path so it had to be the native
      call — and it dispatched the FIRST registrant's tool while a clashing
      plugin was installed.)
- [ ] **claude-code e2e**: same spawn with `--provider claude-code` — the
      tool call goes through the bb-bridge MCP proxy; reply is `papaya`.
      (pi and acp are the remaining provider matrix, same steps.)
- [ ] **update_environment_directory still works**: in any running thread,
      ask "move this thread to <some existing worktree dir>" — the built-in
      tool still switches the environment (plugin registry must not shadow
      it).
- [ ] **Zod validation surfaces as tool error (optional spot check)**:
      swap `parameters` for a zod schema with a required field (the plugin
      dir needs its own zod 4: `cd /tmp/bb-plugin-fruit && npm i zod`),
      reload, then prompt the model to call the tool "with an empty
      arguments object" — the transcript shows an `Invalid arguments for
      tool "fruit_lookup": …` tool result and the model recovers; the
      plugin's handler error count in `bb plugin list --json` stays 0 (bad
      input is not a plugin error). Automated coverage:
      `plugin-agent-tools.test.ts`.
- [x] **Cross-plugin collision**: install a second plugin registering the
      same `fruit_lookup` name — `bb plugin list` shows the second plugin
      `running` with status detail `tool "fruit_lookup" is already
      registered by plugin "fruit" — not registered`; the first plugin's
      tool keeps working. (Verified 2026-07-02 verbatim, including the
      first plugin's tool answering the codex call.)
- [ ] **Next-session semantics**: while a thread is mid-turn, `pnpm bb:dev
      plugin reload fruit` — the running session keeps its old tool set;
      the next spawned thread (or next turn's session start) picks up
      changes.
- [ ] **Experiment gate**: turn `plugins` off — newly started sessions carry
      only `update_environment_directory`, and an in-flight call to a plugin
      tool returns `Unsupported tool`.

### P2.3 Thread actions (bb.ui.registerThreadAction)

Prereq: `plugins` experiment on; dev server via `scripts/bb-dev-app` with
`eval "$(scripts/bb-dev-app env)"`. Once P2.6 lands, install the
small-ux-pack example instead of the scratch plugin below.

- [ ] **Install an actions plugin**: `mkdir -p /tmp/bb-plugin-acts`, write
      `package.json` with `{ "name": "bb-plugin-acts", "version": "0.1.0",
      "bb": { "server": "./server.ts" } }` and `server.ts` with:
      `export default (bb: any) => {
        bb.ui.registerThreadAction({ id: "ping", title: "Ping",
          icon: "Zap",
          run: async () => ({ toast: { kind: "success", message: "pong" } }) });
        bb.ui.registerThreadAction({ id: "risky", title: "Risky",
          confirm: "Really run the risky action?",
          run: async () => { throw new Error("kaboom"); } });
        bb.ui.registerThreadAction({ id: "slow", title: "Slow",
          run: () => new Promise((r) => setTimeout(r, 3000)) });
      };`
      then `pnpm bb:dev plugin install /tmp/bb-plugin-acts --yes`.
- [ ] **Buttons render**: open any thread in the browser (dev URL from
      `scripts/bb-dev-app status`) — "Ping", "Risky", and "Slow" outline
      buttons appear in the thread header, left of the workspace/git
      actions. (Contributions come from
      `GET /api/v1/plugins/contributions` → `threadActions`.)
- [ ] **Success toast**: click "Ping" — a success toast "pong" appears.
- [ ] **Pending state**: click "Slow" — the button shows a spinner and all
      plugin action buttons disable for ~3s; no toast after (void result).
- [ ] **Confirm dialog + error toast**: click "Risky" — a dialog shows
      "Really run the risky action?"; Cancel runs nothing; confirming runs
      it and an error toast "Risky failed — kaboom" appears (handler threw).
      `bb plugin list` shows the failure in the plugin's handler stats.
- [ ] **Disappear on disable**: `pnpm bb:dev plugin disable acts` — after
      the contributions query refreshes (≤30s stale time; switch tabs or
      reload the page to force it), the buttons are gone. Re-enable brings
      them back.
- [ ] **API surface** (curl, optional): `curl -X POST -H 'content-type:
      application/json' -d '{"threadId":"thr_..."}'
      http://<server>/api/v1/plugins/acts/actions/ping` → `{ ok: true,
      toast: ... }`; unknown action/plugin → 404; disabled plugin → 503; a
      foreign Origin header → 403 (executes plugin code, local-auth
      guarded).

### P2.4 Slash commands — REMOVED (2026-07-02)

The plugin slash-command surface (`bb.ui.registerSlashCommand`, the
composer "Plugin commands" section, and POST /plugins/:id/slash/:name) was
removed deliberately: skills already ride the composer's `/` menu (plugin
`skills/` dirs auto-import), which covers the "type / and pick a plugin
capability" flow with the agent in the loop. The niche that surface held
(agent-free composer macros: computed insertText drafts, deterministic
sends) did not justify a parallel command path. Plugins that want a
`/`-menu entry ship a skill; plugins that need code execution keep thread
actions, CLI commands, rpc, and mention providers.

### P2.5 Mention providers (bb.ui.registerMentionProvider)

Prereq: `plugins` experiment on; dev server via `scripts/bb-dev-app` with
`eval "$(scripts/bb-dev-app env)"`.

- [ ] **Install a mention plugin**: `mkdir -p /tmp/bb-plugin-mentions`, write
      `package.json` with `{ "name": "bb-plugin-mentions", "version":
      "0.1.0", "bb": { "server": "./server.ts" } }` and `server.ts` with:
      `export default (bb: any) => {
        bb.ui.registerMentionProvider({ id: "issues",
          label: "Acme issues",
          search: async ({ query }) => [
            { id: "ISS-42", title: "Fix login bug", subtitle: "In progress" },
            { id: "ISS-51", title: "Ship mentions", subtitle: "Todo" },
          ].filter((i) => i.title.toLowerCase().includes(query.toLowerCase())),
          resolve: async (id) => ({ context:
            "Issue " + id + ": full description, acceptance criteria, links." }) });
        bb.ui.registerMentionProvider({ id: "boom",
          label: "Boom",
          search: async () => [{ id: "x", title: "Always fails to resolve" }],
          resolve: async () => { throw new Error("resolve kaboom"); } });
      };`
      then `pnpm bb:dev plugin install /tmp/bb-plugin-mentions --yes`.
- [ ] **Plugin group in the popover**: in any composer (thread follow-up or
      homepage), type `@fix` — the mention menu shows an **Acme issues**
      section after Threads/Projects/Workspace with "Fix login bug · In
      progress". Typing `@ship` narrows to "Ship mentions". (Search results
      may lag one keystroke — they're debounced like file suggestions.)
- [ ] **Pill insertion**: pick "Fix login bug" — a pill labeled
      `Plugin: Fix login bug` (zap icon) replaces the `@fix` token; the
      message text serializes as `@Fix login bug`.
- [ ] **Resolve-at-send reaches the agent**: send the message. The visible
      user message in the timeline shows only your text + the pill (no
      context blob). Verify the agent got the context:
      `sqlite3 <dataDir>/bb.db "SELECT payload FROM host_rpcs ORDER BY
      created_at DESC LIMIT 1;"` (or ask the agent "what context were you
      given?") — the thread.start/turn.submit input contains a trailing
      text part with `visibility: "agent-only"` reading `Context for @Fix
      login bug (resolved by plugin "mentions"): Issue ISS-42: …`.
- [ ] **Duplicate mentions resolve once**: mention the same item twice in
      one message — the daemon-bound input carries exactly one context part
      for it.
- [ ] **Resolve failure blocks the send**: type `@always` and pick "Always
      fails to resolve", then send — the composer surfaces `Could not
      resolve @Always fails to resolve (plugin "mentions"): resolve
      kaboom`; no message is added to the thread and the draft stays in the
      composer.
- [ ] **Disabled plugin blocks stale pills**: insert a pill, `pnpm bb:dev
      plugin disable mentions`, then send — the send is blocked with a
      "not running" resolve error (a stale pill can't silently drop its
      context).
- [ ] **Slow search degrades quietly**: a provider whose `search` sleeps >2s
      simply contributes nothing (built-in thread/project/file suggestions
      still render; `bb plugin logs mentions` shows the timeout).
- [ ] **API surface** (curl, optional):
      `curl "http://<server>/api/v1/plugins/mentions/search?q=fix&projectId=proj_x&threadId=thr_x"`
      → `{ ok: true, groups: [{ pluginId, providerId, label, items:
      [{ itemId: "issues:ISS-42", title, subtitle, icon }] }] }`; empty `q`
      → `{ ok: true, groups: [] }`; foreign Origin → 403; experiment off →
      422. `GET /api/v1/plugins/contributions` lists `mentionProviders`.

### P2.6 Phase-2 hero examples (small-ux-pack + agent-enrichment)

Prereq: `plugins` experiment on; dev server via `scripts/bb-dev-app` with
`eval "$(scripts/bb-dev-app env)"`. Automated coverage:
`apps/server/test/services/plugins/heroes-phase2.test.ts` installs both
examples from `examples/plugins/` and exercises every surface below except
the live provider runs.

- [ ] **Install the Small UX pack**: `pnpm bb:dev plugin install
      ./examples/plugins/small-ux-pack --yes` — `bb plugin list` shows
      `small-ux-pack` running.
- [ ] **Summarize thread**: open a thread that has run at least once —
      "Summarize thread" and "Copy status" buttons appear in the thread
      header. Click "Summarize thread" → confirm dialog ("Ask this thread's
      agent for a three-bullet summary?") → success toast "Summary
      requested…" → the thread starts a turn and the agent replies with a
      three-bullet summary.
- [ ] **Copy status error toast**: click "Copy status" — an error toast
      appears carrying the thread's live status (e.g. `thread status is
      "idle"`); `bb plugin list` counts the handler error (deliberate — the
      action demonstrates the error path).
- [ ] **Re-install agent-enrichment** (extended in P2.6 with the native
      tool and a docs mention provider): `pnpm bb:dev plugin
      install ./examples/plugins/agent-enrichment --yes`, then reload if it
      was already installed. Note: the example now depends on zod; inside
      this repo it is installed by `pnpm install` (the example is a
      workspace package). If you copy the plugin elsewhere, `npm install`
      in the plugin dir first.
- [ ] **@mention a doc**: type `@testing` in any composer — a **Plugin
      docs** group shows "Testing · testing.md". Pick it and send; ask the
      agent "what context were you given?" — it saw the full body of
      `docs/testing.md` (attached agent-only, resolved at send).
- [ ] **docs_search native tool**: spawn a codex thread
      (`--permission-mode workspace-write`) with prompt "Call the
      docs_search tool with query 'conventional commits' and reply only
      with its output." — the transcript shows a `docs_search` tool call
      (not bash) returning `conventions.md:` lines.
- [ ] **Shared cache**: after the tool call, `pnpm bb:dev docs last` prints
      the tool's query — the CLI command and the native tool share one
      search helper and kv cache.

### Phase 2 end-to-end (the full manual pass)

One sitting, fresh dev server (`scripts/bb-dev-app current`,
`eval "$(scripts/bb-dev-app env)"`, Plugins experiment on):

1. `pnpm bb:dev plugin install ./examples/plugins/agent-enrichment --yes`
   and `pnpm bb:dev plugin install ./examples/plugins/small-ux-pack --yes`;
   `bb plugin list` shows both `running`.
2. In the browser, open a thread that has run once: click **Summarize
   thread** (confirm → success toast → agent summary turn), then **Copy
   status** (error toast with the thread's status).
3. Type **@testing** → pick the Plugin docs item → send → agent received
   the doc body as agent-only context (ask it, or check the daemon-bound
   input for the `Context for @Testing…` part).
4. `pnpm bb:dev thread spawn --project proj_personal --provider codex
   --permission-mode workspace-write --prompt "First call the docs_search
   tool with query 'conventional commits', then run 'bb docs last' in bash.
   Reply with both outputs." --json` — the transcript shows a native
   `docs_search` tool call AND a bash `bb docs last` whose output matches
   the tool's query (shared kv cache). Repeat with `--provider claude-code`
   for the MCP-proxy path.
5. Ask any fresh thread to list its skills → `repo-conventions` and
   `plugin-commands` are present.
6. Turn the Plugins experiment off → header buttons and the
   mention group disappear after the contributions query refreshes; new
   turns carry no plugin skills/tools.

## Phase 3

### P3.1 bb plugin build

No server required for any of these (`bb plugin new` / `bb plugin build` are
local commands).

- [x] **Scaffold with a frontend entry**: `pnpm bb:dev plugin new hello --app`
      → `bb-plugin-hello/` contains `app.tsx`, and its `package.json` has
      `"bb": { "server": "./server.ts", "app": "./app.tsx" }`. Without
      `--app`, no `app.tsx` and no `bb.app` field (headless scaffold
      unchanged). (Verified 2026-07-02: github hero scaffolded with --app on
      a packaged instance, incl. the new bundled `types/` dir.)
- [ ] **Build**: `pnpm bb:dev plugin build bb-plugin-hello` prints the three
      output paths. Check the outputs:
      - `dist/app.js` is a single ESM file with
        `globalThis.__bbPluginRuntime` slot lookups and **no bundled React**
        (grep: no `react.development`, no `__SECRET_INTERNALS`, no
        `from "react"` imports remain).
      - `dist/app.css` contains the scaffold's utility classes (e.g.
        `.rounded-md`) — theme + utilities layers only, no preflight.
      - `dist/app.meta.json` is `{ "sdkMajor": …, "sdkVersion": … }` matching
        `PLUGIN_SDK_VERSION` in `@bb/domain` (no timestamps — rebuilds of
        identical sources are byte-identical).
- [ ] **Import guard**: `node -e "import('./bb-plugin-hello/dist/app.js')"`
      fails with "must be loaded by the BB app" — the shims refuse to run
      outside the host runtime.
- [ ] **No app entry**: `pnpm bb:dev plugin build` in a headless plugin dir
      errors with `no frontend entry: … no "bb": { "app": … }` and exit 1.
- [ ] **Bad path**: `bb.app` pointing at a missing file errors with
      "points at a missing file".

### P3.2 bundle serving + loading

Needs a running dev server with the Plugins experiment on, and a plugin
scaffolded with `bb plugin new hello --app`.

- [x] **Install-time build (path)**: `pnpm bb:dev plugin install ./bb-plugin-hello`
      → install succeeds and `bb-plugin-hello/dist/` now exists (app.js,
      app.css, app.meta.json) even though you never ran `bb plugin build`.
      Break `app.tsx` (syntax error) and re-install → the install itself
      fails with the esbuild error; fix it and re-install. (Verified
      2026-07-02 via the github hero on a packaged instance — including the
      failure path, which surfaced the toolchain packaging bug as real
      install errors before the fix.)
- [x] **Inventory**: `curl <server>/api/v1/plugins | jq '.plugins[] | {id, app}'`
      → the hello plugin has `app.hasApp: true` and a `bundle` object with
      `jsUrl`/`cssUrl` (both carrying `?h=<hash>`), `hash`, `sdkMajor`,
      `sdkVersion`, `compatible: true`. A headless plugin shows
      `{ hasApp: false, bundle: null }`. (Verified 2026-07-02 for the
      app-plugin half via the github hero's `bb plugin list --json`;
      headless-plugin shape still covered by automation only.)
- [ ] **Asset routes**: `curl -i "<server><jsUrl>"` → 200,
      `content-type: text/javascript`, `cache-control: public, max-age=31536000,
      immutable`; drop or change the `?h=` value → same body but
      `cache-control: no-store`. `app.css` serves as `text/css`. Unknown
      plugin id or a file other than app.js/app.css → 404.
- [x] **Host loading**: open the app with the experiment on → the browser
      network tab shows one `app.js?h=…` import and an `app.css` stylesheet
      link per running app-plugin; `document.head` contains
      `link[data-bb-plugin-css="hello"]`; console:
      `globalThis.__bbPluginRuntime` has react / reactDom / reactDomClient /
      jsxRuntime / jsxDevRuntime / pluginSdkApp slots. No UI renders yet —
      slots are P3.3. (Verified 2026-07-02: the github hero's bundle+CSS
      load and render on a packaged instance.)
- [ ] **Containment**: hand-edit `bb-plugin-hello/dist/app.js` to
      `throw new Error("boom")` at the top, reload the page → a single
      console warning `[plugin:hello] frontend bundle failed to load: …`,
      the rest of the app is untouched. (Re-run `bb plugin build` or
      reinstall to restore.)
- [ ] **Stale-SDK rebuild**: edit `dist/app.meta.json` to
      `"sdkVersion": "0.0.0"` and run `pnpm bb:dev plugin reload hello` →
      server log shows "rebuilding frontend bundle", the meta file is
      restored to the current SDK version, and the inventory hash changes if
      the sources changed.
- [ ] **npm prebuilt rule**: `bb plugin install npm:<pkg>@<version>` for a
      package that declares `bb.app` but publishes no `dist/` fails with
      "npm plugins with a frontend (bb.app) must publish a prebuilt bundle".
      An npm package whose `dist/app.meta.json` has a different `sdkMajor`
      still installs and its backend runs, but the inventory shows
      `compatible: false` and the frontend logs a "skipping until the plugin
      is updated" warning instead of importing it.

### P3.3 slots + plugin-sdk/app

Needs a running dev server with the Plugins experiment on and a plugin
scaffolded with `bb plugin new hello --app` (the scaffold now default-exports
`definePluginApp` with a homepage section) installed via
`pnpm bb:dev plugin install ./bb-plugin-hello`.

- [ ] **Scaffold homepage section**: open the app root → below the compose
      area a "bb-plugin-hello" section renders the hello card; it shows
      "No project selected." at `/` and "Project: proj_…" when you open a
      project's compose view (`/projects/<id>`). Tailwind classes from the
      plugin's own `dist/app.css` apply, and theme tokens follow the active
      palette (switch themes → the card recolors).
- [ ] **All four slots**: edit `app.tsx` to also register
      `navPanel({ id, title, icon: "Columns", path: "board", component })`,
      `threadPanelAction({ id, title, component, run? })`, and
      `composerAccessory({ id, component })`, rebuild + reload the plugin,
      then reload the page:
      the sidebar shows the nav entry above the project list (active state
      when on the route) → clicking it lands on `/plugins/hello/board`
      rendering the panel component; a thread's right panel "+" new-tab
      page lists the action under Actions (plugin logo icon) and selecting
      it opens a closable tab (plugin logo + title) rendering the component
      with `{ threadId, params }` — the tab persists per thread across
      reloads (params round-trip), re-selecting with identical params
      focuses the existing tab, and `run` errors only log a warning;
      the composer footer shows the accessory on both the homepage
      (`projectId`/`threadId` null) and a thread view.
- [ ] **visible() predicate**: make `visible: ({ threadId }) => false` →
      the thread panel tab button disappears; a throwing predicate hides the
      tab and logs one warning instead of crashing the panel.
- [ ] **Junk default export**: change `app.tsx` to `export default 42`,
      rebuild, reload the page → console shows
      `[plugin:hello] frontend registration failed: …definePluginApp…`, no
      hello UI renders anywhere, other plugins and the backend (settings,
      thread events) still work.
- [ ] **ErrorBoundary chip**: make the homepage section component `throw` →
      only that section collapses to a "plugin hello crashed" chip (outline
      pill, theme colors); the rest of the homepage, other slots, and other
      plugins render normally; navigating away and back keeps the chip
      (disabled for the session) until a reload of the page.
- [ ] **Hooks**: in the panel component call `useRpc().call("<method>")`
      against a `bb.rpc` method → result resolves; a method that throws
      surfaces the server's error message. `useRealtime("chan", cb)` fires
      when the backend runs `bb.realtime.publish("chan", {...})` (check via
      a scheduled publish or thread action). `useSettings()` returns
      non-secret values only (a secret key is absent) and refreshes after
      `bb plugin config hello set … && bb plugin reload hello`.
      `useBbNavigate().toThread(id)` opens the thread with its proper
      project path; `toPluginPanel("board")` routes to the nav panel.
- [ ] **Settings surface**: Settings → a "Plugins" section lists installed
      plugins with version + status pills; the hello plugin (running) shows
      its declared settings as a form — string input, boolean switch, select
      picker, project picker (lists your projects), secret shown as a
      password input with "[set]"/"[not set]" placeholder and never a value.
      Change a value → Save → success toast; `bb plugin config hello` shows
      the new value. A bad select value via curl PUT returns the validation
      error as an error toast. Section absent while the experiment is off.
- [ ] **Deep link before load**: open `/plugins/hello/board` in a fresh tab
      → a quiet "not available" placeholder may flash, then the panel
      renders once bundles load; the same placeholder persists for a removed
      plugin's URL.

### P3.4 live reload + bb plugin dev

Needs a running dev server with the Plugins experiment on and a plugin
scaffolded with `bb plugin new hello --app`, installed via
`pnpm bb:dev plugin install ./bb-plugin-hello`. Run
`eval "$(scripts/bb-dev-app env)"` first so `pnpm bb:dev` targets the dev
server.

- [ ] **Dev loop, frontend edit — no page refresh**: with the app open at
      the homepage, run `pnpm bb:dev plugin dev ./bb-plugin-hello` (prints
      "Watching … — Ctrl+C to stop"), then edit `app.tsx` (change the
      section's visible text) and save → the CLI prints one cycle line
      (`1 file changed · rebuilt app in Nms · reloaded hello`) and the
      homepage section updates in place WITHOUT a page refresh (the slot
      remounts; watch the text change).
- [ ] **No duplicates on repeat**: save `app.tsx` two more times → still
      exactly one "hello" homepage section (registrations replace wholesale,
      never append).
- [ ] **Backend edit**: edit `server.ts` (e.g. change an rpc/thread-action
      response) and save → cycle line prints, backend behavior changes on
      the next call; the frontend does NOT remount (bundle hash unchanged —
      backend-only reload leaves mounted slots alone).
- [ ] **Build failure recovers**: break `app.tsx` with a syntax error →
      cycle prints `build failed: …` and the watcher stays alive (no reload
      that cycle; the app keeps the last working UI). Fix the file → next
      save rebuilds and reloads cleanly.
- [ ] **Reload failure keeps watching**: stop the dev server mid-loop, save
      a file → `reload failed: …` prints and the loop survives; restart the
      server, save again → clean cycle.
- [ ] **Disable removes UI live**: with the page open, `pnpm bb:dev plugin
      disable hello` → the homepage section AND its CSS link
      (`link[data-bb-plugin-css="hello"]` in devtools) disappear without a
      refresh; `enable` brings them back.
- [ ] **Crashed slot heals on reload**: make the section component throw →
      "plugin hello crashed" chip; fix the component and save (dev loop
      reloads) → the section renders again without a page refresh (crash
      latch cleared + remount).
- [ ] **Not-installed guidance**: `pnpm bb:dev plugin dev` in a plugin
      directory that is not installed exits with "run \`bb plugin install
      .\` first"; a directory without a `bb.server` package.json field is
      rejected as not a plugin.
- [ ] **dist/ never loops**: while `bb plugin dev` runs, confirm a cycle's
      own `dist/` writes do not trigger another cycle (one line per save,
      not an infinite rebuild loop).

### P3.5 Linear hero — REMOVED (2026-07-02)

The Linear hero example (`examples/plugins/linear`) and its dedicated tests
(heroes-linear.test.ts, linear-example-bundle.test.ts) were deleted: the
github hero — authored from scratch on a packaged instance and checked in
as `examples/plugins/github` — took over the full-stack showcase role
without needing a third-party API key to exercise. Surfaces the linear
example uniquely demonstrated live (mention provider + composer-menu logos,
homepageSection, threadPanelTab with the sync visible() pattern, schedule →
cache → realtime) remain covered by agent-enrichment (mention provider),
small-ux-pack (thread actions), github (navPanel/rpc/realtime/service/CLI),
and the automated suites; the sync visible() pattern stays documented in
the bb-plugin-authoring skill.

### Phase 3 end-to-end (the full manual pass)

One sitting, fresh dev server (`scripts/bb-dev-app current`,
`eval "$(scripts/bb-dev-app env)"`, Plugins experiment on). Design §9
Phase-3 exit criteria are covered by automation —
kill-switch: `apps/app/src/components/plugin/PluginSlotMount.test.tsx`
("collapses a throwing slot to a crash chip and keeps siblings alive");
reload-twice-one-section: `apps/app/src/lib/plugin-frontend-reload.test.ts`
("reloading twice leaves exactly one homepage section registered");
stale bundle: `apps/app/src/lib/plugin-frontend.test.ts` ("skips
incompatible bundles with a needs-update record") plus the server side in
`apps/server/test/services/plugins/plugin-app-bundle.test.ts` — this pass
confirms them with eyes on a real browser:

1. `pnpm bb:dev plugin new hello --app` + install; run the P3.3 slot checks
   (homepage card, all four slots, ErrorBoundary chip) and the P3.4 dev
   loop (edit → in-place update, no duplicates, disable removes UI live).
2. Install the github hero (`examples/plugins/github`; needs an authed
   `gh` CLI) and click through its panel: issues/PRs tabs, detail view,
   Send agent.
3. Kill-switch with eyes: make hello's section component throw → chip only,
   the github panel and the rest of the app stay alive.
4. Stale bundle with eyes: path installs rebuild themselves on a version
   mismatch, so follow P3.2's npm prebuilt rule — install an npm-packed
   plugin whose `dist/app.meta.json` carries a different `sdkMajor`;
   confirm the backend stays `running`, the inventory shows
   `compatible: false`, and the frontend logs the "skipping until the
   plugin is updated" warning without crashing.
5. Reload the github plugin twice (`bb plugin reload github` ×2) with its
   panel open → still exactly one GitHub sidebar entry/panel registration.
6. Turn the Plugins experiment off → every plugin surface (sections,
   panels, tabs, mentions, slash commands) disappears live; back on →
   returns without a restart.

### P3.6 authoring docs (bb-plugin-authoring skill + guide chapter)

Automated coverage: the skill is pinned to the API by
`apps/server/test/services/plugins/plugin-authoring-docs.test.ts` (every
`BbPluginApi` key and every `PLUGIN_SDK_APP_EXPORT_NAMES` entry must appear
in the SKILL.md) and the guide chapter by
`apps/cli/src/__tests__/plugin-guide-docs.test.ts` (every `bb plugin`
subcommand must appear in `bb guide plugins`).

THE acceptance test — a bb agent writes a plugin for bb unassisted, using
only the skill. Fresh dev server with the Plugins experiment on, then:

```bash
eval "$(scripts/bb-dev-app env)"
pnpm bb:dev thread spawn --project proj_personal --provider codex \
  --permission-mode workspace-write \
  --title "P3.6: bb weather plugin via bb-plugin-authoring" \
  --prompt 'Create and install a bb plugin that adds a `bb weather <city>` CLI command returning a canned string, using the bb-plugin-authoring skill.' \
  --json
```

- [x] The agent completes the whole loop unassisted: scaffolds with
      `bb plugin new weather` (or equivalent), writes a `bb.cli.register`
      handler returning the canned string, installs with
      `bb plugin install . --yes`, and verifies by running
      `bb weather <city>` itself (workspace-write is required — a readonly
      sandbox blocks the bb CLI's loopback network). (Exceeded 2026-07-02:
      a worker agent authored the entire github hero — navPanel app, rpc,
      sync service, settings, logos, AND a `bb github` CLI command — from
      scratch on a packaged instance; a second agent later migrated it to
      the shadcn kit from a brief.)
- [x] `bb plugin list` afterwards shows the plugin `running` with its
      `bb weather` command; `bb weather tokyo` prints the canned string
      from any thread. (github equivalent: `running` with `bb github`.)
- [ ] The thread transcript shows the bb-plugin-authoring skill being
      used (not trial-and-error against the API). (Unverifiable for the
      github hero — the authoring thread's transcript was lost with the
      instance db; re-confirm on the next agent-authored plugin.)

### Phase 3 review fixes (tester-visible changes)

Behavior changes from the phase-3 review pass; each has automated
regression coverage, listed here because a manual tester would notice:

- [ ] **Failed frontend rebuild degrades, not lies**: make a path plugin's
      `app.tsx` unbuildable and force a rebuild (stale `dist/app.meta.json`
      sdkVersion) → after reload the backend stays `running`, `bb plugin
      list` shows a `frontend bundle rebuild failed: …` status detail, the
      UI shows no plugin frontend, and `/plugins/<id>/assets/app.js` 404s
      (previously the stale bundle kept being served).
- [ ] **Disabled plugins stop serving assets**: `bb plugin disable <id>` →
      its `assets/app.js` URL 404s immediately; enable → 200 again.
- [ ] **Failed reinstall keeps the old install**: break a git plugin's
      tip (bad package.json or failing app build) and re-run `bb plugin
      install git:…@ref` → install fails, but the previously installed
      version still runs and survives `bb plugin reload` (previously the
      old files were deleted before the new clone was validated).
- [ ] **Settings saves refresh open pages**: with a plugin page open in two
      windows, save a setting in one → the other's `useSettings()` view
      updates within a second (plugins-changed broadcast on effective
      change; a save of identical values does not broadcast).
- [ ] **Meta-only bundle changes re-key**: an npm plugin whose
      `dist/app.meta.json` changes (same js/css) now gets a fresh bundle
      hash, so the frontend re-evaluates compatibility instead of keeping
      a stale needs-update record.
- [ ] **CSS reload has no unstyled flash**: during `bb plugin reload` of a
      plugin with CSS, the old stylesheet stays until the new one loads.
- [ ] `bb plugin token --rotate` is documented in `bb guide plugins` and
      the authoring skill.

### Panel chrome + plugin logos

navPanel chrome control, panel title-bar `headerContent`, plugin logos on
every contribution surface, and the plugin-CSS containment fix. Automated
coverage: `apps/server/test/services/plugins/plugin-logo.test.ts`,
`plugin-app-bundle.test.ts` (@scope regression), and the app's
`plugin-slot-mounts` / `PluginThreadActions` / `MentionMenu` /
`PluginsSettingsSection` tests.

- [x] **Page chrome (default)**: a navPanel shows a host title bar —
      plugin logo + title left, the plugin's `headerContent` right — above
      a FULL-WIDTH body (no prose max-width cap). (Verified 2026-07-02 via
      the github hero: logo + "GitHub" title bar, live headerContent,
      full-width issues/PRs table, in daily use on the packaged instance.)
- [ ] **headerContent containment**: a throwing `headerContent` disappears
      (console warning only); the title bar and panel body keep rendering,
      no "plugin crashed" chip for the accessory.
- [ ] **`chrome: "none"`**: a panel registered with `chrome: "none"` gets
      the entire panel area (no host padding, no title bar, headerContent
      ignored) and a crash inside it still collapses to the "plugin <id>
      crashed" chip.
- [ ] **Logos everywhere**: with a logo-shipping plugin installed, its logo
      replaces the bolt/named icon on: the sidebar row, the panel title
      bar, the `@`-mention menu's provider rows (agent-enrichment's docs
      provider after adding a logo, since linear was removed),
      thread-header action buttons (small-ux-pack + logo), and Settings →
      Plugins next to the plugin id. A logo-less plugin falls back to its
      named `icon` / the generic bolt on every surface. (Sidebar row +
      panel title bar verified live 2026-07-02 via the github hero's
      logo.)
- [ ] **Logo plumbing**: `GET /api/v1/plugins` entries carry
      `logoUrl` (hash-busted, null when no logo or plugin not running);
      `GET /api/v1/plugins/<id>/assets/logo?h=…` serves the file with the
      right image content-type, immutable when the hash matches, `no-store`
      otherwise, 404 when absent or the plugin is disabled. `logo.svg`
      beats `logo.png` beats `logo.webp`; manifest `bb.logo` relocates it
      (svg/png/webp only — anything else fails install/load with a clear
      error); `bb plugin reload` picks up a changed logo (new hash).
- [ ] **Plugin CSS can no longer break host layout** (regression fix): with
      the linear plugin loaded, a host `flex-col sm:flex-row` element (e.g.
      the Settings rows for Theme / Markdown formatting) still computes
      `flex-direction: row` at ≥640px. `dist/app.css` now wraps all
      utilities in `@scope ([data-bb-plugin-root])` (every slot mount and
      the headerContent wrapper carry that attribute), so plugin utilities
      apply only inside plugin subtrees — previously the plugin's plain
      `.flex-col` overrode host responsive utilities page-wide.

### Theme-aware logos + PageBody

Dark-logo variant + the PageBody UI-kit export. Automated coverage:
`plugin-logo.test.ts` (logo-dark detection/override/escape/inventory/
reload), the app's `PluginIcon.test.tsx` (theme picks the variant) and
`plugin-sdk-app-impl.test.tsx` (PageBody render + export sync).

- [ ] **Dark logo variant**: `logo-dark.(svg|png|webp)` at the plugin root
      (or manifest `bb.logoDark`, same svg>png>webp precedence and rules)
      is served at `GET /plugins/<id>/assets/logo-dark` and rides the
      inventory as `logoDarkUrl`. With the app in dark mode every logo
      surface (sidebar, panel title bar, composer menus, thread actions,
      Settings → Plugins) shows the dark variant; light mode shows
      `logo.svg`; a plugin with only a light logo keeps it in both modes.
      The github example ships both (dark mark for light theme, white mark
      for dark theme) — flip the theme in Settings and watch the mark swap
      live, no reload.
- [x] ~~**PageBody**~~ REMOVED 2026-07-03 with the host-provided UI kit
      (design §5.5): `@bb/plugin-sdk/app` is hooks-only; plugins write their
      own `mx-auto w-full max-w-3xl` wrapper (github example has one).
      (Note: PLUGIN_SDK_VERSION was reverted 0.2.0 → 0.1.0 pre-release;
      existing dev installs stamped 0.2.0 simply rebuild on next load.)


## Phase 4 — component registry + prebuilt distribution (built 2026-07-03)

The host-provided UI kit is REMOVED (design §5.5): `@bb/plugin-sdk/app` is
hooks-only (`definePluginApp` + useRpc/useRealtime/useSettings/useBbContext/
useBbNavigate). Components are vendored shadcn source from the in-repo
registry (`packages/plugin-registry`, served raw from GitHub at
`desktop-v<version>` tags); react + the ten portaling radix families +
sonner + vaul are runtime-shimmed; everything else bundles per plugin.
Automated coverage: `plugin-build.test.ts` (token bridge, tw-animate,
singleton shims, scaffold build), `portal-scope.test.tsx`,
`plugin-frontend.test.ts` (18-slot runtime), `vendor-all-items.test.ts`
(every registry item compiles through the real build), registry/theme/
templates `--check` drift gates, `plugin-sdk-app-impl.test.tsx` (hooks-only
export sync).

- [ ] **Vendored styling live**: install the github example; its vendored
      Tabs/Select/DropdownMenu render themed (tokens follow palette flips),
      dropdown/select popovers are styled (portal scope stamp), and
      open/close animates (tw-animate in the plugin CSS pass).
- [ ] **Cross-copy overlay stacking**: with a vendored plugin dialog open,
      open a host overlay above it — Escape/outside-click dismiss the right
      layer only (shared radix via shims).
- [ ] **toast → host toaster**: `import { toast } from "sonner"` in plugin
      code raises the host's toaster (github example uses it).
- [ ] **Scaffold out of the box**: `bb plugin new hello --app` → npm install
      runs (or prints the manual step) → `bb plugin build` succeeds →
      installed plugin renders the Card/Button homepage section.
- [ ] **shadcn add against the registry**: in a scaffold,
      `npx shadcn add @bb/select` (components.json pinned ref; use a branch
      ref pre-release) vendors select + its closure; build + render works.
- [ ] **components.json ref pinning**: scaffold from a real-version BB pins
      `desktop-v<version>`; dev build (0.0.0) pins `main`.
- [ ] **Prebuilt consumer install**: a git-kind install with committed
      dist/ (server.js + app.js) loads with NO node_modules and no npm on
      the machine; path installs still load from source (edit + reload
      shows the change without rebuilding dist).
- [ ] **Headless build**: `bb plugin build` on a server-only plugin emits
      dist/server.js (+ meta) and no app bundle.
- [ ] **Stale prebuilt degrade**: server.meta.json with a wrong sdkMajor →
      loader falls back to source (warn logged), never a crash.

## threadPanelAction rework (2026-07-03)

`threadPanelTab` (fixed toggle next to Info/Diff, sync `visible()`) was
replaced by `threadPanelAction`: an Actions row in the right panel's
new-tab page whose `run({ threadId, openPanel })` opens closable
`plugin-panel` file-strip tabs carrying persisted JSON params. Automated:
`plugin-slot-mounts.test.tsx` (default open, ctx/params/title, error
containment, no-thread, content render + placeholder),
`plugin-app-definition.test.ts` (collector validation),
authoring-docs pins (`threadPanelAction: ["threadId", "params"]`).

- [ ] **Action row live**: install a plugin registering a
      threadPanelAction → open a thread → "+" new tab → the action lists
      under Actions with the plugin logo; selecting it replaces the
      new-tab with a closable tab (logo + title) rendering the component.
- [ ] **Params + dedupe**: `openPanel({ title, params })` twice with the
      same params focuses one tab; different params open a second tab;
      both restore after a page reload with their params.
- [ ] **run error containment**: a `run` that throws (or rejects) logs a
      console warning, shows no tab, launcher stays usable.
- [ ] **Plugin gone degrade**: disable the plugin with its tab persisted →
      reopening the thread shows the "not available" placeholder, not a
      crash.
- [ ] **Old persisted state**: pre-rework localStorage with a plugin-panel
      fixed tab fails schema parse → that thread's panel state resets
      cleanly (fresh default panel, no error).

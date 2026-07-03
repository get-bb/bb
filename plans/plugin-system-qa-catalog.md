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
- (Phase 2) Plugin slash-command `args` is unreachable from the shipped
  composer — the trigger query stops at the first whitespace, so the
  composer always sends `""`. Non-empty args only arrive via a direct
  `POST /plugins/:id/slash/:name`. Composer args support is deliberate
  backlog, not built yet. (The earlier "contributions refresh only on the
  ≤30s stale time" gap is fixed: the server now broadcasts
  `plugins-changed` and open pages refetch contributions live.)

## Phase 2 — appended as slices land

(builders: add your slice's manual QA items here)

### P2.1 Plugin skills tier + bb.agents.addContext

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
- [ ] **addContext section in instructions**: install a tiny context plugin:
      `mkdir -p /tmp/bb-plugin-ctx`, write `package.json` with
      `{ "name": "bb-plugin-ctx", "version": "0.1.0",
      "bb": { "server": "./server.ts" } }` and `server.ts` with
      `export default (bb: any) => { bb.agents.addContext(() => "Always
      mention the word pineapple in your first reply."); };`, then
      `pnpm bb:dev plugin install /tmp/bb-plugin-ctx`. Spawn a thread with
      any prompt — the reply mentions pineapple, and the thread's
      instructions (daemon command log, or ask the agent to repeat its
      instructions) contain
      `The following instructions come from the BB plugin "ctx":`.
- [ ] **Failure isolation**: change the provider body to
      `new Promise(() => {})` (never resolves) and `pnpm bb:dev plugin
      reload ctx` — turn submission still proceeds after the ~2s time box,
      the section is absent, `bb plugin list` shows the error in the
      plugin's handler stats, and the plugin stays `running`.
- [ ] **Experiment gate**: turn the `plugins` experiment off — the next turn
      has no plugin skills and no plugin context sections.

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
- [ ] **codex e2e**: `pnpm bb:dev thread spawn --project proj_personal
      --provider codex --permission-mode workspace-write --prompt "Use the
      fruit_lookup tool and reply only with its result." --json` — the reply
      is `papaya` and the thread transcript shows a `fruit_lookup` tool call
      (not a bash workaround).
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
- [ ] **Cross-plugin collision**: install a second plugin registering the
      same `fruit_lookup` name — `bb plugin list` shows the second plugin
      `running` with status detail `tool "fruit_lookup" is already
      registered by plugin "fruit" — not registered`; the first plugin's
      tool keeps working.
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

### P2.4 Slash commands (bb.ui.registerSlashCommand)

Prereq: `plugins` experiment on; dev server via `scripts/bb-dev-app` with
`eval "$(scripts/bb-dev-app env)"`. Slash commands ride the composer's `/`
menu, so pick a provider with a command surface (claude-code works).

- [ ] **Install a slash plugin**: `mkdir -p /tmp/bb-plugin-slash`, write
      `package.json` with `{ "name": "bb-plugin-slash", "version": "0.1.0",
      "bb": { "server": "./server.ts" } }` and `server.ts` with:
      `export default (bb: any) => {
        bb.ui.registerSlashCommand({ name: "standup",
          description: "Draft a standup summary",
          run: async ({ args, threadId, projectId }) =>
            ({ insertText: "Standup (" + (threadId ?? "no thread") + ", "
              + (projectId ?? "no project") + "): " + args }) });
        bb.ui.registerSlashCommand({ name: "send-note",
          description: "Send a note as a message",
          run: async () => ({ send: [{ type: "text",
            text: "note from plugin", mentions: [] }] }) });
        bb.ui.registerSlashCommand({ name: "slow-cmd",
          description: "Resolve after 4s",
          run: () => new Promise((r) =>
            setTimeout(() => r({ insertText: "finally" }), 4000)) });
        bb.ui.registerSlashCommand({ name: "boom-cmd",
          description: "Always fails",
          run: async () => { throw new Error("kaboom"); } });
      };`
      then `pnpm bb:dev plugin install /tmp/bb-plugin-slash --yes`.
- [ ] **Menu inclusion (thread composer)**: open a claude-code thread, type
      `/` in the follow-up composer — the menu lists a trailing **Plugin
      commands** section with `standup`, `send-note`, `slow-cmd`,
      `boom-cmd` (after Commands/Skills sections). Typing `/stand` filters
      to `standup`.
- [ ] **insertText from a thread**: pick `standup` (Enter or click) — the
      typed `/stand` token disappears and
      `Standup (thr_..., proj_...):` is inserted at the cursor as a draft
      (nothing is sent).
- [ ] **Homepage composer (null thread path)**: on the project home / new
      thread composer, type `/standup` and pick it — inserted text reads
      `Standup (no thread, proj_...):` (threadId is null before a thread
      exists; projectId is the selected project).
- [ ] **Pending state**: type `/slow` and pick `slow-cmd` — the `/` menu
      stays open showing a spinner row "Running /slow-cmd…" for ~4s, then
      `finally` is inserted at the cursor.
- [ ] **{ send } submits a message**: in a thread, pick `send-note` — a
      user message "note from plugin" is sent through the normal follow-up
      path (queued instead if the thread is running).
- [ ] **Error toast**: pick `boom-cmd` — an error toast "/boom-cmd failed —
      kaboom"; the composer text is untouched apart from the removed
      trigger token.
- [ ] **Disappear on disable**: `pnpm bb:dev plugin disable slash` — after
      the contributions query refreshes (≤30s stale time; reload to force
      it), the Plugin commands section is gone from the `/` menu. Re-enable
      brings it back.
- [ ] **Reserved names**: a plugin registering `name: "compact"` fails to
      load with `slash command "/compact" is a built-in composer command`
      (`bb plugin list` shows status `error`).
- [ ] **API surface** (curl, optional): `curl -X POST -H 'content-type:
      application/json' -d '{"args":"hi","threadId":"thr_..."}'
      http://<server>/api/v1/plugins/slash/slash/standup` → `{ ok: true,
      action: "insertText", insertText: ... }`; omitting threadId/projectId
      passes null to the handler; unknown command → 404; disabled plugin →
      503; foreign Origin → 403; non-JSON body → 415.

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
- [ ] **/standup**: type `/standup` in a thread or homepage composer and
      pick it — a draft ("Standup:" + up to five most recently updated
      thread titles + "Blockers:") is inserted at the cursor, nothing sent.
      On the homepage without a project it lists threads across projects.
- [ ] **Re-install agent-enrichment** (extended in P2.6 with the native
      tool, addContext, and a docs mention provider): `pnpm bb:dev plugin
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
- [ ] **addContext note**: in any fresh thread, ask "what do the plugin
      instructions in your context say about commits?" — the reply reflects
      the conventions note (`The following instructions come from the BB
      plugin "agent-enrichment":` section in the thread instructions).

### Phase 2 end-to-end (the full manual pass)

One sitting, fresh dev server (`scripts/bb-dev-app current`,
`eval "$(scripts/bb-dev-app env)"`, Plugins experiment on):

1. `pnpm bb:dev plugin install ./examples/plugins/agent-enrichment --yes`
   and `pnpm bb:dev plugin install ./examples/plugins/small-ux-pack --yes`;
   `bb plugin list` shows both `running`.
2. In the browser, open a thread that has run once: click **Summarize
   thread** (confirm → success toast → agent summary turn), then **Copy
   status** (error toast with the thread's status).
3. Type **/standup** in the composer → standup draft inserted from recent
   thread titles.
4. Type **@testing** → pick the Plugin docs item → send → agent received
   the doc body as agent-only context (ask it, or check the daemon-bound
   input for the `Context for @Testing…` part).
5. `pnpm bb:dev thread spawn --project proj_personal --provider codex
   --permission-mode workspace-write --prompt "First call the docs_search
   tool with query 'conventional commits', then run 'bb docs last' in bash.
   Reply with both outputs." --json` — the transcript shows a native
   `docs_search` tool call AND a bash `bb docs last` whose output matches
   the tool's query (shared kv cache). Repeat with `--provider claude-code`
   for the MCP-proxy path.
6. Ask any fresh thread to list its skills → `repo-conventions` and
   `plugin-commands` are present; its instructions carry the
   agent-enrichment conventions note.
7. Turn the Plugins experiment off → header buttons, `/` menu section, and
   mention group disappear after the contributions query refreshes; new
   turns carry no plugin skills/context/tools.

## Phase 3

### P3.1 bb plugin build

No server required for any of these (`bb plugin new` / `bb plugin build` are
local commands).

- [ ] **Scaffold with a frontend entry**: `pnpm bb:dev plugin new hello --app`
      → `bb-plugin-hello/` contains `app.tsx`, and its `package.json` has
      `"bb": { "server": "./server.ts", "app": "./app.tsx" }`. Without
      `--app`, no `app.tsx` and no `bb.app` field (headless scaffold
      unchanged).
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

- [ ] **Install-time build (path)**: `pnpm bb:dev plugin install ./bb-plugin-hello`
      → install succeeds and `bb-plugin-hello/dist/` now exists (app.js,
      app.css, app.meta.json) even though you never ran `bb plugin build`.
      Break `app.tsx` (syntax error) and re-install → the install itself
      fails with the esbuild error; fix it and re-install.
- [ ] **Inventory**: `curl <server>/api/v1/plugins | jq '.plugins[] | {id, app}'`
      → the hello plugin has `app.hasApp: true` and a `bundle` object with
      `jsUrl`/`cssUrl` (both carrying `?h=<hash>`), `hash`, `sdkMajor`,
      `sdkVersion`, `compatible: true`. A headless plugin shows
      `{ hasApp: false, bundle: null }`.
- [ ] **Asset routes**: `curl -i "<server><jsUrl>"` → 200,
      `content-type: text/javascript`, `cache-control: public, max-age=31536000,
      immutable`; drop or change the `?h=` value → same body but
      `cache-control: no-store`. `app.css` serves as `text/css`. Unknown
      plugin id or a file other than app.js/app.css → 404.
- [ ] **Host loading**: open the app with the experiment on → the browser
      network tab shows one `app.js?h=…` import and an `app.css` stylesheet
      link per running app-plugin; `document.head` contains
      `link[data-bb-plugin-css="hello"]`; console:
      `globalThis.__bbPluginRuntime` has react / reactDom / reactDomClient /
      jsxRuntime / jsxDevRuntime / pluginSdkApp slots. No UI renders yet —
      slots are P3.3.
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
      `threadPanelTab({ id, title, component, visible })`, and
      `composerAccessory({ id, component })`, rebuild + reload the plugin,
      then reload the page:
      the sidebar shows the nav entry above the project list (active state
      when on the route) → clicking it lands on `/plugins/hello/board`
      rendering the panel component; a thread's right panel shows the tab's
      title button next to Info/Diff and clicking it renders the component
      with that `threadId` (selection persists per thread across reloads);
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

### P3.5 Linear hero

The full-stack hero (`examples/plugins/linear`, design §8): backend sync +
frontend slots + mentions + CLI. Automated coverage:
`apps/server/test/services/plugins/heroes-linear.test.ts` (install-time
bundle build, schedule → cache → realtime, rpc surface, attributed spawn,
mention search/resolve-at-send, CLI endpoint) and
`apps/cli/src/__tests__/linear-example-bundle.test.ts` (built bundle
registers exactly the three slots against a stub runtime). Checked items
below were verified in the 2026-07-02 headless smoke; the rest need a real
Linear API key and a browser.

- [x] **Install + inventory** (live 2026-07-02): `pnpm bb:dev plugin install
      ./examples/plugins/linear --yes` → `needs-configuration` with the
      configure hint; `/api/v1/plugins` shows `app.hasApp: true` and a
      bundle with `jsUrl`/`cssUrl` carrying `?h=<hash>`, `compatible: true`.
- [x] **Assets over HTTP** (live 2026-07-02): `app.js` → 200
      `text/javascript` containing `__bbPluginRuntime`; `app.css` → 200
      `text/css` (Tailwind v4 output).
- [x] **rpc + contributions unconfigured** (live 2026-07-02):
      `POST /api/v1/plugins/linear/rpc/listIssues` → `{ ok: true, result:
      { issues: [] } }`; contributions list the `bb linear` CLI command and
      the `linear-issue` mention provider.
- [x] **CLI needs-configuration shape** (live 2026-07-02): `bb linear
      issues` → "No cached issues. Run `bb linear sync` first."; `bb linear
      sync` → exit 1 with "Linear API key not set. Set apiKey … `bb plugin
      config linear` …".
- [ ] **Configure with a real Linear API key**: `bb plugin config linear set
      apiKey lin_api_…` (+ optional `teamKey`, `defaultProject`), `bb plugin
      reload linear` → status `running`; `bb linear sync` prints
      "Synced N open issue(s)"; `bb linear issues` lists them with states
      and a "last synced" footer.
- [ ] **Homepage card fills**: open the app root → the "Open Linear issues"
      section lists your issues (identifier, title, state); before the
      first sync it shows the EmptyState hint pointing at Settings →
      Plugins. Within 5 minutes of a Linear-side edit (or after `bb linear
      sync`) the card refreshes in place via the `issues-updated` signal —
      no page reload.
- [ ] **Click an issue → thread spawns and navigates**: "Start work" on an
      issue from a project's compose view → spawns in that project;
      from the bare homepage → spawns in `defaultProject`; the app
      navigates to the new thread; `curl /api/v1/threads/<id>` shows
      `origin: "plugin"`, `originPluginId: "linear"` and the
      `ENG-…: <title>` thread title. With no project anywhere, the click
      surfaces the "set defaultProject" error instead of spawning.
- [ ] **Board panel**: the sidebar shows a "Linear" entry → clicking lands
      on `/plugins/linear/board` with issues grouped into by-state columns;
      theme tokens follow the active palette.
- [ ] **@mention an issue**: type `@ENG-` in the composer → a "Linear
      issues" group appears; pick one and send → the agent receives the
      issue's identifier/title/state/description as agent-only context
      (ask it what issue it is working from).
- [ ] **Issue tab on spawned threads**: open a thread spawned via "Start
      work" → the right panel shows an "Issue" tab rendering the linked
      issue; unrelated threads show NO Issue tab (the sync `visible()`
      cache — see the plugin README's "sync-visible() pattern"); the tab
      appears immediately after startWork navigation (no refresh).

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
2. Install the Linear hero and run the full "### P3.5 Linear hero" list
   with a real API key.
3. Kill-switch with eyes: make hello's section component throw → chip only,
   Linear's section and the rest of the app stay alive.
4. Stale bundle with eyes: path installs rebuild themselves on a version
   mismatch, so follow P3.2's npm prebuilt rule — install an npm-packed
   plugin whose `dist/app.meta.json` carries a different `sdkMajor`;
   confirm the backend stays `running`, the inventory shows
   `compatible: false`, and the frontend logs the "skipping until the
   plugin is updated" warning without crashing.
5. Reload the Linear plugin twice (`bb plugin reload linear` ×2) with the
   homepage open → still exactly one "Open Linear issues" section.
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

- [ ] The agent completes the whole loop unassisted: scaffolds with
      `bb plugin new weather` (or equivalent), writes a `bb.cli.register`
      handler returning the canned string, installs with
      `bb plugin install . --yes`, and verifies by running
      `bb weather <city>` itself (workspace-write is required — a readonly
      sandbox blocks the bb CLI's loopback network).
- [ ] `bb plugin list` afterwards shows the plugin `running` with its
      `bb weather` command; `bb weather tokyo` prints the canned string
      from any thread.
- [ ] The thread transcript shows the bb-plugin-authoring skill being
      used (not trial-and-error against the API).

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

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

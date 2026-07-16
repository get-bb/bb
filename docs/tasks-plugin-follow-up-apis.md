# Tasks plugin — follow-up platform APIs

Gaps in the plugin platform surfaced while building `marketplace/plugins/tasks`.
The plugin ships with workarounds for all of these; each item removes a
workaround. None block the plugin.

## Todo

- [ ] **`thread.active` lifecycle event in `bb.events`.** The curated plugin
  event set is `thread.created/idle/failed/deleted` — there is no event for a
  thread starting to run. Tasks works around it with the full-trust
  `bb.sdk.subscribe("thread:changed")` stream (filtering `status-changed`)
  plus a 5-minute reconcile sweep (`marketplace/plugins/tasks/lifecycle/`).
  A curated event would let capability-narrow plugins track live agent status
  without the whole SDK.

- [ ] **Include the personal project in `sdk.projects.list()`** (or an
  explicit `includePersonal` option). Its absence forces the Tasks
  project-link picker into a free-text `proj_` id path for the most common
  local setup (`views/manage/bb-project-link.tsx`).

- [ ] **Server-side thread deep-link builder.** Backend plugins have no way to
  produce a navigable thread URL, so system comments carry raw `thr_` ids
  (`marketplace/plugins/tasks/lifecycle/index.ts`); only the frontend can
  navigate via `useBbNavigate().toThread`.

- [ ] **Fix `bb plugin list` / `bb plugin reload` CLI response validation.**
  Both fail on a missing `displayName` even for builtin plugins (pre-existing
  core bug, hit constantly during plugin development; workaround is the HTTP
  API: `POST /api/v1/plugins/reload`).

- [ ] **Ungate or align `bb machine list`.** The CLI command is
  experiment-gated while `sdk.hosts.list()` is freely available to plugins —
  inconsistent surface for the same data.

- [ ] *(low priority — accepted as-is)* **Atomic active-only send**
  (`threads.messages.send` with an `onlyIfActive`/strict-steer option).
  `mode: "steer"` resolves to `start` on idle threads, so Tasks' notify
  delivery does a live status read before each send
  (`marketplace/plugins/tasks/steer/index.ts`); the residual check-then-send
  race is documented there and deliberately accepted.

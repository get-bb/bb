# Loops & Skills redesign — inline build

Build the locked Ladle prototype (`apps/app/src/views/RedesignPrototype.stories.tsx`)
into production, using the **actual bb design-system components** (no bespoke
re-implementations). Then seed dev fixtures covering all cases.

Branch: `bb/redesign-thread-p-thr_xnwqkhbpc4` (build inline). Source of truth for
visuals: the prototype stories + Moss note "bb Skills, Loops & Settings — Redesign Proposal".

## Locked decisions

- Accent = existing `--file-accent` blue, used for selected/focus/links/on-states; green=success, red=destructive.
- `--primary` darkened to ~`oklch(0.27 0 0)` (light); dark mode counterpart stays light-on-dark, more decisive.
- Settings stays single-column (no grouped rail) — retune hierarchy/spacing only.
- Page title + description on the body; chrome minimal; no icons in titles.
- "Loops" is the user-facing label; `Automation*` types/tables/routes stay internal (no migration).
- Sidebar is NOT restructured. (Relabel the existing entry text/icon only if needed; no layout change.)
- Creation is via the **prompt composer**, inline on each page (not a popout). No create/edit *forms*.
- Templates are clickable pills inside the prompt box that insert a starter prompt.
- Skill rows match the `/`-command skill typeahead; grouped by provider (real logos); searchable.
- Loop rows: name + cadence + last-run health + next run. No Script/API badges (mode lives in detail).
- Edit flow: skills edit their `SKILL.md`; loops edit config inline on the detail page.

## Component mapping (prototype → real)

| Prototype piece | Real component |
| --- | --- |
| `Toggle` | `Switch` (`@/components/ui/switch`) |
| hand-rolled prompt box | `RootComposeView`/`NewThreadPromptBox` with a new inline `seedPrompt` surface |
| `Picker` chips | `ModelReasoningPicker` / `PermissionModePicker` / `EnvironmentPicker` / `OptionPicker` |
| row `⋯` menu | `DropdownMenu` (already used by `AutomationRow`) |
| skill row | the `MentionMenu` `SuggestionRow` pattern (Zap icon + name + muted desc) |
| settings rows | `SettingsSection` / `SettingsWithControl` / `PageShell` |
| provider logos | `getProviderIconInfo` (done in prototype) |
| empty state | `EmptyStatePanel` |

## Status — ALL STAGES BUILT (2026-06-20)

Stages 1–9 complete and committed; smoke-tested live against the dev instance
(:14104 / :22104): Loops list/detail/edit + run history + View thread; Skills
list/create-via-prompt/view/edit/delete with security guards (non-bb scope →
400, path-escape name → rejected). Minor follow-up: map the daemon
`invalid_skill_name` error to 400 instead of 502. Inline-embedded prompt box and
accent-promotion sweep remain as optional polish (see below).

## Status (historical)

- **Done & committed:** 1 (Loops overview), 2 (detail health + run history), 3 (Loop inline edit), 4 (S1 skills backend cherry-picked), 5 (Skills view + route + nav), 6 (Skills create-via-prompt — seeded composer), 8 (darken primary), loop-detail declutter + persistent View thread. 9 (dev fixtures) seeded in the running dev instance.
- **Remaining — Stage 7 (skill view + edit):**
  - **View** (all scopes): reuse the existing `host.read_file` daemon command. Add `GET /projects/:id/skills/content?provider&scope&name&environmentId` → server lists skills, matches by identity, reads the authoritative `filePath` (never a client path), returns `{ content }` (decode via `decodeDaemonFileContent`). Frontend: click a skill row → detail/dialog showing the SKILL.md; Delete for `manageable` (bb) skills via the existing S1 delete route.
  - **Edit** (bb skills only): needs a **new secure host-write daemon command** (`host.write_skill`, bb-user/bb-project only, path resolved host-side from `(scope,name,cwd)` like `delete_skill`, realpath/symlink guards) + server route + contract + the edit UI. Security-sensitive — do as a focused, reviewed change.
- **Inline create-via-prompt** (embedding `NewThreadPromptBox` on the page) deferred: it needs `RootComposeView`'s full `modeConfig`; current create uses the seeded composer (robust, matches Loops). Revisit as a `RootComposeView` extraction if true-inline is wanted.
- **Accent promotion** (decision #1, `--file-accent` on focus/active/links) — follow-up polish sweep across built surfaces.

## Stages

1. **Loops overview restyle** — `AutomationsView.tsx`: body title "Loops" + description; two-line rows (cadence via `formatCronCadence`, last-run health via `lastRunStatus`/`lastRunAt`, next run); drop project/script/API pills; relabel user-facing strings to "Loops". Keep create entry (becomes prompt box in stage 5). Update stories/tests.
   - Exit: AutomationsView renders the new design; `pnpm exec turbo run test --filter=@bb/app -- AutomationsView` green; typecheck green.
2. **Loop detail — health + run history** — `AutomationDetailView.tsx`: health rollup (success rate, last/next run, avg duration) from runs; run-history list (status, scheduled/manual trigger, time, duration, View thread / skip reason) wired to `automation_runs`.
   - Exit: detail shows rollup + history; tests green.
3. **Loop edit flow** — inline-editable config on detail (cron, prompt, model/permission/env pickers, auto-archive) with Save; uses real pickers. No separate form route.
   - Exit: edit toggles config to editable + persists via the update route; test the mutation.
4. **Skills backend on-branch** — bring the committed S1 skills backend (`GET`/`DELETE /projects/:id/skills`, `host.list_skills`/`delete_skill`, `skillSummarySchema`) onto this branch.
   - Exit: `pnpm exec turbo run test --filter=@bb/server -- skills` + host-daemon skill tests green.
5. **Skills view + route** — `SkillsView.tsx`: provider-grouped, searchable, typeahead-style rows wired to `GET /skills`; row → skill detail; `/skills` route.
   - Exit: SkillsView renders from query; route resolves; tests green.
6. **Inline create-via-prompt** — `RootComposeView` inline `seedPrompt` surface embedded on Skills & Loops with template pills; submit spawns a regular thread.
   - Exit: clicking a pill seeds the box; submit creates a thread; tests green.
7. **Skill detail + edit** — view `SKILL.md`; edit source (Save) + Delete via the S1 delete route.
   - Exit: view/edit/delete work against the API; tests green.
8. **Tokens** — darken `--primary` (light+dark) in `theme.css`; promote `--file-accent` for focus/active/selected/links on the new surfaces.
   - Exit: typecheck green; visual check via Ladle across light/dark.
9. **Dev fixtures** — seed the dev instance (`scripts/bb-dev-app` + CLI/API/SQL) with skills and loops covering all cases/edge cases (see below).
   - Exit: every case visible in the running dev app.

## Fixture matrix (stage 9)

- Loops: active/paused; agent + script mode; last run succeeded/failed/skipped/never; next-run soon/none; long names; many runs (history paging); failing loop; manual vs scheduled runs; trigger types.
- Skills: 1 provider only vs multiple providers; many skills (scroll); long descriptions; no skills (empty); search no-match.

## Validation

- `pnpm exec turbo run typecheck --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/app` (focused per stage; pipe to file)
- Ladle visual pass (light + dark) for each surface.
- Dev-instance click-through against the fixtures.

Delete this plan once the build merges.

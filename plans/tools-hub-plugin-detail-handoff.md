# Plugin detail page — design pass handoff

**The work is code-complete and green, but the last three visual changes have never been looked at.** Your first job is to open the Ladle story in a real browser with Computer Use, judge what is actually on screen, and fix what is wrong. Everything else in this doc is context for that.

Branch `agent/tools-hub-schedules`, draft PR [#888](https://github.com/ymichael/bb/pull/888), worktree `/Users/brsbl/.bb/worktrees/env_mfpen2wdi3/bb`. Five unpushed commits sit on top of `bf52b3f7b`.

> **Do not merge, do not mark PR #888 ready for review, and do not push unless asked.** The user reviews before any of that.

## Start here: validate visually with Computer Use

The previous agent's headless-Chrome screenshot harness died partway through this work, so three commits shipped on structural evidence alone — typecheck and tests, never a rendered pixel.

| Commit | Change | Seen? |
| --- | --- | --- |
| `637ce58d7` | Rebuild page around Capabilities | ✅ dark + light |
| `9b535e16c` | Tighten table row density 39px → 31px | ⚠️ measured only |
| `d84ada1ce` | Full-width banner bars above the page | ❌ **never seen** |
| `2f6703e74` | Version/installed moved into header meta | ❌ **never seen** |
| `3e43d6556` | Flatten tables — no bordered box | ❌ **never seen** |

Use **Computer Use** — drive a real browser and look at it. Do not sink time into the CDP harness first.

Ladle for this worktree runs on **port 62002** (61000 belongs to a different worktree, `env_rb29bjkq4s` — do not use it). If it is not up:

```bash
source ~/.nvm/nvm.sh && nvm use 22
cd /Users/brsbl/.bb/worktrees/env_mfpen2wdi3/bb/apps/app
pnpm exec ladle serve --port 62002
```

Stories to review, in priority order:

| Story | What to judge |
| --- | --- |
| [`extensions--plugin-detail-states`](http://localhost:62002/?story=extensions--plugin-detail-states) | All 10 states. Unhealthy and Update available show the banners; Full and Awkward content show the flat tables. |
| [`extensions--skill-detail-states`](http://localhost:62002/?story=extensions--skill-detail-states) | Regression check — `detail-sections.tsx` and `detail-shell.tsx` are shared. |
| [`tools--automations`](http://localhost:62002/?story=tools--automations) | Automation detail states, also touched in `637ce58d7`. |

Check both light and dark, and both a wide viewport and a narrow one (~700px) — the About row and the banner gutters are the parts most likely to break when narrow.

### Specific things to look hard at

- **Banner bars** (`d84ada1ce`) — do they read as page-level bars spanning the pane, with their text aligned to the same left edge as the section headings below? Is the stack above the plugin name and toggle, not below?
- **Header meta line** (`2f6703e74`) — `1.4.0 · Installed Jul 8, 2026` above the mono path. Does the `·` separator sit right? Is the mono version at `text-xs` too small or too quiet next to the path?
- **Flat tables** (`3e43d6556`) — with the bordered box gone, do three consecutive rule-separated lists still read as three distinct sections, or do Capabilities / Background services / Scheduled jobs now bleed together? This is the change most likely to have gone too far. If they blur, the fix is stronger section separation (`ResourceDetailStack` spacing or a heading rule), **not** putting the boxes back — the user asked twice for less weight here.

### If you want the CDP harness anyway

`/tmp/shot.mjs` and `/tmp/measure.mjs`. The root-cause bug is diagnosed and partly fixed: `Target.attachToTarget` returns a session whose Runtime starts on `about:blank`, and `Runtime.executionContextCreated` for the real page has already fired by then — so it never arrives, the pinned context ID stays null, and every `Runtime.evaluate` silently resolves against `about:blank` forever. `shot.mjs` now connects directly to the page target's own `webSocketDebuggerUrl` instead, which fixed the silent-wrong-context failure. It still times out on this machine for environmental reasons (105+ node processes, two Ladle servers). `measure.mjs` has the same unfixed attach bug.

## What the page looks like now

```
┌────────────────────────────────────────────────────────────┐  ← banners span the pane,
│ ⚠ Degraded                                      [Reload]   │    above everything, no radius,
│   Reconnecting to the GitHub API                           │    text on the page gutter
├────────────────────────────────────────────────────────────┤
│ ⬢ GitHub  [Direct install]                        ●   ⋯    │  ← pill = passive provenance
│ 1.4.0 · Installed Jul 8, 2026                              │  ← identity facts
│ /Users/you/.bb/plugins/github                              │
│                                                            │
│ About                                                      │
│ Browse GitHub issues and pull requests without leaving bb.  │  ← prose only
│                                                            │
│ Capabilities                                               │
│ ▸ bb gh          Work with GitHub from the terminal        │  ← flat: row rules only,
│ ▤ skills         Skills bundled with this plugin           │    flush with the heading
│ ⚙ gh_search      Search issues and pull requests           │
│                                                            │
│ Background services                                        │
│ ✓ issue-sync                                               │
│ ↻ webhook-listener                                         │
│                                                            │
│ Scheduled jobs                                             │
│ ✓ daily-digest   Next Jan 15, 2027                         │
│ ✗ stale-sweep    GitHub API rate limit exceeded            │
└────────────────────────────────────────────────────────────┘
```

## Decisions that are settled — do not undo

Each of these was asked for explicitly, several more than once. Reversing one is a regression, not a judgment call.

| Decision | Why |
| --- | --- |
| Provenance is a passive `Pill` flush to the name | It used to be a green button that swapped to a red Uninstall on hover — a status that deleted on click, at the same weight as the enable toggle. |
| Uninstall lives in the overflow menu | Irreversible, so it sits with the ownership actions, not beside the reversible toggle. |
| Banners are full-width bars above the page | User: *"the banners should be banners across the entire width and very top of the page."* |
| No `Release` section; no About fact table | Release went section → fact table → header meta line. Each step took weight off Capabilities, which is what the page is for. |
| No `Health` wrapper; two named tables | Services and schedules are different objects with different status vocabularies. |
| Kind is a hoverable glyph, not a column | Most plugins contribute 1–2 items per kind, so a Kind column is near-unique per row and reads as filler. |
| Tables are flat | User: *"make tables on detail page more flat."* The page is already the panel (`detail-sections.tsx:38`). |
| Running scheduled job shimmers its own clock | The app never swaps a row icon for a spinner to say "working" (`ThreadRow.tsx:144`). |
| Skipped automation runs use `ArrowTurnForward` | `CircleDashed` aliases `Spinner` in `icon.tsx`, so skipped rendered identically to running. |

## Hard constraints

- **Never guess.** Ground every claim in repo code. The user said this explicitly and it is the standing rule: *"Please never guess. This is very important. Ground everything in the actual repo code, otherwise you're just doubling work for yourself and myself in the future."*
- **Theme tokens only.** Derive from `--canvas`/`--ink` via `color-mix`. No `oklch(L 0 0)` literals, no arbitrary `text-[Npx]`. `apps/app/src/components/ui/theme.css` is the source of truth; `theme.test.ts` guards it.
- **`plugins/automations` cannot import from `apps/app`.** It depends only on `@bb/shared-ui`. This is why `plugins/automations/lib/model-label.ts` duplicates two formatters instead of sharing them — the user chose that: *"don't move the formatters, just duplicate in the plugin."*
- **Be conservative about `@bb/shared-ui`.** Five dependencies, no domain knowledge. Two files there are already touched by this branch (`detail-sections.tsx`, `detail-shell.tsx`) and those changes affect skill and automation detail pages too.
- **Node 22.** `source ~/.nvm/nvm.sh && nvm use 22` before anything.
- **Turbo for build/typecheck.** `pnpm exec turbo run typecheck --filter=@bb/app`. Run vitest from `apps/app`, not the repo root — from the root it silently collects only 5 files instead of 24.

## Verify

```bash
source ~/.nvm/nvm.sh && nvm use 22
cd /Users/brsbl/.bb/worktrees/env_mfpen2wdi3/bb

pnpm exec turbo run typecheck --filter=@bb/app --filter=@bb/shared-ui
pnpm exec turbo run typecheck test --filter=bb-plugin-automations

cd apps/app
pnpm exec vitest run src/components/tools src/components/plugin src/views/ToolsView.plugin-detail.test.tsx
```

Last known state: **24 files / 148 tests green**, typecheck clean everywhere, `bb-plugin-automations` 40 tests green. Full `@bb/app` suite was 2151/2151 as of `637ce58d7`.

Tests that pin the decisions above, so you know what will fail if you regress one:

| File | Pins |
| --- | --- |
| `apps/app/src/views/ToolsView.plugin-detail.test.tsx` | Provenance pill not a button, uninstall in overflow menu, banner is full-bleed and outside any section, table shell has no border/rounded, first cell has no left padding, version renders mono outside every section, running schedule shimmers a Clock. |
| `apps/app/src/components/tools/detail-page-recipes.test.tsx` | Section order and labels; skipped-run glyph. |
| `apps/app/src/components/plugin/management/PluginUpdatesCard.test.tsx` | Compatibility banner copy and builtin suppression. |
| `apps/app/src/components/tools/tools-public-exports.test.ts` | Frozen export counts: 69 shared resource-list, 21 SkillsView, 3 ToolsView. |

## Open items

Ordered by how likely the user is to want them.

1. **Icon disambiguation** — awaiting a decision, proposal not yet written up. `Zap` is triple-booked (Skills nav, default plugin icon, promptbox action); `Toolbox` collides between the sidebar Extensions entry and Agent tools. Icons are HugeIcons (`@hugeicons/react`), ~207 curated names in `ICON_MAP` — **not Lucide**.
2. **Automations detail polish** — three refinements the user asked for that were interrupted and never finished: a provider logo mark in the prompt footer, a skip-icon replacement, and identical raised treatment for the Prompt and Script surfaces.
3. **Shared metadata tone** — `detail-sections.tsx` metadata row moved `text-muted-foreground` → `text-subtle-foreground`. Undecided whether that should stay shared or be scoped to automations. It currently affects plugin, skill, and automation pages.
4. **Composer action ordering** — plugin actions sort by frequency, not recency, below `PLUGIN_COMPOSER_INLINE_PLUGIN_LIMIT = 3`. User has not asked for a change; noted as a finding.

**Parked by the user — do not pick up:** thread-header plugin-action overflow behaviour. Their words: *"let's leave this for now."*

## Contract findings, unresolved

Surfaced during a taxonomy audit against `capabilitySummary()`. None are blocking; all are real.

- `thread-integration` is a leaky bucket **in the contract itself** — it holds both `threadActions` and `mentionProviders`.
- Only 2 of 20 capability kinds survive a disabled plugin (the manifest tier). The other 18 need a running plugin to enumerate.
- Disabled plugins still list schedules promising a next run that nothing will honour.
- `providerId` is an unvalidated `z.string()` (`rpc-types.ts:126`). Automations persist `"claude"`; the catalogue's canonical id is `"claude-code"`. `stripModelBrandPrefix` in `plugins/automations/lib/model-label.ts` was widened to prefix-match as a workaround — remove the widening once the stored id space is reconciled.

## Files this branch owns

**New:** `apps/app/src/components/tools/plugin-detail-table.tsx`, `apps/app/src/components/tools/plugin-detail-banner.tsx`, `plugins/automations/lib/model-label.ts`

**Heavily changed:** `apps/app/src/components/tools/PluginDetail.tsx`, `PluginCapabilities.tsx`, `apps/app/src/components/plugin/management/PluginUpdatesCard.tsx`, `apps/app/src/views/ToolsView.tsx`, `plugins/automations/detail-view.tsx`

**Shared, touch carefully:** `packages/shared-ui/src/components/ui/resource/detail-sections.tsx`, `detail-shell.tsx`

**Stories:** `apps/app/src/components/tools/ExtensionsDetailStates.stories.tsx`, `Automations.stories.tsx`, `apps/app/src/components/thread/PluginThreadActions.stories.tsx`. Note `apps/app/.ladle/ladle.css` gained `@source "../../../plugins/automations";` — Tailwind never scanned plugin code before, so plugin classes were silently dropped from story CSS.

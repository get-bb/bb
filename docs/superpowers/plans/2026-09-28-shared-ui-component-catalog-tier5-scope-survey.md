# shared-ui component catalog — tier 5 scope survey (addendum to tier 4)

**Purpose:** tier 4's plan (`docs/superpowers/plans/2026-09-28-shared-ui-component-catalog-tier4.md`, Global Constraints) named 28 components as tier 5's "zero-usage" scope, based on an internal-only survey (`plugins/*` and `apps/app/**` in this repo). Before writing tier 5's own plan, that assumption was re-checked. It was wrong on two axes: some components gained (or were miscounted as lacking) internal usage, and — the bigger gap — `@bb/shared-ui` is republished as copyable source through `packages/plugin-registry`, so components with zero usage inside this repo can still have real usage in the wider community-plugin ecosystem that builds against that registry.

**Result:** the 28-component list shrinks to **17 genuinely zero-usage components**. The other 11 have a real call site somewhere (internal or external) and need an actual story, not zero-usage treatment, when tier 5 is planned.

## Method

1. **Internal re-survey.** Re-ran the same `@/components/ui/<name>` / `@bb/shared-ui/<name>` alias grep tier 4's own research used, across `plugins/*` and `apps/app/**` (excluding `*.stories.tsx` and `packages/shared-ui` itself), for all 28 candidates plus `option-display` (previously believed to have zero *component* usage, only its class-name constants reused). Also confirmed no barrel/index file in `packages/shared-ui/src/components/ui/` could hide a re-export path.
2. **External usage, attempt 1 (failed):** searching GitHub for `"@/components/ui/<name>"` alone. Useless — that's the generic shadcn/ui alias convention, used by thousands of unrelated projects. Every candidate "hit" this way was noise.
3. **External usage, attempt 2 (failed):** combining `"@/components/ui/<name>"` and `"@get-bb/plugin-sdk"` in one GitHub code search query. Came back empty for every candidate, including components known to have heavy internal usage (`icon`, `button`) — GitHub code search requires both terms in the *same file*, but a plugin's UI import and its SDK import normally live in different files. False negative from a broken method, not a real finding.
4. **External usage, attempt 3 (worked):** enumerated real community bb-plugin repos — via GitHub search for `@get-bb/plugin-sdk` imports outside `get-bb/bb`, the `bb-plugin` topic, and the full listing in `MGrin/awesome-bb-plugins` (174 repos) — then grepped each repo directly for every `@/components/ui/*` import it makes, and cross-checked any hit against the remaining candidate list. Total sample: ~200 repos (27 targeted + the full 174-repo `awesome-bb-plugins` listing). Every hit reported below was verified against a real `@get-bb/plugin-sdk` import in the same repo, to rule out an unrelated shadcn project using the same component name.

`@bb/shared-ui` is `"private": true` in `package.json`, so no repo outside `get-bb/bb` could depend on it directly — but `packages/plugin-registry` (`registry.json`, `r/<item>.json`) republishes every shared-ui component's source as a `shadcn`-style registry item (`npx shadcn add @bb/<component>`), and `docs/forkable-plugins.md` documents this as the sanctioned path for a plugin to use shared-ui UI without the private package dependency. That's the mechanism that makes external usage possible at all, and why the internal-only survey structurally couldn't see it.

## Findings

**Confirmed zero usage — internal and across the ~200-repo external sample (17, tier 5's real scope):**
accordion, aspect-ratio, breadcrumb, calendar, chart, drawer, form, input-otp, menubar, navigation-menu, pagination, resizable, scroll-area, sheet, slider, table, toggle.

**Has real usage, gained/found internally (7) — pull out of tier 5, plan real stories:**

| Component | Real call site |
|---|---|
| `avatar` | `apps/app/src/components/plugin/management/PluginAuthorAvatar.tsx` |
| `branch-picker-primitives` | `plugins/environment-git-worktree/app.tsx`, `plugins/environment-project-checkout/app.tsx`, `apps/app/src/components/pickers/BranchPicker.tsx` |
| `carousel` | `apps/app/src/components/plugin/management/PluginMarketplaceListing.tsx` |
| `menu-item-hover` | same git-worktree/checkout plugins, `BranchPicker.tsx`, `ModelReasoningPicker.tsx` |
| `responsive-overlay` | `image-lightbox.tsx`, `use-hover-popover.ts`, secondary-panel components |
| `toggle-group` | `apps/app/src/components/pickers/ModelReasoningPicker.tsx` |
| `option-display` | `plugins/automations/detail-view.tsx`, `apps/app/src/components/secondary-panel/TerminalHostSelector.tsx`, `apps/app/src/components/promptbox/ThreadEnvironmentSummary.tsx` — tier 4's own conclusion ("zero real component usage, only its class-name constants are reused") was itself wrong, not just stale |

**Has real usage, external-only (5) — zero internal call sites, but real community-plugin usage:**

| Component | Real call site |
|---|---|
| `card` | `braedonsaunders/bb-plugin-provider-usage`, `vburojevic/bb-plugin-linear`, `MayankBansal12/bb-plugin-wakatime` |
| `alert-dialog` | `vburojevic/bb-plugin-linear`, `Diffuzmetall/bb-plugin-files`, `bborn/taskyou` |
| `alert` | `vburojevic/bb-plugin-handoff`, `vburojevic/bb-plugin-xcode` |
| `progress` | `vburojevic/bb-plugin-xcode` (3 files) |
| `separator` | `vburojevic/bb-plugin-ayu`, `vburojevic/bb-plugin-xcode` |

Note the concentration: `vburojevic` alone accounts for 5 of the 12 non-zero corrections across their plugins (`bb-plugin-linear`, `bb-plugin-floating-notes`, `bb-plugin-handoff`, `bb-plugin-xcode`, `bb-plugin-ayu`). A handful of prolific community authors carry a disproportionate share of the real-world usage signal this repo's own survey can't see.

**Bonus, not part of the 28 but checked while surveying:** `icon.tsx` (~150+ internal call sites) and `textarea.tsx` (used across several plugins and `apps/app`) — the two left undecided from the closed #4286 — are both clearly heavily used and don't belong near a zero-usage bucket either.

## Cross-check against the design-sync marketplace survey

After writing the findings above, a related, more rigorous prior survey turned up: the spec (`docs/superpowers/specs/2026-09-25-shared-ui-component-catalog-design.md`, "Scope and priority order") cites a 2026-09-16 marketplace survey that only exists on `design-sync/bb-shared-ui-pilot` (`.design-sync/NOTES.md`, fetched via `git show fork/design-sync/bb-shared-ui-pilot:.design-sync/NOTES.md`). That survey shallow-cloned all 197 marketplace plugins resolvable from `https://getbb.app/marketplace/v2/marketplace.json` at the time and tallied real `components/ui/<name>` imports (vendored via the same `packages/plugin-registry` registry mechanism found independently above), with install-count weighting from the marketplace's SSR stats payload.

It corroborates two of this addendum's external-only findings with harder numbers: **`card`** (16 plugins import `Card`, 14 `CardContent`) and **`alert-dialog`** (7 plugins). It does not name `alert`, `progress`, or `separator` in its breadth ranking — those plugins (all `vburojevic`'s) may not have existed yet on 2026-09-16, or fell below the cutoff the notes bothered to name in prose; the raw tally scripts weren't kept, so the exact number isn't recoverable. Either way, two independent surveys twelve days apart agree on `card` and `alert-dialog`, which is stronger evidence than either alone.

One separate, useful data point from the same notes: `Progress` (along with `Avatar`, `Slider`, and several `Resource*` sub-components) is on a **"renders near-blank without props"** list — a `componentSrcMap: null` rendering concern, orthogonal to usage. `Avatar` already needed pulling out of tier 5 on usage grounds; `Progress` didn't (no usage found until this addendum's own crawl caught `vburojevic/bb-plugin-xcode`), but whoever writes its story should know it needs deliberate example props, not just its bare defaults, to render as anything meaningful.

## Implication for tier 5 planning

- Tier 5 proper (zero-usage treatment) is the 17-component list above, not the original 28.
- The 12 components with real usage (7 internal, 5 external-only) need a real composed-usage story sourced from their actual call site, the same recipe tiers 1-4 used — plan them as their own tier (a "tier 4.5" catch-up) or fold them into tier 5 as its first task, rather than giving them synthetic zero-usage treatment.
- `icon` and `textarea` remain a separate open decision (carried over from #4286, not resolved here) — see the parking doc's Open Questions.
- This external-usage gap is structural, not a one-time miss: any future "is this shared-ui component actually used" survey needs to check `packages/plugin-registry` consumers (community plugins), not just `plugins/*` and `apps/app/**` in this repo, or it will keep undercounting.

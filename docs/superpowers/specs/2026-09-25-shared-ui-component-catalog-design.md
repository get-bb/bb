# shared-ui component catalog

**Status:** Draft
**Date:** 2026-09-25
**Branch:** `shared-ui-component-catalog` (fresh off `main`)

## Background

`packages/shared-ui` has 253 components. Building a bb plugin means knowing
what's available and how it's actually used — today there's no way to browse
that.

This catalog is browsable via **[Ladle](https://ladle.dev)**, a Vite-based
component-story dev tool (same category as Storybook). This repo already
runs it — `pnpm run storybook` in `apps/app` is an alias for `ladle serve`
— currently for 112 app-level components, none from `packages/shared-ui`.

Two prior efforts touched adjacent ground and are both explicitly **not**
the basis for this one. Both exist to feed
**[claude.ai/design](https://claude.ai/design)** — Anthropic's product for
AI-assisted UI design, which can build real interfaces from a synced
design system. bb's internal project for that sync is called
**"design-sync"**; the actual conversion script bundle it uses internally
is a vendored tool called **`.ds-sync`**. None of those three things
(claude.ai/design the product, "design-sync" the bb project, `.ds-sync`
the tool) are this spec's concern — flagged here only so later mentions
in this doc are unambiguous:

- [`design-sync/bb-shared-ui-pilot`](https://github.com/technicalpickles/bb/tree/design-sync/bb-shared-ui-pilot)
  (branch, on Josh's fork `technicalpickles/bb` — not on `get-bb/bb`) —
  hand-authored `.design-sync/previews/*.tsx` for 48/253 components,
  built toward syncing `@bb/shared-ui` to
  [claude.ai/design](https://claude.ai/design) with screenshot-graded
  fidelity verification.
- [`shared-ui-ladle-stories-icon-textarea`](https://github.com/technicalpickles/bb/tree/shared-ui-ladle-stories-icon-textarea)
  (branch, same fork; [PR #4286](https://github.com/get-bb/bb/pull/4286)
  opened from it against `get-bb/bb:main`) — atomic, capped-at-6,
  per-state Ladle stories for Icon and Textarea, built for the same
  design-sync grading pipeline described above.

Both were shaped by design-sync's grading requirements (per-story
screenshot comparison needs one named export per distinct visual state).
This effort drops that requirement entirely — no grading, no
claude.ai/design upload, no atomic split, no story cap — and starts over
on a clean branch, `shared-ui-component-catalog`, cut directly from
`main`. **Neither prior branch's files exist on this branch** — `.ds-sync/`,
`.design-sync/`, and their prior spec are only reachable by checking out
those other branches; they stay parked there, untouched, revisited later
if ever.

A baseline already exists independent of both branches: on `main`, 8 of 253
components (Button, Icon, Input, Pill, Tooltip, ResourceList, Switch,
EmptyState) have real story coverage already, scattered across 20
`apps/app/**/*.stories.tsx` files — mostly as supporting actors inside
composite app stories, with Button and Pill the only two having a
dedicated reference story. Select, DropdownMenu, and Dialog — the
components plugins use most after Icon/Textarea, per the usage survey
in Scope and priority order below — have zero coverage anywhere.

## Goal

A browsable Ladle catalog covering all 253 `packages/shared-ui`
components, where looking at a component's story gives a plugin author
ideas about *where and how* to use it — not just what it looks like in
isolation.

## Non-goals

- **design-sync / [claude.ai/design](https://claude.ai/design) upload** —
  not a target (see Background for what those terms mean). If it resumes
  later, it decides independently whether these stories are sufficient
  input.
- **Pixel-fidelity grading** — no compare/grade loop, no screenshot
  verification.
- **Citability / cross-doc linking** (e.g. `plugin-api-docs` — the
  in-repo "Plugin Guide" app that documents Plugin SDK surfaces —
  linking to a specific component's story) — deferred to a later phase
  once more is known about how the docs/website side works. This spec
  produces the catalog itself, browsable via Ladle's own UI; it doesn't
  design how other docs reference it.
- **Coverage or freshness enforcement beyond a build check** — see CI
  section. No automated drift detection for "this component gained a new
  real usage pattern."

## Content convention

One `Overview` story per component, rendered via `StoryCard`/`StoryRow`
(`apps/app/.ladle/story-card.tsx` — a small layout helper already used by
existing app-level stories that renders a labeled list of side-by-side
variants) when a component has more than one real pattern worth showing,
or a plain render when it has exactly one. No atomic per-state split, no
story cap — those existed solely to serve design-sync's per-story grading
(see Background) and that requirement is gone.

**The content rule that matters most: show components composed together,
the way they're actually used — not isolated.** A bare `<Icon name="Plus" />`
tells a plugin author nothing useful; `<Button><Icon name="Plus" />New
thread</Button>` shows them how the two actually combine. Concretely:

- Derive each story from a real call site — grep `plugins/*` (in-repo,
  primary source) and `apps/app/**/*.stories.tsx` (secondary source,
  already has real composed examples for ~8 components) for actual usage.
- Keep enough of the real call site's surrounding composition intact that
  the story demonstrates usage, not just the target component's own
  props. Don't strip a real usage down to the target component alone.
- **This is mandatory, not optional, for compound components**
  (Select/DropdownMenu/Dialog and similar) — they can't render
  meaningfully in isolation anyway, so "always show it composed" is also
  what makes them render at all, not just what makes them useful.
- Zero-usage components (no hits in either source) get a single
  plausible render using the component's own default/example props —
  the one case where there's no real usage to derive from.

This matches and extends the two real precedents already in the repo:
`apps/app/src/components/ui/icon.stories.tsx`'s `ExpandCollapse` story
(Icon composed inside real Button/Tooltip combos) is the good pattern;
its own `Overview` story (bare icon grid) is the pattern being moved away
from.

## Scope and priority order

All 253 components, authored once, in the order below. That order comes
from a plugin-usage survey run 2026-09-16 as part of the design-sync
effort (see Background) — for each shared-ui component, it counted how
many marketplace plugins (weighted by that plugin's install count)
actually use it, across 197 marketplace plugins plus bb's own in-repo
plugins ("install-weighted," in the numbers below). This spec inherits
only the survey's conclusions, not its design-sync-grading rationale —
the numbers are restated here so this list is self-contained. **The
survey file
(`.design-sync/NOTES.md`) only exists on
[`design-sync/bb-shared-ui-pilot`](https://github.com/technicalpickles/bb/tree/design-sync/bb-shared-ui-pilot),
not on this branch** — to see the full methodology or re-derive it,
`git show design-sync/bb-shared-ui-pilot:.design-sync/NOTES.md` (that
branch needs to be fetched from the `technicalpickles/bb` fork first if
it isn't already a local remote-tracking branch).

1. Select\* (7 components, 25% of installs), DropdownMenu\* (12, 22%),
   Dialog\* (8, 21%) — highest install-weighted reach with zero existing
   coverage.
2. Tooltip subparts (19%), Tabs\* (19%).
3. Popover\*/Command\*/ContextMenu\* (~10%).
4. Everything else with nonzero plugin usage (79/253 have in-repo usage;
   82/253 have marketplace usage).
5. Zero-usage components (`Resource*`, most `Data display`) last.

Icon and Textarea ([PR #4286](https://github.com/get-bb/bb/pull/4286))
are out of scope here — that PR's atomic stories stay as-is, undecided,
on their own branch
([`shared-ui-ladle-stories-icon-textarea`](https://github.com/technicalpickles/bb/tree/shared-ui-ladle-stories-icon-textarea)).
If this effort later wants Icon/Textarea to match the new `Overview`
convention, that's a separate follow-up, not part of this pass.

## Generation approach

Agent-driven (subagent-driven-development / fan-out), not a mechanical
script. Picking "which real call site is representative" and "how much
surrounding composition to keep" is a judgment call a script can't make:
grep `plugins/*` for real usages of the target component, read the
surrounding JSX to find the most representative real pattern, and write
a story that preserves it. That's the same process
[PR #4286](https://github.com/get-bb/bb/pull/4286) used for Icon and
Textarea, just without the atomic/cap/grading constraints that made it
heavier than it needed to be.

## Location and format

Co-located: `packages/shared-ui/src/components/ui/<name>.stories.tsx`,
title `"shared-ui/<Name>"`. Matches the existing project convention
("stories are co-located with the component," stated in
`apps/app/src/components/ui/README.md`) and the same title
namespace used by
[`docs/superpowers/specs/2026-09-24-shared-ui-ladle-stories-design.md`](https://github.com/technicalpickles/bb/blob/shared-ui-ladle-stories-icon-textarea/docs/superpowers/specs/2026-09-24-shared-ui-ladle-stories-design.md)
(on branch `shared-ui-ladle-stories-icon-textarea`, not present here) —
kept purely for naming consistency with that prior effort, not for any
technical reason tied to it.

## CI

`ladle build` must succeed for `packages/shared-ui/**/*.stories.tsx` —
compiles and renders without error. This is a build-health gate only: it
does not check coverage (a component missing a story doesn't fail CI) and
does not check freshness (a story that's drifted from current real usage
doesn't fail CI). The 2026-09-24 predecessor spec (see Location and
format above) called this same idea "sub-project 2 (CI integration)" and
deferred it as separate, independent work; this spec folds it in as a
first-class part of the design instead.

## AGENTS.md convention

Add a line to `AGENTS.md` (or the relevant UI section) instructing
contributors — human or agent — to add or update a component's story when
they add or meaningfully change how a shared-ui component is used. Same
pattern as this repo's existing "when renaming a domain concept, search
project-wide for stale names" convention: a policy that relies on whoever
touches the code noticing, not automated drift detection.

## Open risks

- **Judgment-heavy at scale.** 253 components each need a real-usage grep
  and a judgment call about what to keep — this is real authoring effort,
  just without the atomic/grading overhead. Not time-boxed yet.
- **AGENTS.md convention has no enforcement.** Unlike the CI build gate,
  the "update the story" guidance can be silently ignored; if that proves
  to be a problem in practice, freshness enforcement (deferred as a
  non-goal above) may need revisiting.
- **Citability deferred** means `plugin-api-docs` and similar can't yet
  cite a specific component's story from outside Ladle. Acceptable for
  now per explicit scope decision above.

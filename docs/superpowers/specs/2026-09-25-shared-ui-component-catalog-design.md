# shared-ui component catalog

**Status:** Draft
**Date:** 2026-09-25
**Branch:** `shared-ui-component-catalog` (fresh off `main`)

## Background

`packages/shared-ui` has 253 components. Building a bb plugin means knowing
what's available and how it's actually used — today there's no way to browse
that. Two prior efforts touched adjacent ground and are both explicitly
**not** the basis for this one:

- `design-sync/bb-shared-ui-pilot` — hand-authored `.design-sync/previews/*.tsx`
  for 48/253 components, built toward syncing `@bb/shared-ui` to
  claude.ai/design with screenshot-graded fidelity verification.
- `shared-ui-ladle-stories-icon-textarea` (PR #4286) — atomic, capped-at-6,
  per-state Ladle stories for Icon and Textarea, built for the same
  design-sync grading pipeline.

Both were shaped by design-sync's grading requirements (per-story
screenshot comparison needs one named export per distinct visual state).
This effort drops that requirement entirely — no grading, no design-sync
upload, no atomic split, no story cap — and starts over on a clean branch.
Both prior branches stay parked, untouched, revisited later if ever.

A baseline already exists independent of both branches: on `main`, 8 of 253
components (Button, Icon, Input, Pill, Tooltip, ResourceList, Switch,
EmptyState) have real story coverage already, scattered across 20
`apps/app/**/*.stories.tsx` files — mostly as supporting actors inside
composite app stories, with Button and Pill the only two having a
dedicated reference story. Select, DropdownMenu, and Dialog — the
highest install-weighted components after Icon/Textarea — have zero
coverage anywhere.

## Goal

A browsable Ladle catalog covering all 253 `packages/shared-ui`
components, where looking at a component's story gives a plugin author
ideas about *where and how* to use it — not just what it looks like in
isolation.

## Non-goals

- **design-sync / claude.ai upload** — not a target. If it resumes later,
  it decides independently whether these stories are sufficient input.
- **Pixel-fidelity grading** — no compare/grade loop, no screenshot
  verification.
- **Citability / cross-doc linking** (e.g. `plugin-api-docs` linking to a
  specific component's story) — deferred to a later phase once more is
  known about how the docs/website side works. This spec produces the
  catalog itself, browsable via Ladle's own UI; it doesn't design how
  other docs reference it.
- **Coverage or freshness enforcement beyond a build check** — see CI
  section. No automated drift detection for "this component gained a new
  real usage pattern."

## Content convention

One `Overview` story per component, rendered via `StoryCard`/`StoryRow`
(`apps/app/.ladle/story-card.tsx`) when a component has more than one
real pattern worth showing, or a plain render when it has exactly one.
No atomic per-state split, no story cap — those existed solely to serve
design-sync's per-story grading and that requirement is gone.

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

All 253 components, authored once. Priority order reuses the existing
install-weighted plugin-usage survey
(`.design-sync/NOTES.md` on `design-sync/bb-shared-ui-pilot`,
2026-09-16, 197 marketplace plugins + in-repo plugins) — this ordering
logic is independent of the grading rationale that's been dropped:

1. Select\* (7 components, 25% of installs), DropdownMenu\* (12, 22%),
   Dialog\* (8, 21%) — highest install-weighted reach with zero existing
   coverage.
2. Tooltip subparts (19%), Tabs\* (19%).
3. Popover\*/Command\*/ContextMenu\* (~10%).
4. Everything else with nonzero plugin usage (79/253 have in-repo usage;
   82/253 have marketplace usage).
5. Zero-usage components (`Resource*`, most `Data display`) last.

Icon and Textarea (PR #4286) are out of scope here — that PR's atomic
stories stay as-is, undecided, on their own branch. If this effort later
wants Icon/Textarea to match the new `Overview` convention, that's a
separate follow-up, not part of this pass.

## Generation approach

Agent-driven (subagent-driven-development / fan-out), not a mechanical
script. Picking "which real call site is representative" and "how much
surrounding composition to keep" is a judgment call a script can't make —
the same grep-and-read process PR #4286 used for Icon/Textarea, applied
without the atomic/cap/grading constraints that made it heavier than it
needed to be.

## Location and format

Co-located: `packages/shared-ui/src/components/ui/<name>.stories.tsx`,
title `"shared-ui/<Name>"`. Matches the existing project convention
("stories are co-located with the component") and the title namespace
choice from the prior spec (kept for consistency, not because
`.ds-sync`'s title-collision handling matters here anymore — it doesn't).

## CI

`ladle build` must succeed for `packages/shared-ui/**/*.stories.tsx` —
compiles and renders without error. This is a build-health gate only: it
does not check coverage (a component missing a story doesn't fail CI) and
does not check freshness (a story that's drifted from current real usage
doesn't fail CI). Matches what the prior spec called "sub-project 2 (CI
integration)," now folded into this effort instead of deferred.

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

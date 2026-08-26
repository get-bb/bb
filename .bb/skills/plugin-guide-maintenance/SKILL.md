---
name: plugin-guide-maintenance
description: Keep the Plugin Guide synchronized with public @get-bb/plugin-sdk APIs and the live bb surfaces that host them. Use whenever adding, changing, stabilizing, renaming, or removing a public Plugin SDK export, BbPluginApi member, app slot, composer API, provider bridge API, host API, or testing API; when adding or auditing a Guide surface/card/fixture; when correcting fixture fidelity, annotation placement, interaction realism, or responsive layout; or when the Plugin Guide API inventory or UI-anatomy tests fail.
---

# Maintain the Plugin Guide

The Plugin Guide is bb's only public Plugin SDK documentation. Update it in
the same change as every public API delta and every source-UI change that makes
an existing Guide representation inaccurate. Do not refresh only the SDK
inventory or redraw from memory.

## Terminology and ownership

Call the Guide representation a **surface fixture**: a deterministic,
interactive documentation state derived from the real bb surface. “Skeleton”
means a loading placeholder in bb, and “wireframe” implies a provisional
design. `packages/plugin-api-map/src/wireframes.tsx` keeps its legacy filename
and component names, but new copy, comments, tests, and reports use “surface
fixture.”

The real app owns structure, placement, states, labels, roles, ordering, and
product styling. The Guide owns realistic example content, annotation badges,
highlight rings, and replay controls. Guide-owned layers may clarify the
surface but cannot move, restyle, or invent host behavior.

## 1. Establish the authoritative source

For an SDK delta, build the portable declarations and inspect the changed
source contracts:

```sh
pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk
git diff -- packages/plugin-sdk/package.json packages/plugin-sdk/src
```

For every visual surface, trace all three owners before authoring the fixture:

1. the app component that paints the host surface;
2. the slot/collector or adapter that inserts the plugin contribution;
3. the closest focused app test or story that establishes its real states.

Record repo-relative source paths and stable source anchors in
`packages/plugin-api-map/src/anatomy-manifest.json`. Prefer accessible labels,
roles, data attributes, shared class constants, and state names as anchors;
avoid line numbers and generated bundles. The app-side
`docs-anatomy-manifest.test.tsx` makes stale anchors fail instead of silently
leaving the Guide behind.

For a new public member, also enforce the repository contract:

- name it with `experimental_` (or `Experimental` for a type);
- add its audit entry to `docs/api_to_audit.md`;
- preserve compatibility with released SDK consumers unless the user has
  explicitly approved the exact break and migration.

## 2. Generate the deterministic entry scaffold

Run the scaffold command with observable behavior, not a preferred visual
style. Repeat `--source` and `--api-symbol` as needed:

```sh
pnpm exec turbo run scaffold:surface-entry --filter=@bb/plugin-api-map -- \
  --id command-palette-actions \
  --title "Command palette actions" \
  --group command-palette \
  --source apps/app/src/components/commands/CommandPalette.tsx \
  --source apps/app/src/lib/command-palette/palette-plugin-actions.ts \
  --source apps/app/src/components/commands/CommandPalette.test.tsx \
  --api-symbol PluginCommandPaletteActionRegistration \
  --api-symbol PluginCommandPaletteActionContext \
  --transient \
  --outcome
```

The command is read-only and prints a stable JSON scaffold. Argument order,
duplicate source paths, and duplicate symbols cannot change the result. Use
the scaffold to start the card and fixture contract; replace every `TODO`
with observed product behavior before considering the entry complete.

### Deterministic fidelity level

Derive fidelity; do not choose it. The generator computes the minimum honest
level from spatial ownership and observable behavior. The highest applicable
rule wins:

| Level    | Deterministic rule                                                                                                              | Fixture obligation                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `none`   | The capability has no meaningful spatial owner (`--no-spatial-owner`).                                                          | No pixels or marker; document it in the Plugin backend group.                                                              |
| `anchor` | It is visible in a stable default state and has no visible outcome.                                                             | Show the exact insertion point, owning host chrome, and nearest adjacent controls.                                         |
| `state`  | It exists only after hover, focus, selection, a menu/dialog, loading, empty, error, or another transient state (`--transient`). | Include `anchor`, then show the real trigger and one reachable canonical state.                                            |
| `flow`   | Activation changes host state/navigation (`--outcome`) or replaces host-rendered content (`--replacement`).                     | Include `state`, then make activation reach the visible plugin outcome; show fallback/original ownership for replacements. |

This is a floor, not a score. Do not lower fidelity to save space. If several
surfaces share one page, the page must support each surface's required state;
use focused nested states rather than an impossible composite where mutually
exclusive menus or selections appear together.

Every visual level also requires:

- exact user-facing labels, accessible roles, item order, selected/pressed
  semantics, and product token classes from the source;
- realistic safe content at the source surface's normal density;
- responsive geometry that preserves the source's ownership boundaries;
- working visible controls whose state matches their outcome;
- Guide annotations in a separate top layer that does not obscure targets.

### Surface-fixture composition contract

Start with the closest real product surface, then preserve its ownership,
scale, density, and object identity. A fixture teaches where a plugin enters
bb; it should be recognizable without the annotation card explaining the
scene.

Use this page audit as the minimum credible anatomy:

| Guide page or fixture                           | Required representation                                                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The bb app window                               | Keep the sidebar, thread, timeline, composer boundary, and side panel at readable product proportions. Loaded content and its loading skeleton must use aligned height and vertical spacing.          |
| Command palette or another whole-window overlay | Give a different owning host surface its own dedicated page. Show the trigger or shortcut, dimmed host context, realistic neighboring results, the selected plugin result, and its reachable outcome. |
| Composer                                        | Seat it in the thread or home chrome that owns it. Show menus in their source placement direction and show hover, selection, or locking only in the state that triggers it.                           |
| File viewer or editor                           | Preserve the canonical product object: use a real file path, file icon, and filename in the tab, then render the plugin's custom viewer or editor in its body.                                        |
| Code or diff renderer                           | Put the entry point on the real Diff tab and show a credible filename, hunk header, line numbers, context, additions, and removals rather than generic placeholder bars.                              |
| Home, Settings, or Extensions                   | Preserve the source page chrome, section order, and the exact position where bb inserts the plugin-owned content.                                                                                     |
| Plugin backend                                  | Render a reflowing capability grid with no numbered marker. Do not invent pixels for a headless API.                                                                                                  |

“Renders no UI of its own” is not sufficient to choose `none`. When a
capability has a visible host scope—an app-wide script runs across the bb
window, for example—use `anchor` and annotate the owning host boundary without
inventing a plugin control. Reserve `none` for capabilities with no meaningful
spatial owner to teach.

Draw partial ownership precisely. When bb keeps a host-owned wrapper or header
and the plugin supplies only the body beneath it, retain the host chrome and
annotate only the plugin-owned region. For a true replacement, show the
replaced boundary and preserve any fallback or original ownership required by
the API.

Derive responsive behavior from fixture ownership; do not choose it per page.
Every spatial fixture scales as one annotated composition. ProductMap measures
the fixture's authored `scrollWidth`/`scrollHeight` and the consumer's
declared scroll viewport (`data-guide-stage-viewport`), and applies exactly
`min(MAX_FIXTURE_SCALE, availW / authoredW, availH / authoredH)` to the host
anatomy, exterior chips, engaged rings, and menus together — shrinking under
pressure and growing toward the legibility cap when the panel has room. The
non-spatial capability grid is the only reflowing fixture. Never scale the
annotation card or let an individual fixture choose a different responsive
mode. Each fixture's width band lives in ProductMap's one
`FIXTURE_WIDTH_BANDS` table, applied to the measured element itself — a band
on a nested wrapper is invisible to the measurement, because a block's
`scrollWidth` can never be smaller than its own `clientWidth`.

An open in-flow card is part of the height budget: its footprint subtracts
from the fixture's available height so the card ends where its content ends
without scrolling the page chrome. The reserve exists only while a card is
open: the landing view renders at its full derived size, opening a card
glides the fixture down once to the size that fits the slide's tallest card
— pre-measured by a hidden probe that renders every card the slide can open,
so Previous/Next through shorter and taller cards never re-scales — and
closing glides it back up. The live ratchet is a probe-less backstop and
resets when the card leaves the flow. Sizing the reserve from each card
individually re-scales the fixture per card, and keeping the reserve after
close strands card-sized whitespace under every closed page.

Every re-budget is one center-outward gesture. The fixture scales from a
top-center origin around a static centering offset that depends only on the
frame and authored widths — never on the scale — so a card opening or
closing animates exactly two properties, the frame height and the fixture
transform, on the same 300ms ease. Animating a scale-dependent horizontal
offset alongside a corner transform origin reads as stepped diagonal motion
(down, right, back left) instead of one gesture.

The scaled fixture reserves exactly `authoredHeight * scale` in normal flow,
whether shrunken or grown. It must have no horizontal scrollbar, clipped
content, or page-level inline overflow at any width; require
`scrollWidth <= clientWidth + 1` on its outer frame after settling.
Off-stage carousel pages must not contribute inline overflow to the Guide
page. Clip the carousel's inline axis while leaving its block axis available
to real menus that escape downward.

The page selector is the sole narrow-width horizontal scroll owner. Its
carets hug the label strip: the caret+labels group shrink-wraps and centers
as one unit, and the carets only reach the row's edges when the labels
genuinely overflow. Horizontally reveal the active label after arrow, click,
or linked navigation. Every horizontal scroller uses the shared chip-bar
treatment from `scroll-edges.ts`: hidden native scrollbar plus an edge fade
on whichever side has overflow, so cut entries read as scrollable rather than
torn.

The carousel item owns the available width and must be shrinkable before a
spatial fixture measures itself. Put `min-width: 0` on that item; never let an
authored fixture minimum inflate the measurement frame and turn a narrow pane
into a false `scale=1` result.

Each fixture declares one authored geometry — a single minimum height and one
width band (a floor and a natural cap) with one owner, fluid between them and
scaled beyond either so every fixture can use the upscale path — and never encodes the app
chrome around it (no `100dvh` arithmetic). Vertical fit at every panel size
is the scale formula's job: the desktop app-window fixture and every open
annotation card stay reachable in the 980px-tall plugin content region left by
a 2048 by 1080 bb window, with shorter viewports scrolling vertically and
taller ones growing the fixture toward the cap. Preserve product-control
density; blank canvas bounds are minimums, not fixed heights, and real content
may grow beyond them without being clipped.

Never reflow a spatial fixture into anatomy bb does not have, scale any part of
it independently, or add blank canvas to match the tallest page.
The active carousel stage follows the active fixture's height; off-stage pages
are inert and clipped without clipping a live menu that legitimately escapes
the active fixture.

Fixtures use deterministic, safe example content. Isolate them from installed
plugin customizations so a reader's local plugins cannot add controls, rewrite
copy, or move annotations. If the Guide embeds a real host component, make it
inert when interacting with it would open unrelated host UI over the lesson.

### Annotation placement decision table

Annotations are Guide-owned reading controls placed beside the host UI. Treat
their placement and behavior as a deterministic contract rather than a final
pixel nudge:

| Target shape                                                | Placement rule                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable internal region                                      | Put the badge beside an outside corner of the target, clear of its icon, label, selection, and hit area.                                    |
| Target on a fixture's outer edge                            | Put the badge in an exterior Guide-owned gutter inside the same scale-together wrapper, not inside the host region.                         |
| Tab or action on a clipped top edge                         | Put the badge above the actual tab or action in a top-layer sibling. Do not make the product row taller or add host padding to create room. |
| Target inside a scroll container, menu, palette, or popover | Put the badge outside the clipping subtree, then align it back to the target from the Guide layer. `z-index` alone cannot escape clipping.  |
| Target nested inside another annotated region               | Keep the target region and its badge as sibling overlays. Never nest interactive annotation anchors.                                        |

### Annotation quality contract

- Attach each badge to the actual entry point a plugin author would use. A tab
  surface is annotated on its real tab, a message action on its real action,
  and a composer contribution on its real control or content. Selecting the
  annotation reveals that entry point's corresponding state or tab body.
- Annotation space is Guide-owned and must not change the host surface's geometry,
  including its width, padding, row alignment, or item density. A chip's
  position is never an authored coordinate: an in-target chip declares one of
  the shared placement variants (`corner`, `corner-inset`, `side`,
  `outside-above`), and a chip that cannot live inside its target's clipping
  subtree is a measured badge (`start`/`end` gutter columns, `above`, or the
  `lane` above the frame) that derives its place from the element it
  annotates. The badge must stay fully visible inside the fixture and
  viewport, clear of every clipping ancestor. A high `z-index` prevents
  occlusion only after the badge escapes clipping; it cannot repair geometry
  that leaves the badge inside a scroll container or puts half of it beyond a
  clipped boundary.
- Every Guide interactive — annotation anchors, measured badges, pan carets,
  page buttons, platform cards — takes keyboard focus through the one shared
  `FOCUS_RING_CLASS` owner (the product ring token), never the browser
  default outline or a per-site style.
- Keep the badge clear of the entry point's icon, label, selection, and hit
  target. Keep every transient menu, palette, popover, or toolbar clear of both
  its annotation and annotated target, and anchor a transient to the element
  the real product flips it against — never to an authored offset. A chip the
  open transient would cover hides while it is open (the tour-platform
  convention); if a placement collides outside a transient, change the
  declared variant rather than adding a bespoke coordinate.
- Keep annotations on each page sequential by annotation number. Previous and
  next controls use that page order, including first and last disabled states,
  so readers never have to hunt across the fixture.
- Derive that sequence from the host's visual scan order: owning regions from
  left to right, then controls within a region from top to bottom. In a panel
  tab row, preserve fixed host tabs before scrollable content tabs. Put a
  whole-window boundary last in an exterior end or bottom gutter; do not place
  its final number above an earlier interior target.
- Keep the badge/card and demonstrated action as separate interaction targets.
  Clicking a badge opens or pans the Guide card without running the product
  action; clicking the host action changes only the reachable fixture state.
- When annotated regions overlap or contain one another, show one active
  annotation outline at a time. The selected badge may stay lit, but hovering
  a nested target must not leave the parent ring active underneath it.
- Show only states that a user can actually reach. Hover, selection, menu, tab,
  and outcome states may replace one another; do not display mutually
  exclusive states as a convenient composite.

Run the committed relationship sweep after any fixture, annotation, or layout
change: `scripts/verify-guide-chrome.mjs` (in this skill's directory) drives
Chrome for Testing against the running dev app across the four viewport
classes, discovers every rendered annotation, reconciles it against the
declared inventory, and asserts the relationships above — badge bounds and
hit-tests, engaged rings on targets, transient clearances, caret adjacency,
scale bounds with zero page overflow, the gap clamp, and the wide-viewport
fill gate. Extend the sweep when a rule is added; never replace a sweep
assertion with an exact authored pixel.

Verify these rules at every required viewport with rendered geometry, not
class names alone. Record the badge, target-content, transient-surface,
fixture, and viewport bounding rectangles. The badge rectangle must be fully
contained, the badge and target-content rectangles must not intersect, and a
visible transient surface must intersect neither. Use at least 4 CSS pixels of
clearance between adjacent rectangles in the fixture's authored CSS coordinate
space (divide rendered distances by the uniform fixture scale), then inspect
the screenshot because a
border, shadow, or rounded edge can still visually cut through a technically
non-intersecting box. Hit-test the badge center with `elementFromPoint`; it must
resolve to the badge or one of its descendants, proving the badge is actually
in the top visual layer rather than merely having an unclipped rectangle.

### Interaction and state contract

- Make every visible control behaviorally honest: clicking it changes the
  fixture to the state its pressed, selected, or active styling promises.
- A transient contribution starts from its real trigger. Reveal a message
  action row on message hover, a selection toolbar only after activation, and
  a menu only while its owning annotation or trigger is engaged.
- Reserve its footprint when a hover-only row appears so messages, timeline
  entries, and controls below it do not reflow under the pointer.
- Place menus and typeaheads in the source placement direction and keep them
  clear of both badges and targets. Move the Guide annotation layer before
  changing the host menu's dimensions, alignment, or padding.
- Use a visually distinct selection for source state such as selected message
  text. It must remain distinguishable from the annotation highlight and from
  the menu's selected row.
- When an annotation represents a tab, selecting it also selects that tab and
  changes the tab body. Card Previous/Next navigation must produce the same
  synchronized fixture state as clicking the badge directly.
- For a `flow` fixture, demonstrate the complete causal chain: entry point,
  trigger, selected or open state, action, and visible plugin outcome. Keep
  mutually exclusive states separate instead of composing a convenient fake.

### Page, card, and reference contract

- Give a surface a dedicated page when it belongs to a different owning host
  surface, overlay, or user job. Do not hide a command palette, file tab, or
  side-panel capability inside a nearby but inaccurate fixture.
- Keep page tabs and annotations in authored numeric order. Page tabs are one
  horizontally scrolling, non-wrapping row; fixtures never inherit that
  overflow. Render both page-panning arrows outside the scroller so navigation
  geometry stays stable; disable the missing direction at the first and last
  pages rather than removing its control.
- Open the annotation card in normal flow below the fixture so it never covers
  the entry point. Panning pages closes the old card; following a cross-page
  reference pans and opens the destination card in the same commit, so the
  pan, the destination's re-budget, and the card's arrival ride one 300ms
  gesture instead of a pan-then-open two-step.
- A fixture demo may hide its page's subject (the command palette, the
  composer) only as a timed beat that restores itself; it must never latch
  the subject away behind a manual reopen control.
- Numbered chips are Guide chrome, not product chrome: they stay legible
  while the fixture shrinks under them, because a chip the reader cannot read
  or click cannot do its job. The fixture publishes a counter-scale
  (`annotationChipCounterScale`) that chips undo the shrink with, bounded by
  `MAX_CHIP_COUNTER_SCALE` so a thumbnail-scale fixture is not blanketed by
  its own annotations. Measure every chip gap, tuck, and clamp against the
  chip's effective footprint, never its authored one. The annotation gutter is
  authored for a chip at its own size, so a counter-scaled chip can outgrow
  it: a measured chip clamps into its slide and rides the frame edge rather
  than leaving the slide to be clipped away.
- Use one Guide-owned gap between a fixture and its card: the card wrapper
  owns `clamp(8px, 3cqh, 28px)`, derived from the consumer's declared
  container and floored at 8 CSS pixels without one. The active carousel slide
  and the fixture itself add no block-end spacing, so stacked padding cannot
  manufacture page overflow.
- Keep Previous and Next annotation controls compact in the card header. Both
  remain visible, navigate the current page's numeric order, and expose a
  disabled endpoint rather than wrapping to another page.
- For every new or touched card, the title names the visible product object or outcome,
  not the SDK mechanism that implements it. The lead starts with an active verb,
  names the visible location or result, and stands alone before the capability
  list. Do not explain a current surface through an absent or hypothetical
  object (for example, “a thread that does not exist yet”), and do not use
  `renderer`, `registration`, `slot`, `normalized`, or `declarative` unless that
  word is visible in bb's own UI.
- Author every card as one complete lead ending in
  `. With this, a plugin can:`, followed by at least two bare verb-phrase
  bullets. Keep tutorials in the authoring skill or SDK guidance, not cards.
- Derive **Copy for agent** from the canonical `PluginSurface` record through
  `createPluginSurfaceAgentReference`; do not author any clipboard or context
  field separately. The provider is exactly `surface`, the reference id is
  exactly `surface.id`, the label is exactly `surface.title`, the plugin id is
  exactly `plugin-api-docs`, and the item id is exactly
  `surface:<surface.id>`. The framing is exactly `Build a plugin that uses `
  before the pill and one plain space after it — never added punctuation, so
  pasted output carries exactly the source content's own punctuation. The
  pill's send-time context already
  points at the Plugin Guide and authoring skill, so visible clipboard prose
  never repeats that implementation pointer.
- Resolve exactly three context lines: surface title plus id; the surface's
  `apiSymbols`; then a pointer to the `bb-plugin-authoring` skill and the
  authoritative `@get-bb/plugin-sdk` declarations. Do not include card
  summaries, bullets, tutorials, timestamps, random ids, or current fixture
  state. Equal canonical surface data must produce byte-identical clipboard
  and context output.
- Keep each pasted reference as its own mention node and preserve paste order.
  Distinct surface ids produce distinct item ids; never merge or deduplicate
  several pills into one prose blob. This keeps multiple references distinct
  and composable in one agent request.

## 3. Complete the Plugin Guide entry

Edit `packages/plugin-api-map/src/surfaces.ts`.

- Put the API on the existing card that represents where or why authors use
  it. Create a card only for a genuinely new product surface.
- Keep the generated `id` stable. Surface ids persist in “Copy for agent”
  references; never rename or reuse one casually.
- Add exact exported names to `apiSymbols`.
- Replace scaffold copy with one concise capability lead and observable
  capability bullets. Link related surfaces instead of repeating tutorials.
- Add `firstParty` only for maintained in-repo plugins that exercise the API.

For a visual entry, implement the fixture in the legacy
`packages/plugin-api-map/src/wireframes.tsx` module at the generated fidelity
level. Add its marker to the matching `*_MARKS` array and its source/fidelity
contract to `anatomy-manifest.json`. Render repeated ordered anatomy from that
manifest. For a backend-only entry, place it in the Plugin backend group and
do not invent a fixture.

Add focused coverage for:

- surface/card/marker coverage and stable ordering;
- every state required by the fidelity level;
- the real source anchors and the fixture's matching structure, naming, and
  style anchors;
- the actual trigger and outcome for `state` and `flow` fixtures;
- the annotation quality contract, including target ownership, stable page
  order, separate badge/action behavior, and browser bounding-rectangle gates.

## 4. Refresh the exhaustive SDK inventory

Only after the Guide represents the contract delta, update the canonical
comment-free declaration hashes:

```sh
pnpm exec turbo run update:sdk-inventory --filter=@bb/plugin-api-map
```

Review `packages/plugin-api-map/sdk-public-api.json`. A new package export must
appear as a new key; a changed hash must correspond to the documented contract
delta. Do not hand-edit hashes. Skip this step when no public SDK declaration
changed.

## 5. Verify the complete workflow

```sh
pnpm exec turbo run test typecheck \
  --filter=@get-bb/plugin-sdk \
  --filter=@bb/plugin-api-map \
  --filter=@bb/app \
  --filter=bb-plugin-plugin-api-docs
bb plugin build plugins/plugin-api-docs
```

For user-visible fixture/card changes, launch the exact branch web app with
`scripts/bb-dev-app current`. Verify the affected page from first paint through
every required state, the annotation card, **Copy for agent**, and composer
paste. Exercise Chrome for Testing and real Safari, then stop QA-only launchers.
Use the desktop dev app only when the source behavior depends on Electron or
native window chrome. Preserve every annotation-placement correction made in
the task as a named visual checkpoint and reread the complete page screenshot;
a close crop can hide the clipping or overlap the check is meant to catch.

The CI packages shard runs `@bb/plugin-api-map#test`; the app shard runs the
source-anchor/anatomy test. Together they fail when the SDK inventory, live
surface contract, generated scaffold rules, or Guide fixture drifts.

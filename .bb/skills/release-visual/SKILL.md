---
name: release-visual
description: "Draw the small release visual for a new bb release and register it in release metadata, so the sidebar What's new card and Settings → Updates show it. Use when preparing release notes or when a release in RELEASE_META has no visual."
---

# Draw a release visual

Each release in `RELEASE_META` (`packages/domain/src/changelog-metadata.ts`)
names one drawing in `visual`. The What's new plugin's sidebar card and its
Settings → Updates section show it at 40px. Drawings live in the plugin, in
`plugins/whats-new/release-visuals.tsx`, and are composed from the parts in
`plugins/whats-new/release-art-kit.tsx`. CI fails when the newest changelog
release has no visual, a visual id has no drawing, or a drawing is unused
(`apps/app/src/lib/release-visual-coverage.test.ts`).

## Steps

1. **Read the release.** Take the headline from `RELEASE_META` and the lede and
   first highlights from the version's section in `CHANGELOG.md`.
2. **Pick one idea.** Depict the headline's lead feature, not the whole list.
   Prefer a concrete product object (window, phone, thread, panel, card) over an
   abstract symbol, and make it distinct from the other drawings in the sheet.
3. **Add the id.** Add a kebab-case id to `ReleaseVisualId` in
   `changelog-metadata.ts`, and set `visual` on the release's entry.
4. **Draw it.** Add the entry under the same id to `RELEASE_VISUALS` in
   `plugins/whats-new/release-visuals.tsx`, with a `tone` and a `draw` function
   built from kit parts. Follow the style rules below.
5. **Check it in Ladle.** Open `plugins/What's new/Release visuals` and check
   the drawing at both sizes in light and dark, next to the existing ones. Also
   look at `plugins/What's new` → Sidebar card.
6. **Ship it in the release PR** with the CHANGELOG and `RELEASE_META` changes.
   Let CI run the tests.

## Style rules

These are the canonical rules. They match the Tips plugin's diagram kit.

- **Grid.** 48-unit viewBox. Keep a 3-unit margin.
- **Line.** Use `LINE`: `currentColor`, 1.1 stroke, round caps and joins.
  Fills use `WASH` (0.1); secondary lines use `soft` (0.4 opacity).
- **Color.** Ink tones only, from `currentColor` and `CANVAS`. Use exactly one
  small accent, from the `accent` argument, colored by the entry's `tone`
  (`blue`, `green`, `amber`, or `orange`). Never write literal colors.
- **Surface.** No background chip or frame around the drawing. It sits directly
  on the card or section.
- **Static.** No animation. The drawing must read at 40px, so skip details
  under about 1.5 units.
- **Parts.** Reuse kit parts. Add a part to `release-art-kit.tsx` only when two
  drawings need it. Keep one-off shapes inside the drawing as `path`s with
  `LINE`.

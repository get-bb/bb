# shared-ui Ladle story conventions + priority list

**Status:** Draft
**Date:** 2026-09-24
**Sub-project:** 1 of 3 (see Related Work)

## Background

bb's design-sync effort (syncing `@bb/shared-ui` to claude.ai/design, tracked in
`.design-sync/NOTES.md`) currently hand-authors a `preview.tsx` per component in
`.design-sync/previews/` — 48/253 components done as of batch 3. That approach
works but doesn't scale well and isn't independently verifiable: each preview is
authored once, by hand, with no ground truth to check it against.

`.ds-sync` (the vendored design-sync converter) has a second, higher-fidelity
mode — the `storybook` shape — that compiles real story files and
screenshot-verifies each preview against them. bb doesn't have Storybook, but
it has Ladle (`apps/app/.ladle/`, `pnpm run storybook` = `ladle serve`), which
reads the same CSF story format. Investigation (this session, 2026-09-24)
confirmed:

- Ladle's `@ladle/react/meta` API gives exact per-story `filePath` +
  `namedExport` pairing with zero bundling — cleaner input than what
  `source-storybook.mjs` has to reconstruct from Storybook's `index.json` via
  guess-matching.
- A real `ladle build` against a co-located `packages/shared-ui/src/components/ui/<name>.stories.tsx`
  story succeeds end to end (proven with a throwaway Button story).
- `.ds-sync`'s preview compiler (`compose()` in `preview-gen-storybook.mjs`)
  calls each story as `fn(args, ctx)` — Storybook CSF calling convention —
  which happens to be call-compatible with Ladle's own args mechanism (a
  story is `React.FC<P>` with a static `.args` property). No adapter changes
  needed to support either authoring pattern below.
- Ladle is actively used and growing on `origin/main` (112 `.stories.tsx`
  files vs. 11 on this branch) but entirely for app-domain composites
  (thread timeline, dialogs, pickers) — zero coverage of `packages/shared-ui`
  itself, and it has never been wired into CI.

## Goal

Define the conventions for authoring real Ladle (CSF) stories for
`packages/shared-ui` components, and the priority order to author them in —
so that sub-project 3 (forking `.ds-sync` to read Ladle) has real stories to
prove itself against, and the resulting design-sync previews are verifiably
correct rather than hand-authored guesses.

## Non-goals (separate sub-projects)

- **CI integration for Ladle** (`ladle build` as a CI check) — independent,
  cheap, valuable on its own; not blocked by or blocking this work.
- **Forking `.ds-sync` to read Ladle** (`source-ladle.mjs`,
  `bundlePreviewDecorators` equivalent) — depends on this sub-project having
  produced real stories to test against, but is scoped separately.

## Story location & format

- Co-located: `packages/shared-ui/src/components/ui/<name>.stories.tsx`,
  next to the component it documents — matches the existing project
  convention ("stories are co-located with the component",
  `apps/app/src/components/ui/README.md`) and was proven working directly
  (a real `ladle build` succeeded against a story placed here, resolved via a
  relative glob from `apps/app/.ladle/config.mjs`).
- Atomic CSF: **one named export = one distinct visual state.** This departs
  from the existing app-level convention (one `Overview` story per component,
  rendering every variant in a grid via `StoryCard`/`StoryRow`) — the
  atomic form is what `.ds-sync`'s `compare.mjs` screenshots and grades
  per-story.
- Cap at **~6 stories per component**, matching `compare.mjs`'s default
  capture cap (`--max-stories` exists to raise it later if a component's
  tail stories carry distinct variants worth verifying). Pick the most
  representative real-world states, not an exhaustive prop matrix.

## Title / grouping convention

New stories use the title `"shared-ui/<Name>"`, not the existing app-level
`"ui/<Name>"`. Several components (Button, Pill) already have an app-level
`ui/<Name>` story; sharing a title across two files risks the same
multi-source-of-truth ambiguity `.ds-sync`'s own adapter already has special
handling for (`isOwn` in `source-storybook.mjs`, "own-package stories win the
name"). Separate namespaces avoid needing that handling at all here.

## Authoring pattern: args-based vs. hand-JSX

Two valid CSF patterns, chosen mechanically per component rather than by
per-file judgment call:

**Args-based** (`Story<P>` + a static `.args` property) — for components
whose variation is pure props, no structural difference between stories:

```tsx
import type { Story, StoryDefault } from "@ladle/react";
import { Button, type ButtonProps } from "./button";

export default { title: "shared-ui/Button" } satisfies StoryDefault<ButtonProps>;

export const Default: Story<ButtonProps> = (props) => <Button {...props} />;
Default.args = { children: "Save changes" };

export const Destructive: Story<ButtonProps> = (props) => <Button {...props} />;
Destructive.args = { variant: "destructive", children: "Delete project" };
```

**Hand-JSX** — for components whose variation is structural/compositional
(different children, different nesting), where args can't express the
difference:

```tsx
export const WithForm = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader><DialogTitle>Edit project</DialogTitle></DialogHeader>
      <form>...</form>
    </DialogContent>
  </Dialog>
);
```

**Mechanical selection rule:** does the component's own `.tsx` import `cva`
/ `VariantProps` (a class-variance-authority-driven variant API)? If yes →
args-based. If no (Radix compound components, `Resource*` domain
composites) → hand-JSX. This is grep-able per component
(`grep -l "cva\|VariantProps" <component>.tsx`) rather than a per-file
judgment call — deliberate, since this effort produces many files and a
mechanical rule is more reliable at that scale than per-component taste.

Both patterns are already compatible with `.ds-sync`'s existing preview
compiler with no adapter changes (see Background) — this is purely an
authoring-ergonomics choice, not a compatibility one.

Controls/`argTypes` authoring is explicitly **out of scope** — design-sync's
compiled previews render standalone with no Ladle UI chrome, so an
interactive Controls panel has no consumer here. Revisit if Ladle becomes a
first-class dev tool for shared-ui.

## Determinism

No `Date.now()`, `Math.random()`, live timers, or real network calls in
story render paths. This isn't new policy — `apps/app/src/components/ui/README.md`
already states it for existing stories — but it's a hard requirement here
specifically because `.ds-sync`'s compare loop screenshots with a frozen
clock; a nondeterministic story produces grading noise the tooling can't
resolve on its own (flagged in `.ds-sync/storybook/SKILL.md` §4's
"story renders differently every capture" row).

## Derivation methodology

Story variants are derived from **real plugin usage**, not a generic
prop-matrix sweep:

1. Grep `plugins/*` (in-repo) and the ~150 marketplace-plugin clones from the
   2026-09-16 plugin-usage survey (`.design-sync/NOTES.md`) for actual
   invocations of the component.
2. Extract the distinct real prop/composition combinations found.
3. Write one story per distinct real pattern, capped at ~6 — picking the
   most common/representative if more than 6 distinct patterns exist.

For the ~48 components with an existing hand-authored
`.design-sync/previews/*.tsx` (batches 1–3 of the current pilot), that JSX is
a useful starting point — it's already real composition-matching code — but
gets checked against the actual plugin grep rather than assumed correct,
since those previews were written to satisfy the render-check, not
necessarily to mirror real usage.

## Priority / batch order

Reused as-is from the existing install-weighted plugin-usage survey in
`.design-sync/NOTES.md` (2026-09-16, 197 marketplace plugins + in-repo
plugins) — not re-derived:

1. **Icon** (29% of installs, currently held back), **Textarea** (26%,
   held), **Select\*** (7 components, 25%), **DropdownMenu\*** (12
   components, 22%), **Dialog\*** (8 components, 21%) — already the
   design-sync batch-3 set, highest install-weighted reach.
2. Tooltip subparts (19%), Tabs\* (19%).
3. Popover\*/Command\*/ContextMenu\* (~10%).
4. Everything else with nonzero plugin usage (79 of 253 components total
   have any in-repo plugin usage; 82 have marketplace usage).
5. Zero-usage components (all `Resource*`, most `Data display`) stay
   unauthored until this list is exhausted — matches the existing pilot's
   documented decision to author `Resource*` last.

## Open risks

- The derivation methodology (mining real plugin usage) is meaningfully
  more work per component than a generic variant sweep — not yet
  time-boxed. Sub-project 3 (the `.ds-sync` fork) only needs a handful of
  real stories to prove itself against, so this doesn't block starting that
  work in parallel with a small first batch.
- No decision yet on whether/how to reconcile the existing app-level
  `ui/<Name>` Overview stories with the new atomic `shared-ui/<Name>`
  stories long-term (duplicate coverage of the same component, different
  purposes — app-level visual QA vs. design-sync fidelity). Not blocking;
  revisit once a full batch exists.

## Related work

- Sub-project 2: CI integration (`ladle build` as a CI check) — independent,
  not designed here.
- Sub-project 3: fork `.ds-sync`'s `source-storybook.mjs` /
  `bundlePreviewDecorators` to read Ladle instead of real Storybook — depends
  on this sub-project's first batch existing.

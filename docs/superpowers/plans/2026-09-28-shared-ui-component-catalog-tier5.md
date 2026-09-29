# shared-ui component catalog — tier 5 (real-usage catch-up + zero-usage floor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last 29 `packages/shared-ui` Ladle `Overview` stories, closing out the catalog started in tiers 1-4. Batch A (7 tasks, 17 story files) covers 12 components tier 4's own zero-usage list got wrong — they have real usage, 7 found in this repo on re-verification and 5 found only in external community plugins — and gives each a real composed-usage story like every prior tier. Batch B (5 tasks, 17 story files) covers the 17 components confirmed genuinely zero-usage everywhere, which get the spec's fallback: a single plausible render from the component's own default/example props.

**Architecture:** No new infrastructure — tier 1's pipeline (`packages/shared-ui/src/lib/story-card.tsx`, the `ladle build` CI gate, the `AGENTS.md` convention) already covers this tier. New this tier: an **external-provenance convention** for Batch A's 5 components with no in-repo call site at all (`card`, `alert-dialog`, `alert`, `progress`, `separator`) — their stories port real JSX from a named external repo:path instead of an in-repo one, and their `hint` cites that external path instead of a `plugins/*`/`apps/app/**` one. This is the first tier that needed it; see Global Constraints for the rule and Task 7 for its application.

**Tech Stack:** React, Radix UI primitives, `cva` (button/badge variants), `react-hook-form` (Form), `react-day-picker` (Calendar), `recharts` (Chart), `input-otp` (InputOTP), `react-resizable-panels` (Resizable), Ladle (`@ladle/react`), Turborepo, pnpm workspaces. All are already `@bb/shared-ui` dependencies (`packages/shared-ui/package.json`) — this plan adds no new package.

**Spec:** [docs/superpowers/specs/2026-09-25-shared-ui-component-catalog-design.md](../specs/2026-09-25-shared-ui-component-catalog-design.md)

**Prior art:** [docs/superpowers/plans/2026-09-28-shared-ui-component-catalog-tier4.md](../plans/2026-09-28-shared-ui-component-catalog-tier4.md) — the executed tier-4 plan this one copies its recipe, batching style, and verification steps from. Its own zero-usage list (28 components) was re-verified before this plan was written and turned out wrong on 12 of the 28; see [docs/superpowers/plans/2026-09-28-shared-ui-component-catalog-tier5-scope-survey.md](../plans/2026-09-28-shared-ui-component-catalog-tier5-scope-survey.md) for the corrected scope and how it was found — this plan's Batch A/Batch B split comes directly from that addendum.

## Global Constraints

- Story file path: `packages/shared-ui/src/components/ui/<name>.stories.tsx`, co-located with the component's own source file (spec "Location and format").
- Story title: the literal string `"shared-ui/<Name>"`, PascalCase of the file's dash-joined basename (spec "Location and format"; matches existing precedent — `resource-list.tsx` → `"shared-ui/ResourceList"`, `plugin-icon.tsx` → `"shared-ui/PluginIcon"`). `input-otp.tsx` → `"shared-ui/InputOTP"` (matches the component's own `InputOTP` export capitalization, not a literal PascalCase-of-dashes `InputOtp`).
- Exactly one `Overview` export per story file. Use `StoryCard`/`StoryRow` (`../../lib/story-card`) — plain (no `columns`) for label/value rows, `columns={...}` only for a true variant×size grid.
- **Batch A (real-usage) sourcing rule, unchanged from tiers 1-4:** every story is derived from a real call site — grep `plugins/*` first (primary source), `apps/app/**/*.stories.tsx` second (secondary source). Real plugin/app code imports shared-ui via `@bb/shared-ui/<name>` (apps/app-level code) or the app-local alias `@/components/ui/<name>` (plugin code — every plugin's `tsconfig.json` maps `@/*` at `packages/shared-ui/src/*`). When porting a real call site's JSX into a story, always swap that import for shared-ui's own relative import (`./avatar.js`, not `@/components/ui/avatar` or `@bb/shared-ui/avatar`).
- **Batch A external-provenance rule, new this tier:** `card`, `alert-dialog`, `alert`, `progress`, and `separator` (Task 7) have zero call sites in either of the two sources above — their only real usage is in external community plugins (found via the crawl in the tier-5 scope survey addendum). For these 5 only: port the real JSX from the cited external repo, adapting it to this repo's actual component API where the external copy has locally diverged (the external repo owns a vendored, independently-editable copy from `packages/plugin-registry`, not a live dependency — see Task 7's own note on `Progress` for a concrete case where it diverged). The `hint` cites the external `owner/repo:path` instead of an in-repo path. This does not apply to any other task — every other component in this plan (all of Batch B, and Batch A's other 7) has a real in-repo call site and uses the normal sourcing rule above. Two guardrails for any future tier that reuses this convention: prefix external hints with something self-identifying (e.g. `external:` or the literal `github.com/`) so they're never mistaken for an in-repo path at a glance, and cite a commit SHA or permalink rather than a bare path, so a later rename or force-push doesn't silently invalidate an unverifiable citation.
- **Batch B (zero-usage) sourcing rule, spec "Content convention":** a zero-usage component gets a single plausible render using the component's own default/example props — there's no real call site to derive from or cite. `hint` is optional for these; use it only where the demo needs a one-line explanation of what it's showing (e.g., which `Chart` shape, which `Calendar` mode), not to manufacture false provenance.
- Compound components must always be shown composed with their sibling sub-parts, never in isolation (spec "Content convention") — applies equally to Batch A and Batch B.
- Icon-name verification: before committing, confirm every `Icon name="..."` string used in new story code is a real key in `CORE_ICON_MAP` (`packages/shared-ui/src/components/ui/icon.tsx`) or `EXTENDED_ICON_NAMES` (`packages/shared-ui/src/components/ui/icon-extended.tsx`). Every icon name this plan's code uses has already been verified present: `ChevronDown`, `ChevronRight`, `Check`, `Plus`, `Search`, `ArrowRight`, `RotateCcw`, `X`, `GitMerge`, `Folder`, `File`, `Github`, `CircleAlert`. Each task's own verification step re-confirms this mechanically.
- Hint length: keep every `hint` string under ~140 characters (tier-3 follow-up correction, reconfirmed every tier since).
- Hint-path existence (tier-4 follow-up correction): before committing, run `test -f <path>` (or, for Task 7's external paths, confirm the path was read directly from the GitHub API response used to write this plan — already true for every Task 7 hint) on every in-repo path a hint cites. Tier 4's own final review found 5 of 16 hints pointed at truncated/nonexistent paths.
- Fixture-URL resolvability (tier-4 follow-up correction): any fixture URL used in a story must actually resolve or be an inline `data:` URI. Task 1 (Avatar) uses `https://github.com/octocat.png` — GitHub's own long-lived mascot account, the same URL shape the real call site (`PluginAuthorAvatar.tsx`) generates for any real GitHub username, chosen because it won't 404 or get renamed.
- Verification correction 1 (tiers 1-4): confirming the full catalog build picked up a new story must use `grep -o '"shared-ui[^"]*"' <builddir>/meta.json`, not a literal `grep -rl "shared-ui/<Name>"` — Ladle's `meta.json` keys each story as `shared-ui--<name>--overview` (lowercased, dash-joined from the title).
- Verification correction 2 (tiers 1-4): confirming no plugin/app-only dependency leaked into a story must scope to `^import` lines first (`grep -n '^import' <file> | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`), not an unscoped grep — `hint="..."` strings legitimately cite real call sites like `plugins/...` as provenance and would false-positive against an unscoped check. Task 7's `hint`s legitimately cite external `owner/repo:path` strings that don't match this pattern, so this check still passes for them unmodified.
- CI gate is `ladle build` succeeding for `packages/shared-ui/**/*.stories.tsx` — a build-health check only, no changes needed this tier (spec "CI").
- `Icon` and `Textarea` ([PR #4286](https://github.com/get-bb/bb/pull/4286)) remain out of scope — both are actually heavily used (confirmed in the scope-survey addendum), but their story format is a separate, still-open decision this plan doesn't resolve.
- This plan closes the catalog: after it lands, all 253 `packages/shared-ui` components named in the spec's scope have an `Overview` story (tiers 1-4's 25 + this plan's 29 = the remainder covered by compound sub-parts already sharing a file with their family, per the spec's counting convention).

## Review Focus

- **A Task 7 story silently drifting from the real external component's current API**, since its provenance is a point-in-time GitHub fetch, not a live in-repo file `test -f` can re-check. `progress.stories.tsx` is the known case (the external call site uses `indeterminate`/`indicatorClassName` props that don't exist on this repo's actual `Progress` — Task 7's own step 4 must use only `value`, not the external file's literal props) — every other Task 7 story's own verification step re-confirms its ported props against the real `packages/shared-ui` source, not just against the external snippet.
- **`ResponsiveDrawerShell` (Task 6) rendering nothing** because its `open`/`isContentRealized` gating (`if (!open && !isContentRealized) return null;`) means a story that mounts it with `open={false}` and never flips it true shows an empty canvas — the story must default `open` to `true` or wire a visible trigger, not just pass static closed props.
- **`Chart`/`Calendar` (Task 9) throwing at render time** — `ChartContainer`'s `useChart()` throws outside its own provider if a sibling `Chart*` part is used without wrapping it, and `Calendar`'s `mode="single"`/`mode="range"`/`mode="multiple"` each imply a different `selected`/`onSelect` value shape from `react-day-picker`; picking the wrong pairing is a type error, not a silent bug, but worth calling out since neither has any prior story in this repo to copy from.
- **`Form` (Task 11) submitting successfully with no visible validation feedback**, since `react-hook-form`'s `formState.errors` only populates after a validation pass — a demo that never calls `handleSubmit` or defines a schema/rule would render a `Form` that can never show its own `FormMessage`, silently defeating the reason the component exists.
- **A story silently absent from the full catalog build, or a leaked plugin/app-only import, going unnoticed because this tier adds as many files (29) as tiers 1-4 combined (25).** Every task ends with the same corrected `meta.json` grep and `^import`-scoped grep prior tiers used — for multi-file tasks, that verification step explicitly lists every file it must confirm.

---

## Task 1: author-avatar-story

`packages/shared-ui/src/components/ui/avatar.tsx` exports `Avatar`/`AvatarImage`/`AvatarFallback` (a thin Radix `@radix-ui/react-avatar` wrapper — `Avatar` takes any `div` props, `AvatarImage` any `img` props, `AvatarFallback` any `span` props plus Radix's own `delayMs`). Real call site: `apps/app/src/components/plugin/management/PluginAuthorAvatar.tsx` — renders a GitHub-sourced avatar with initials fallback, at two sizes (`detail` = `size-5`, `page` = `size-10`), plus an "official" bb-authored variant. The real component's "official" fallback renders `<BbLogo>`, an app-only SVG mark not importable into `packages/shared-ui` — this story substitutes a plain `"BB"` text mark in its place, noted inline.

**Files:**
- Create: `packages/shared-ui/src/components/ui/avatar.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/avatar.stories.tsx`:

```tsx
import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Avatar",
};

function authorInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return initials === "" ? "?" : initials;
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Detail size, real GitHub avatar"
        hint="apps/app/src/components/plugin/management/PluginAuthorAvatar.tsx — size-5, image + initials fallback"
      >
        <Avatar
          role="img"
          aria-label="octocat's GitHub avatar"
          className="size-5 border border-border bg-muted"
        >
          <AvatarImage
            src="https://github.com/octocat.png?size=40"
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <AvatarFallback aria-hidden className="text-2xs font-semibold text-subtle-foreground">
            {authorInitials("The Octocat")}
          </AvatarFallback>
        </Avatar>
      </StoryRow>
      <StoryRow
        label="Page size, image failed to load"
        hint="same component, size-10 — AvatarFallback renders when AvatarImage has no src or fails"
      >
        <Avatar role="img" aria-label="Jane Doe's avatar" className="size-10 border border-border bg-muted">
          <AvatarFallback aria-hidden className="text-xs font-semibold text-subtle-foreground">
            {authorInitials("Jane Doe")}
          </AvatarFallback>
        </Avatar>
      </StoryRow>
      <StoryRow
        label="Official bb-authored plugin"
        hint="official=true renders a wordmark instead of initials — BbLogo (app-only SVG) is stubbed here as plain text"
      >
        <Avatar role="img" aria-label="bb's avatar" className="size-10 border border-border bg-muted">
          <AvatarFallback aria-hidden className="text-xs font-semibold text-subtle-foreground">
            BB
          </AvatarFallback>
        </Avatar>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify icon names used**

No `Icon` usage in this file — skip.

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/avatar.stories.tsx -o /tmp/ladle-verify-avatar`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 5: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-avatar && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-avatar/meta.json | grep avatar`
Expected: `"shared-ui--avatar--overview"` present.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/avatar.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Confirm the hinted in-repo path exists**

Run: `test -f apps/app/src/components/plugin/management/PluginAuthorAvatar.tsx && echo OK`
Expected: `OK`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/avatar.stories.tsx
git commit -m "Add shared-ui Avatar Ladle story from real app usage"
```

---

## Task 2: author-branch-picker-and-menu-hover-stories

Two components from the same real call site (`apps/app/src/components/pickers/BranchPicker.tsx`), which composes both together — `BranchPickerRow` (`branch-picker-primitives.tsx`) calls `useMenuItemHover()` (`menu-item-hover.tsx`) internally, so their real usage is genuinely linked, same batching rationale tier 4 used for its settings-form controls.

`branch-picker-primitives.tsx` exports `BranchPickerSectionHeader`, `BranchPickerRow`, `BranchPickerSearch` (props: `label`/`subtitle`/`sticky`; `icon`/`selected`/`title`/`onSelect`/`disabled`/`children`; `inputRef`/`query`/`enterSelection`/`onEnterSelection`/`onQueryChange`/`ariaLabel`/`placeholder`). The story ports the real popover-content list from `BranchPicker.tsx` (search box + section header + several rows, one selected), minus the `Popover`/`PopoverContent` wrapper (already covered by tier 1's own Popover story) — just the bordered content list itself.

`menu-item-hover.tsx` exports `MenuHoverProvider` and the `useMenuItemHover()` hook it's a provider for. `BranchPickerRow` already shows the hook wrapped a level down; this story shows it directly on two plain generic menu buttons, so a reader sees what the hook itself does (track and highlight whichever item a pointer last entered, clearing it on keyboard nav) rather than only how one higher-level component happens to consume it.

**Files:**
- Create: `packages/shared-ui/src/components/ui/branch-picker-primitives.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/menu-item-hover.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write branch-picker-primitives.stories.tsx**

Create `packages/shared-ui/src/components/ui/branch-picker-primitives.stories.tsx`:

```tsx
import { useRef, useState } from "react";
import {
  BRANCH_PICKER_CONTENT_CLASS_NAME,
  BranchPickerRow,
  BranchPickerSearch,
  BranchPickerSectionHeader,
} from "./branch-picker-primitives.js";
import { MenuHoverProvider } from "./menu-item-hover.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/BranchPickerPrimitives",
};

const BRANCHES = ["main", "feature/checkout-flow", "fix/retry-logic", "release/1.4"];

function BranchListDemo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("main");
  const filtered = BRANCHES.filter((branch) =>
    branch.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <MenuHoverProvider>
      <div className={`${BRANCH_PICKER_CONTENT_CLASS_NAME} border border-border`}>
        <BranchPickerSearch
          inputRef={inputRef}
          query={query}
          enterSelection={filtered[0]}
          onEnterSelection={setSelected}
          onQueryChange={setQuery}
        />
        <div className="max-h-64 overflow-y-auto px-1 pb-1">
          <BranchPickerSectionHeader label="Branches" />
          {filtered.map((branch) => (
            <BranchPickerRow
              key={branch}
              icon="GitMerge"
              selected={branch === selected}
              title={branch}
              onSelect={() => setSelected(branch)}
            >
              <span className="min-w-0 flex-1 truncate">{branch}</span>
            </BranchPickerRow>
          ))}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No branches found.</p>
          ) : null}
        </div>
      </div>
    </MenuHoverProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Branch list popover content"
        hint="apps/app/src/components/pickers/BranchPicker.tsx — search + section header + selectable rows"
      >
        <BranchListDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write menu-item-hover.stories.tsx**

Create `packages/shared-ui/src/components/ui/menu-item-hover.stories.tsx`:

```tsx
import { MENU_ITEM_LAST_HOVERED_CLASS, MenuHoverProvider, useMenuItemHover } from "./menu-item-hover.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/MenuItemHover",
};

function HoverTrackedItem({ label }: { label: string }) {
  const { hoverProps } = useMenuItemHover();
  return (
    <button
      type="button"
      className={`w-full rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-state-hover ${MENU_ITEM_LAST_HOVERED_CLASS}`}
      {...hoverProps}
    >
      {label}
    </button>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Last-hovered highlight"
        hint="apps/app/src/components/pickers/BranchPicker.tsx — BranchPickerRow uses this hook internally; here it's shown directly"
      >
        <MenuHoverProvider>
          <div className="w-56 rounded-md border border-border p-1">
            <HoverTrackedItem label="Rename" />
            <HoverTrackedItem label="Archive" />
            <HoverTrackedItem label="Delete" />
          </div>
        </MenuHoverProvider>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Verify icon names used**

No `Icon` usage in `menu-item-hover.stories.tsx`. `branch-picker-primitives.stories.tsx` uses `"GitMerge"` via `BranchPickerRow`'s own internal `Icon` — not a literal `Icon name="..."` call in this story's own code, so no new name to verify.

- [ ] **Step 4: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{branch-picker-primitives,menu-item-hover}.stories.tsx -o /tmp/ladle-verify-branch-menu`
Expected: exit code 0.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 6: Confirm the full catalog build picks both files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-branch-menu && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-branch-menu/meta.json | grep -E 'branchpicker|menuitemhover'`
Expected: both `"shared-ui--branchpickerprimitives--overview"` and `"shared-ui--menuitemhover--overview"` present.

- [ ] **Step 7: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{branch-picker-primitives,menu-item-hover}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 8: Confirm the hinted in-repo path exists**

Run: `test -f apps/app/src/components/pickers/BranchPicker.tsx && echo OK`
Expected: `OK`.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-ui/src/components/ui/branch-picker-primitives.stories.tsx packages/shared-ui/src/components/ui/menu-item-hover.stories.tsx
git commit -m "Add shared-ui BranchPickerPrimitives and MenuItemHover Ladle stories from real app usage"
```

---

## Task 3: author-carousel-story

`carousel.tsx` exports `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext`, `type CarouselApi` (wraps `embla-carousel-react`). Real call site: `apps/app/src/components/plugin/management/PluginMarketplaceListing.tsx`'s `PluginScreenshotGallery` — a horizontally-scrollable screenshot strip with prev/next controls, shown only when there's more than one image. The story keeps that shape but replaces the real component's remote `screenshot` URLs (plugin marketplace CDN images, not guaranteed stable) with inline colored placeholder blocks sized like screenshots, per this tier's fixture-URL rule.

**Files:**
- Create: `packages/shared-ui/src/components/ui/carousel.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/carousel.stories.tsx`:

```tsx
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "./carousel.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Carousel",
};

const PLACEHOLDER_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Screenshot gallery"
        hint="apps/app/.../PluginMarketplaceListing.tsx — PluginScreenshotGallery, images replaced with placeholders"
      >
        <Carousel
          opts={{ align: "start", containScroll: "trimSnaps" }}
          aria-label="Plugin screenshots"
          className="w-full max-w-xl px-11"
        >
          <CarouselContent className="-ml-3 items-center">
            {PLACEHOLDER_COLORS.map((color, index) => (
              <CarouselItem key={color} className="basis-auto pl-3">
                <div
                  className={`flex h-40 w-64 items-center justify-center rounded-md border border-border object-contain text-sm text-white ${color}`}
                >
                  Screenshot {index + 1}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-0 size-8" />
          <CarouselNext className="right-0 size-8" />
        </Carousel>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify icon names used**

No literal `Icon name="..."` in this file (`CarouselPrevious`/`CarouselNext` use their own internal chevron icons) — skip.

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/carousel.stories.tsx -o /tmp/ladle-verify-carousel`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 5: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-carousel && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-carousel/meta.json | grep carousel`
Expected: `"shared-ui--carousel--overview"` present.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/carousel.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Confirm the hinted in-repo path exists**

Run: `test -f apps/app/src/components/plugin/management/PluginMarketplaceListing.tsx && echo OK`
Expected: `OK`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/carousel.stories.tsx
git commit -m "Add shared-ui Carousel Ladle story from real app usage"
```

---

## Task 4: author-toggle-group-story

`toggle-group.tsx` exports `ToggleGroup`, `ToggleGroupItem` (Radix `@radix-ui/react-toggle-group` wrapper, `type="single"|"multiple"`). Real call site: `apps/app/src/components/pickers/ModelReasoningPicker.tsx` — a "Reasoning" effort segmented control (`type="single"`) inside a picker menu.

**Files:**
- Create: `packages/shared-ui/src/components/ui/toggle-group.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/toggle-group.stories.tsx`:

```tsx
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ToggleGroup",
};

const REASONING_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function ReasoningEffortDemo() {
  const [value, setValue] = useState("medium");
  return (
    <ToggleGroup
      type="single"
      aria-label="Reasoning"
      value={value}
      onValueChange={(next) => {
        if (next) setValue(next);
      }}
      className="flex gap-1"
    >
      {REASONING_OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.label}
          className="h-6 rounded-sm px-2 text-xs font-normal shadow-none data-[state=on]:bg-state-active data-[state=on]:text-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Reasoning effort control"
        hint="apps/app/src/components/pickers/ModelReasoningPicker.tsx — single-select segmented control in a picker menu"
      >
        <ReasoningEffortDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify icon names used**

No `Icon` usage — skip.

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/toggle-group.stories.tsx -o /tmp/ladle-verify-toggle-group`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 5: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-toggle-group && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-toggle-group/meta.json | grep togglegroup`
Expected: `"shared-ui--togglegroup--overview"` present.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/toggle-group.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Confirm the hinted in-repo path exists**

Run: `test -f apps/app/src/components/pickers/ModelReasoningPicker.tsx && echo OK`
Expected: `OK`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/toggle-group.stories.tsx
git commit -m "Add shared-ui ToggleGroup Ladle story from real app usage"
```

---

## Task 5: author-option-display-story

`option-display.tsx` exports `OptionDisplay` (props: `label`, `value`, `leading?`, `compactValue?`, `className?`, `tooltip?`) plus five class-name constants. Tier 4's own conclusion that this component had "zero real component usage, only its class-name constants reused" was itself wrong, not just stale — it's directly rendered in three places. Real call site: `apps/app/src/components/secondary-panel/TerminalHostSelector.tsx` — a compact "Machine" label/value display shown while loading, when no machines exist, or when there's exactly one (otherwise it renders an interactive `OptionPicker` instead, out of scope for this story since `OptionPicker` isn't a shared-ui component).

**Files:**
- Create: `packages/shared-ui/src/components/ui/option-display.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/option-display.stories.tsx`:

```tsx
import { OptionDisplay } from "./option-display.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/OptionDisplay",
};

const CONTROL_CLASS_NAME = "h-6 max-w-40 px-1.5 text-xs";

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Loading"
        hint="apps/app/.../TerminalHostSelector.tsx — shown while the host list is still loading"
      >
        <OptionDisplay label="Machine" value="Loading…" className={CONTROL_CLASS_NAME} />
      </StoryRow>
      <StoryRow label="Empty">
        <OptionDisplay label="Machine" value="No machines" className={CONTROL_CLASS_NAME} />
      </StoryRow>
      <StoryRow
        label="Single option, non-interactive"
        hint="rendered instead of an interactive picker when there's exactly one machine to choose from"
      >
        <OptionDisplay label="Machine" value="dev-box-01" className={CONTROL_CLASS_NAME} />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify icon names used**

No `Icon` usage — skip.

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/option-display.stories.tsx -o /tmp/ladle-verify-option-display`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 5: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-option-display && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-option-display/meta.json | grep optiondisplay`
Expected: `"shared-ui--optiondisplay--overview"` present.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/option-display.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Confirm the hinted in-repo path exists**

Run: `test -f apps/app/src/components/secondary-panel/TerminalHostSelector.tsx && echo OK`
Expected: `OK`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/option-display.stories.tsx
git commit -m "Add shared-ui OptionDisplay Ladle story from real app usage"
```

---

## Task 6: author-responsive-overlay-story

`responsive-overlay.tsx` is mostly hooks and a low-level shell (`ResponsiveDrawerShell`, `PersistentResponsiveDrawerShell`, `useResponsiveOverlayBehavior`, `usePersistentOverlayFocus`, `useResponsiveDrawerRealization`), not a single simple end-user widget — it's the mechanism `Dialog`, `Popover`, and `DropdownMenu` already use internally to become a bottom drawer on compact viewports (see `packages/shared-ui/src/components/ui/dialog.tsx:230-248`, an in-repo, non-story, non-test real call site — legitimate primary source, and arguably the most authoritative one, since it's the actual production mechanism rather than a consumer of it). `apps/app`'s own hook-level consumers (`image-lightbox.tsx`, `use-hover-popover.ts`, `CompactSecondaryPanelShelf.tsx`, `SecondaryPanelLayout.tsx`) only call the hooks, not the shell component directly, so they're cited as confirming real usage but the story is built from `dialog.tsx`'s own composition, which is the one that actually renders `ResponsiveDrawerShell` as JSX.

**Files:**
- Create: `packages/shared-ui/src/components/ui/responsive-overlay.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/responsive-overlay.stories.tsx`:

```tsx
import { useState } from "react";
import { Icon } from "./icon.js";
import { ResponsiveDrawerShell } from "./responsive-overlay.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ResponsiveOverlay",
};

function DrawerShellDemo() {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="ChevronDown" className={open ? "rotate-180" : ""} />
        {open ? "Hide drawer" : "Show drawer"}
      </button>
      <div className="relative h-64 w-72 overflow-hidden rounded-md border border-border bg-muted/30">
        <ResponsiveDrawerShell
          open={open}
          onOpenChange={setOpen}
          labelledBy="responsive-overlay-demo-title"
        >
          <div className="p-4">
            <p id="responsive-overlay-demo-title" className="text-sm font-medium">
              Compact-viewport drawer content
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Dialog, Popover, and DropdownMenu all swap to this shell on a compact viewport instead of
              their normal desktop chrome — this is that shell, shown directly.
            </p>
          </div>
        </ResponsiveDrawerShell>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Compact-viewport drawer shell"
        hint="packages/shared-ui/src/components/ui/dialog.tsx:230-248 — the shell Dialog/Popover/DropdownMenu render on compact viewports"
      >
        <DrawerShellDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify icon names used**

Run: `grep -nE "^\s*ChevronDown\s*:" packages/shared-ui/src/components/ui/icon.tsx packages/shared-ui/src/components/ui/icon-extended.tsx`
Expected: one match.

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/responsive-overlay.stories.tsx -o /tmp/ladle-verify-responsive-overlay`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 5: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-responsive-overlay && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-responsive-overlay/meta.json | grep responsiveoverlay`
Expected: `"shared-ui--responsiveoverlay--overview"` present.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/responsive-overlay.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Confirm the hinted in-repo path exists**

Run: `test -f packages/shared-ui/src/components/ui/dialog.tsx && echo OK`
Expected: `OK`.

- [ ] **Step 8: Manual check — the drawer must not render blank**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/ResponsiveOverlay`. Confirm the drawer content is visible by default (not an empty canvas — this is the Review Focus item for this task), then click the toggle button and confirm it hides and reshows. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-ui/src/components/ui/responsive-overlay.stories.tsx
git commit -m "Add shared-ui ResponsiveOverlay Ladle story from real app usage"
```

---

## Task 7: author-external-marketplace-stories

The first 5 stories in this catalog with **no call site anywhere in this repo** — real usage exists only in external community plugins, found by the tier-5 scope-survey addendum's crawl. Per this plan's Global Constraints external-provenance rule: port the real JSX from the cited external file, adapt to this repo's actual component API, and cite `owner/repo:path` in the `hint` instead of an in-repo path.

**Files:**
- Create: `packages/shared-ui/src/components/ui/card.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/alert-dialog.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/alert.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/progress.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/separator.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`; `Button` from `./button.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write card.stories.tsx**

Real call site: `vburojevic/bb-plugin-linear:app.tsx` (`ConnectionCard`) — a homepage-section status card with no `CardHeader` (the host draws the section heading), showing connection state and a retry/open action.

Create `packages/shared-ui/src/components/ui/card.stories.tsx`:

```tsx
import { Button } from "./button.js";
import { Card, CardContent } from "./card.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Card",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Connection status card"
        hint="vburojevic/bb-plugin-linear:app.tsx — ConnectionCard, no CardHeader since the host draws the section title"
      >
        <Card className="w-80">
          <CardContent className="flex items-center gap-3 py-3 text-sm text-muted-foreground">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate">Connected as jane in Acme Inc (acme)</p>
            </div>
            <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1.5 text-xs">
              Open the panel
              <Icon name="ArrowRight" className="size-3" aria-hidden />
            </Button>
          </CardContent>
        </Card>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write alert-dialog.stories.tsx**

Real call site: `vburojevic/bb-plugin-linear:app/ArchiveDialog.tsx` — an archive confirmation, deliberately not styled as destructive-critical since the action is reversible.

Create `packages/shared-ui/src/components/ui/alert-dialog.stories.tsx`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog.js";
import { Button } from "./button.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/AlertDialog",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Archive confirmation"
        hint="vburojevic/bb-plugin-linear:app/ArchiveDialog.tsx — reversible action, so the body says so explicitly"
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              Archive ENG-42
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive ENG-42?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>Fix the retry backoff on the sync worker</strong>
                <br />
                <br />
                This archives the issue in Linear, for everyone — not just in bb. It is{" "}
                <strong>reversible</strong> in Linear&apos;s own UI, and it is not a delete.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90">
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Write alert.stories.tsx**

Real call site: `vburojevic/bb-plugin-handoff:app.tsx` — a `variant="destructive"` alert shown when a session's stats fail to load, with an inline retry button inside `AlertDescription`.

Create `packages/shared-ui/src/components/ui/alert.stories.tsx`:

```tsx
import { Alert, AlertDescription, AlertTitle } from "./alert.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Alert",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Destructive, with an inline retry action"
        hint="vburojevic/bb-plugin-handoff:app.tsx — shown when a session's stats fail to load"
      >
        <Alert variant="destructive" className="w-96">
          <AlertTitle>Couldn&apos;t read this session</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            The session log ended unexpectedly at turn 14.
            <Button size="sm" variant="outline">
              <Icon name="RotateCcw" aria-hidden />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </StoryRow>
      <StoryRow label="Default variant, informational">
        <Alert className="w-96">
          <AlertTitle>This checkout is on another machine</AlertTitle>
          <AlertDescription>dev-box-02 — Live is unaffected, it needs no checkout.</AlertDescription>
        </Alert>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 4: Write progress.stories.tsx**

Real call site: `vburojevic/bb-plugin-xcode:app/ActivityRow.tsx` — a hairline build-progress bar under a live activity row. **Adapted, not ported verbatim**: the external file's `Progress` uses `indeterminate` and `indicatorClassName` props that don't exist on this repo's actual `packages/shared-ui/src/components/ui/progress.tsx` (that plugin's registry-vendored copy was locally extended after vendoring — see this plan's Global Constraints and Review Focus). This story uses only the real `value` prop, and shows the design-sync survey's own flagged concern directly: `Progress` renders as an empty track at `value={0}` if nothing sets a real value, so this story always passes an explicit, non-zero one.

Create `packages/shared-ui/src/components/ui/progress.stories.tsx`:

```tsx
import { Progress } from "./progress.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Progress",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Build progress, in progress"
        hint="vburojevic/bb-plugin-xcode:app/ActivityRow.tsx — value prop only; that repo's indeterminate/indicatorClassName props aren't part of this repo's Progress"
      >
        <Progress value={62} aria-label="Building Almanac — 62% of a typical run" className="w-64" />
      </StoryRow>
      <StoryRow label="Near complete">
        <Progress value={99} aria-label="Building Almanac — 99% of a typical run" className="w-64" />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 5: Write separator.stories.tsx**

Real call site: `vburojevic/bb-plugin-handoff:app.tsx` — a plain horizontal rule ahead of a "Recent handoffs" history list section.

Create `packages/shared-ui/src/components/ui/separator.stories.tsx`:

```tsx
import { Separator } from "./separator.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Separator",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Section divider"
        hint="vburojevic/bb-plugin-handoff:app.tsx — ahead of a 'Recent handoffs' history list"
      >
        <div className="w-72">
          <Separator className="mb-3" />
          <p className="mb-1 text-sm font-medium">Recent handoffs</p>
          <p className="text-xs text-muted-foreground">2 handoffs of this thread</p>
        </div>
      </StoryRow>
      <StoryRow label="Vertical, between two inline actions">
        <div className="flex h-5 items-center gap-2 text-sm">
          <span>Rename</span>
          <Separator orientation="vertical" />
          <span>Archive</span>
        </div>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 6: Verify progress.tsx's real prop shape matches this story, not the external file's**

Run: `grep -n 'value\|indeterminate\|indicatorClassName' packages/shared-ui/src/components/ui/progress.tsx`
Expected: `value` present (destructured in the component's own signature); no `indeterminate` or `indicatorClassName` anywhere in the file — confirming `progress.stories.tsx` above correctly uses only what the real component actually accepts.

- [ ] **Step 7: Verify icon names used**

Run: `grep -nE "^\s*(ArrowRight|RotateCcw)\s*:" packages/shared-ui/src/components/ui/icon.tsx packages/shared-ui/src/components/ui/icon-extended.tsx`
Expected: one match per name (2 total).

- [ ] **Step 8: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{card,alert-dialog,alert,progress,separator}.stories.tsx -o /tmp/ladle-verify-external`
Expected: exit code 0.

- [ ] **Step 9: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors — this is the step that would catch a `Progress` prop-shape mistake if Step 4's adaptation were wrong.

- [ ] **Step 10: Confirm the full catalog build picks all five files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-external && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-external/meta.json | grep -E 'card|alertdialog|^"shared-ui--alert--|progress|separator'`
Expected: `"shared-ui--card--overview"`, `"shared-ui--alertdialog--overview"`, `"shared-ui--alert--overview"`, `"shared-ui--progress--overview"`, `"shared-ui--separator--overview"` all present.

- [ ] **Step 11: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{card,alert-dialog,alert,progress,separator}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output. (The `hint` strings citing `vburojevic/bb-plugin-*:path` don't match this pattern, so they don't false-positive here.)

- [ ] **Step 12: Commit**

```bash
git add packages/shared-ui/src/components/ui/card.stories.tsx packages/shared-ui/src/components/ui/alert-dialog.stories.tsx packages/shared-ui/src/components/ui/alert.stories.tsx packages/shared-ui/src/components/ui/progress.stories.tsx packages/shared-ui/src/components/ui/separator.stories.tsx
git commit -m "Add shared-ui Card, AlertDialog, Alert, Progress, and Separator Ladle stories from external marketplace-plugin usage"
```

---

## Task 8: author-zero-usage-display-primitives

First Batch B task — per this plan's Global Constraints Batch B rule, each of these gets one plausible render from its own default/example props, no real call site to cite. `Accordion`, `AspectRatio`, `Breadcrumb`, `Toggle`.

**Files:**
- Create: `packages/shared-ui/src/components/ui/accordion.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/aspect-ratio.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/breadcrumb.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/toggle.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write accordion.stories.tsx**

Create `packages/shared-ui/src/components/ui/accordion.stories.tsx`:

```tsx
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Accordion",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Single, collapsible">
        <Accordion type="single" collapsible className="w-80">
          <AccordionItem value="item-1">
            <AccordionTrigger>What triggers a rebuild?</AccordionTrigger>
            <AccordionContent>
              Any change under `packages/shared-ui/src` or `apps/app/src/components/ui` — the Turbo task's
              `inputs` list covers both.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Where do stories live?</AccordionTrigger>
            <AccordionContent>
              Co-located with each component's own source file, as `<name>.stories.tsx`.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write aspect-ratio.stories.tsx**

Create `packages/shared-ui/src/components/ui/aspect-ratio.stories.tsx`:

```tsx
import { AspectRatio } from "./aspect-ratio.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/AspectRatio",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="16:9, placeholder content">
        <AspectRatio ratio={16 / 9} className="w-64 overflow-hidden rounded-md bg-muted">
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            16:9
          </div>
        </AspectRatio>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Write breadcrumb.stories.tsx**

Create `packages/shared-ui/src/components/ui/breadcrumb.stories.tsx`:

```tsx
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Breadcrumb",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Three-level path">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#">bb</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>packages/shared-ui</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 4: Write toggle.stories.tsx**

Create `packages/shared-ui/src/components/ui/toggle.stories.tsx`:

```tsx
import { Icon } from "./icon.js";
import { Toggle } from "./toggle.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Toggle",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Icon toggle, off">
        <Toggle aria-label="Toggle bold">
          <Icon name="Check" />
        </Toggle>
      </StoryRow>
      <StoryRow label="Icon toggle, on">
        <Toggle aria-label="Toggle bold" pressed>
          <Icon name="Check" />
        </Toggle>
      </StoryRow>
      <StoryRow label="Outline variant">
        <Toggle variant="outline" aria-label="Toggle bold">
          <Icon name="Check" />
        </Toggle>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 5: Verify icon names used**

Run: `grep -nE "^\s*Check\s*:" packages/shared-ui/src/components/ui/icon.tsx packages/shared-ui/src/components/ui/icon-extended.tsx`
Expected: one match.

- [ ] **Step 6: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{accordion,aspect-ratio,breadcrumb,toggle}.stories.tsx -o /tmp/ladle-verify-display-primitives`
Expected: exit code 0.

- [ ] **Step 7: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 8: Confirm the full catalog build picks all four files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-display-primitives && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-display-primitives/meta.json | grep -E 'accordion|aspectratio|breadcrumb|^"shared-ui--toggle--'`
Expected: all four present.

- [ ] **Step 9: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{accordion,aspect-ratio,breadcrumb,toggle}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add packages/shared-ui/src/components/ui/accordion.stories.tsx packages/shared-ui/src/components/ui/aspect-ratio.stories.tsx packages/shared-ui/src/components/ui/breadcrumb.stories.tsx packages/shared-ui/src/components/ui/toggle.stories.tsx
git commit -m "Add shared-ui Accordion, AspectRatio, Breadcrumb, and Toggle Ladle stories (zero-usage, plausible-render)"
```

---

## Task 9: author-zero-usage-data-visualization-stories

`Calendar` (`react-day-picker`-backed) and `Chart` (`recharts`-backed) — the two most structurally involved Batch B components, called out in this plan's Review Focus for provider/mode-pairing pitfalls neither has a prior story to copy from.

**Files:**
- Create: `packages/shared-ui/src/components/ui/calendar.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/chart.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write calendar.stories.tsx**

`mode="single"` pairs with a single `Date | undefined` for `selected`/`onSelect` — the pairing this story uses, since it's the most common real usage pattern (a date picker, not a range or multi-select).

Create `packages/shared-ui/src/components/ui/calendar.stories.tsx`:

```tsx
import { useState } from "react";
import { Calendar } from "./calendar.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Calendar",
};

function SingleDateDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 8, 28));
  return <Calendar mode="single" selected={date} onSelect={setDate} className="rounded-md border border-border" />;
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Single date selection">
        <SingleDateDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write chart.stories.tsx**

`ChartContainer` requires a `config` and must wrap any `Chart*` sibling — using `ChartTooltip`/`ChartTooltipContent` outside it throws (`useChart` has no default context). This demo is a minimal bar chart, the shape most other shadcn-derived chart examples use as their own baseline.

Create `packages/shared-ui/src/components/ui/chart.stories.tsx`:

```tsx
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./chart.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Chart",
};

const chartData = [
  { day: "Mon", threads: 12 },
  { day: "Tue", threads: 18 },
  { day: "Wed", threads: 9 },
  { day: "Thu", threads: 21 },
  { day: "Fri", threads: 15 },
];

const chartConfig = {
  threads: { label: "Threads", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Bar chart with tooltip">
        <ChartContainer config={chartConfig} className="h-48 w-96">
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="threads" fill="var(--color-threads)" radius={4} />
          </BarChart>
        </ChartContainer>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Verify icon names used**

No `Icon` usage in either file — skip.

- [ ] **Step 4: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{calendar,chart}.stories.tsx -o /tmp/ladle-verify-dataviz`
Expected: exit code 0.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors — this is what actually catches a `mode`/`selected` mismatch in `calendar.stories.tsx` or a `ChartConfig` shape mistake in `chart.stories.tsx`.

- [ ] **Step 6: Confirm the full catalog build picks both files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-dataviz && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-dataviz/meta.json | grep -E 'calendar|chart'`
Expected: `"shared-ui--calendar--overview"` and `"shared-ui--chart--overview"` present.

- [ ] **Step 7: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{calendar,chart}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 8: Manual check — Chart must not throw**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Chart`. Confirm the bars render and hovering shows the tooltip (this is the Review Focus item — a missing `ChartContainer` wrap would throw instead of rendering blank, so a crash here is the signal to check for). Open `shared-ui/Calendar` and confirm clicking a date updates the selection. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-ui/src/components/ui/calendar.stories.tsx packages/shared-ui/src/components/ui/chart.stories.tsx
git commit -m "Add shared-ui Calendar and Chart Ladle stories (zero-usage, plausible-render)"
```

---

## Task 10: author-zero-usage-overlay-layout-stories

`Drawer`, `Sheet`, `Resizable`, `ScrollArea` — overlay and layout primitives with no real usage anywhere in this repo.

**Files:**
- Create: `packages/shared-ui/src/components/ui/drawer.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/sheet.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/resizable.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/scroll-area.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Button` from `./button.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write drawer.stories.tsx**

`Drawer` (`vaul`-backed, bottom-sheet style, distinct from this repo's own `responsive-overlay.tsx` shell) defaults `open` uncontrolled via its own `Trigger`, so this demo just needs the trigger — no external `useState` required.

Create `packages/shared-ui/src/components/ui/drawer.stories.tsx`:

```tsx
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer.js";
import { Button } from "./button.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Drawer",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Bottom drawer">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline" size="sm">
              Open drawer
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <div className="p-4">
              <DrawerTitle>Confirm action</DrawerTitle>
              <DrawerDescription>This bottom sheet is the vaul-backed Drawer primitive.</DrawerDescription>
              <DrawerClose asChild>
                <Button variant="outline" size="sm" className="mt-4">
                  Close
                </Button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write sheet.stories.tsx**

Create `packages/shared-ui/src/components/ui/sheet.stories.tsx`:

```tsx
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet.js";
import { Button } from "./button.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Sheet",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Side panel, right">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              Open sheet
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Panel settings</SheetTitle>
              <SheetDescription>A side-anchored overlay, distinct from Dialog's centered modal.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Write resizable.stories.tsx**

Create `packages/shared-ui/src/components/ui/resizable.stories.tsx`:

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Resizable",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Two-pane horizontal split">
        <ResizablePanelGroup direction="horizontal" className="h-40 w-96 rounded-md border border-border">
          <ResizablePanel defaultSize={40}>
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Sidebar
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={60}>
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Content
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 4: Write scroll-area.stories.tsx**

Create `packages/shared-ui/src/components/ui/scroll-area.stories.tsx`:

```tsx
import { ScrollArea } from "./scroll-area.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ScrollArea",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Fixed-height scrollable list">
        <ScrollArea className="h-40 w-64 rounded-md border border-border p-3">
          <ul className="space-y-2 text-sm">
            {Array.from({ length: 20 }, (_, index) => (
              <li key={index}>Row {index + 1}</li>
            ))}
          </ul>
        </ScrollArea>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 5: Verify icon names used**

No `Icon` usage in any of the four files — skip.

- [ ] **Step 6: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{drawer,sheet,resizable,scroll-area}.stories.tsx -o /tmp/ladle-verify-overlay-layout`
Expected: exit code 0.

- [ ] **Step 7: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 8: Confirm the full catalog build picks all four files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-overlay-layout && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-overlay-layout/meta.json | grep -E 'drawer|sheet|resizable|scrollarea'`
Expected: all four present.

- [ ] **Step 9: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{drawer,sheet,resizable,scroll-area}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add packages/shared-ui/src/components/ui/drawer.stories.tsx packages/shared-ui/src/components/ui/sheet.stories.tsx packages/shared-ui/src/components/ui/resizable.stories.tsx packages/shared-ui/src/components/ui/scroll-area.stories.tsx
git commit -m "Add shared-ui Drawer, Sheet, Resizable, and ScrollArea Ladle stories (zero-usage, plausible-render)"
```

---

## Task 11: author-zero-usage-form-stories

`Form` (`react-hook-form`-backed), `InputOTP`, `Slider` — the Review Focus item for this task is `Form` specifically: a demo that never triggers validation can't show its own `FormMessage`, silently defeating the component's purpose.

**Files:**
- Create: `packages/shared-ui/src/components/ui/form.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/input-otp.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/slider.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Button` from `./button.js`; `Input` from `./input.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write form.stories.tsx**

`useFormField()`/`FormMessage` reads validation state from `react-hook-form`'s own `formState.errors`, populated only after `handleSubmit` runs a failing validation. This demo defines a `required` rule via `FormField`'s own `Controller`-based `render`, and submits with an empty field on mount (via a `useEffect` that calls `form.trigger()`) so `FormMessage` has something real to show without requiring a click in the Ladle canvas.

Create `packages/shared-ui/src/components/ui/form.stories.tsx`:

```tsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "./button.js";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form.js";
import { Input } from "./input.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Form",
};

interface ProjectFormValues {
  name: string;
}

function ProjectNameFormDemo() {
  const form = useForm<ProjectFormValues>({ defaultValues: { name: "" } });

  useEffect(() => {
    // Trigger validation on mount so FormMessage has a real error to render
    // without requiring a click inside the Ladle canvas.
    void form.trigger();
  }, [form]);

  return (
    <Form {...form}>
      <form className="w-72 space-y-4" onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="name"
          rules={{ required: "A project name is required." }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="my-project" />
              </FormControl>
              <FormDescription>Used as the default branch prefix.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="sm">
          Create project
        </Button>
      </form>
    </Form>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Required-field validation">
        <ProjectNameFormDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write input-otp.stories.tsx**

Create `packages/shared-ui/src/components/ui/input-otp.stories.tsx`:

```tsx
import { useState } from "react";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "./input-otp.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/InputOTP",
};

function SixDigitCodeDemo() {
  const [value, setValue] = useState("42");
  return (
    <InputOTP maxLength={6} value={value} onChange={setValue}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="6-digit code, grouped 3+3">
        <SixDigitCodeDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Write slider.stories.tsx**

Create `packages/shared-ui/src/components/ui/slider.stories.tsx`:

```tsx
import { useState } from "react";
import { Slider } from "./slider.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Slider",
};

function VolumeSliderDemo() {
  const [value, setValue] = useState([60]);
  return (
    <div className="flex w-64 items-center gap-3">
      <Slider value={value} onValueChange={setValue} max={100} step={1} aria-label="Volume" />
      <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">{value[0]}</span>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Single-thumb value control">
        <VolumeSliderDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 4: Verify icon names used**

No `Icon` usage in any of the three files — skip.

- [ ] **Step 5: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{form,input-otp,slider}.stories.tsx -o /tmp/ladle-verify-form-zero`
Expected: exit code 0.

- [ ] **Step 6: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 7: Confirm the full catalog build picks all three files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-form-zero && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-form-zero/meta.json | grep -E '^"shared-ui--form--|inputotp|slider'`
Expected: `"shared-ui--form--overview"`, `"shared-ui--inputotp--overview"`, `"shared-ui--slider--overview"` all present.

- [ ] **Step 8: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{form,input-otp,slider}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 9: Manual check — FormMessage must actually render**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Form`. Confirm "A project name is required." is visible under the input without clicking anything (this is the Review Focus item — the `form.trigger()` on mount is what makes this true; if it's missing, the message won't appear until a submit click, and a reviewer skimming the story canvas would see a `Form` that looks like it has no validation at all). Stop the dev server.

- [ ] **Step 10: Commit**

```bash
git add packages/shared-ui/src/components/ui/form.stories.tsx packages/shared-ui/src/components/ui/input-otp.stories.tsx packages/shared-ui/src/components/ui/slider.stories.tsx
git commit -m "Add shared-ui Form, InputOTP, and Slider Ladle stories (zero-usage, plausible-render)"
```

---

## Task 12: author-zero-usage-navigation-data-stories

`Menubar`, `NavigationMenu`, `Pagination`, `Table` — the last four zero-usage components, closing out the catalog.

**Files:**
- Create: `packages/shared-ui/src/components/ui/menubar.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/navigation-menu.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/pagination.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/table.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write menubar.stories.tsx**

Create `packages/shared-ui/src/components/ui/menubar.stories.tsx`:

```tsx
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "./menubar.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Menubar",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="File menu">
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>
                New Thread <MenubarShortcut>⌘N</MenubarShortcut>
              </MenubarItem>
              <MenubarItem>
                Open Project <MenubarShortcut>⌘O</MenubarShortcut>
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem>Close Window</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write navigation-menu.stories.tsx**

Create `packages/shared-ui/src/components/ui/navigation-menu.stories.tsx`:

```tsx
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./navigation-menu.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/NavigationMenu",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Dropdown section">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Docs</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="w-48 p-2">
                  <li>
                    <NavigationMenuLink href="#" className="block rounded-sm p-2 text-sm hover:bg-muted">
                      Getting started
                    </NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#" className="block rounded-sm p-2 text-sm hover:bg-muted">
                      Plugin API
                    </NavigationMenuLink>
                  </li>
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Write pagination.stories.tsx**

Create `packages/shared-ui/src/components/ui/pagination.stories.tsx`:

```tsx
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./pagination.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Pagination",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Page 3 of 9">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#">1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#" isActive>
                3
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#">4</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#">9</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 4: Write table.stories.tsx**

Create `packages/shared-ui/src/components/ui/table.stories.tsx`:

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Table",
};

const ROWS = [
  { plugin: "tasks", installs: 1020, status: "active" },
  { plugin: "github", installs: 817, status: "active" },
  { plugin: "theme-preview", installs: 42, status: "active" },
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Plugin install counts">
        <Table className="w-96">
          <TableHeader>
            <TableRow>
              <TableHead>Plugin</TableHead>
              <TableHead>Installs</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <TableRow key={row.plugin}>
                <TableCell className="font-medium">{row.plugin}</TableCell>
                <TableCell>{row.installs.toLocaleString()}</TableCell>
                <TableCell>{row.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 5: Verify icon names used**

No literal `Icon name="..."` in any of the four files (`NavigationMenuTrigger`'s chevron and `PaginationEllipsis`'s glyph are internal to those components) — skip.

- [ ] **Step 6: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{menubar,navigation-menu,pagination,table}.stories.tsx -o /tmp/ladle-verify-nav-data`
Expected: exit code 0.

- [ ] **Step 7: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 8: Confirm the full catalog build picks all four files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-nav-data && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-nav-data/meta.json | grep -E 'menubar|navigationmenu|pagination|^"shared-ui--table--'`
Expected: all four present.

- [ ] **Step 9: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{menubar,navigation-menu,pagination,table}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 10: Confirm the full catalog now has all 254 story files (25 from tiers 1-4, 29 from this plan)**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-catalog && grep -oc '"shared-ui--[^"]*--overview"' /tmp/ladle-verify-full-catalog/meta.json`
Expected: `54` (25 + 29 — every task in this plan and every task in tiers 1-4 produces exactly one `Overview` export per file; count doubles because each story key also appears once more as a chunk-name match unless `-c` is scoped to unique lines — if the raw count differs from 54, run `grep -o '"shared-ui--[^"]*--overview"' /tmp/ladle-verify-full-catalog/meta.json | sort -u | wc -l` instead and expect exactly 54 unique keys).

- [ ] **Step 11: Commit**

```bash
git add packages/shared-ui/src/components/ui/menubar.stories.tsx packages/shared-ui/src/components/ui/navigation-menu.stories.tsx packages/shared-ui/src/components/ui/pagination.stories.tsx packages/shared-ui/src/components/ui/table.stories.tsx
git commit -m "Add shared-ui Menubar, NavigationMenu, Pagination, and Table Ladle stories (zero-usage, plausible-render)"
```

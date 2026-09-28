# shared-ui component catalog — tier 3 (Popover/Command/ContextMenu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the third priority tier of the shared-ui component catalog — real, composed-usage Ladle `Overview` stories for the `Popover`, `Command`, and `ContextMenu` component families in `packages/shared-ui` — reusing the pipeline tiers 1-2 already built, unchanged.

**Architecture:** No new infrastructure. Tier 1 (`packages/shared-ui/src/lib/story-card.tsx`, the `ladle build` CI gate scoped to `packages/shared-ui/src/components/ui/*.stories.tsx`, the `AGENTS.md` convention) already covers this tier and every later one. This plan is exactly three tasks, one per component family, each repeating tiers 1-2's per-file recipe: grep `plugins/*` and `apps/app/**` for real usage, write one `Overview` story, verify with a scoped `ladle build`, confirm the story appears in the full build's `meta.json`, grep for leaked plugin/app-only imports, commit.

**Tech Stack:** React, Radix UI primitives (`@radix-ui/react-popover`, `@radix-ui/react-context-menu`), `cmdk` (via `command.tsx`), Ladle (`@ladle/react`), Turborepo, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-09-25-shared-ui-component-catalog-design.md](../specs/2026-09-25-shared-ui-component-catalog-design.md)

**Prior art:** [docs/superpowers/plans/2026-09-27-shared-ui-component-catalog-tier2.md](../plans/2026-09-27-shared-ui-component-catalog-tier2.md) — the executed tier-2 plan this one copies its recipe from verbatim, with two verification corrections (below) folded in from the start instead of being rediscovered mid-execution.

## Global Constraints

- Story file path: `packages/shared-ui/src/components/ui/<name>.stories.tsx`, co-located with the component it exercises (spec "Location and format").
- Story title: the literal string `"shared-ui/<Name>"` (spec "Location and format").
- Exactly one `Overview` export per component file. Use `StoryCard`/`StoryRow` (`../../lib/story-card`) when the component has more than one real pattern worth showing; otherwise render it plainly. No atomic per-state split, no story-count cap (spec "Content convention").
- Every story must be derived from a real call site: grep `plugins/*` first (primary source), `apps/app/**` second (secondary source — for this tier, `apps/app/**` turned out to be the only source with real usage; see each task's own note). This tier's order — Popover, then Command, then ContextMenu — comes from the spec's install-weighted marketplace-plugin survey (~10% combined), not from a same-session in-repo usage count; do not re-rank within this plan based on raw grep hit counts (spec "Scope and priority order").
- Compound components must always be shown composed with their sibling sub-parts, never in isolation (spec "Content convention"). `Popover` cannot show anything useful without a `PopoverTrigger`/`PopoverAnchor` and `PopoverContent`; `ContextMenu` cannot open without a `ContextMenuTrigger` and `ContextMenuContent`. `Command` is the one family in this tier that renders meaningfully without an external trigger (it has no open/closed state of its own) — every real call site still wraps it in a `Popover`, but Task 2's demos render it as a plain bordered block instead of re-wrapping it in a `Popover`, since Task 1 already demonstrates that combination and repeating it would be pure duplication, not a distinct pattern.
- Verification correction 1 (was wrong in tier 1, silently rediscovered in tier 2): confirming the full catalog build picked up a new story must use `grep -o '"shared-ui[^"]*"' <builddir>/meta.json`, not a literal `grep -rl "shared-ui/<Name>"` against the build output — Ladle's `meta.json` keys each story as `shared-ui--<name>--overview` (lowercased, dash-joined from the title), so the literal-string form never matches anything.
- Verification correction 2 (was wrong in tier 1, silently rediscovered in tier 2): confirming no plugin/app-only dependency leaked into a story must scope to `^import` lines first (`grep -n '^import' <file> | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`), not an unscoped grep across the whole file — `hint="..."` strings legitimately cite real call sites like `plugins/tasks/...` or `apps/app/src/...` as provenance and would false-positive against an unscoped check.
- CI gate is `ladle build` succeeding for `packages/shared-ui/**/*.stories.tsx` — a build-health check only. It does not enforce coverage or freshness (spec "CI"). No changes to the gate itself are needed this tier — the existing glob (`apps/app/.ladle/config.mjs`) already matches any new `*.stories.tsx` file under `packages/shared-ui/src/components/ui/`.
- `Icon` and `Textarea` ([PR #4286](https://github.com/get-bb/bb/pull/4286)) remain out of scope. `Select`, `Dialog`, `DropdownMenu` (tier 1) and `Tooltip`, `Tabs` (tier 2) are already done. Everything else with nonzero usage is tier 4; zero-usage components are tier 5 — not this plan.

## Review Focus

- **A `ContextMenu` demo with no visible affordance that it opens on right-click.** Unlike every other overlay in this catalog so far, `ContextMenu` has no visible trigger element (no button, no chevron) — a plugin author skimming the Ladle grid could easily mistake a `ContextMenu` demo for inert placeholder content and never discover it opens at all. Both of Task 3's demos render their trigger as a labeled dashed-border box (e.g. "Right-click this file row") specifically so the interaction is discoverable without already knowing Radix's `ContextMenu` convention.
- **`PopoverContent`, `ContextMenuContent`, and `ContextMenuSubContent` escaping the `StoryRow` grid when opened.** All three render through a Radix `Portal` to `document.body` — the same portal-escape risk tier 1 flagged for Select/Dialog/DropdownMenu and tier 2 flagged for Tooltip. Tasks 1 and 3 each include a manual `ladle serve` check for this; `Command` (Task 2) does not portal on its own, so its demos render inline and don't need this check.
- **Task 1's "hover menu" demo reimplementing hover-open/close-delay logic that only approximates the real app's `useHoverPopover` hook, not matches it.** The real call site (`PaneMaximizeButton.tsx`) opens via pointer hover, keyboard focus, and an arrow-down keypress, with a shared, app-internal hook coordinating trigger/content hover state and a close delay. `packages/shared-ui` cannot import that hook (it lives in `apps/app`, not `packages/shared-ui` — see the plugin/app dependency check below), so Task 1's demo reimplements only the pointer-hover and close-delay behavior locally, in miniature, as a stand-in — not a faithful reproduction of every real interaction path. Its hint text must say so explicitly, so a reader doesn't treat the story as the source of truth for the hook's keyboard-focus behavior.
- **`Command`'s manual filtering silently doing nothing.** Every real call site in this repo passes `shouldFilter={false}` to `Command` and filters the list itself before rendering `CommandItem`s (`cmdk`'s own built-in fuzzy filter is unused here). A story that copies `shouldFilter={false}` but forgets to actually filter its own static list before mapping it to `CommandItem`s would show every item regardless of what's typed into `CommandInput` — this looks exactly like a broken search, not like a deliberate no-op. Task 2's "grouped list" demo doesn't take search input at all (matching `ProjectSelector.tsx`'s few-items-skip-search behavior); its "empty search state" demo is the one that must actually filter, and starts pre-filled with a non-matching query specifically so the filtered-to-zero / `CommandEmpty` state is visible without requiring interaction first.
- **A story silently not appearing in the full catalog build**, or **importing a plugin-SDK-only or app-internal-only dependency** because its real call site used one (`useHoverPopover`, `useLocalOpenTargets`, `usePluginSlots`, `@bb/domain`'s `Host` type, and similar). `packages/shared-ui` cannot depend on plugin or app code. All three tasks end with both the corrected `meta.json` grep and the corrected `^import`-scoped grep (see Verification corrections above).

---

## Task 1: author-popover-stories

`packages/shared-ui/src/components/ui/popover.tsx` exports 4 symbols: `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`. Real usage covers two distinct shapes. `apps/app/src/components/pickers/MachinePicker.tsx` shows the by-far-most-common shape in this repo: `Popover`/`PopoverTrigger` anchoring a searchable `Command` combobox (the same pattern five different pickers use — see Task 2). `apps/app/src/views/thread-detail/PaneMaximizeButton.tsx` shows the other real shape: `PopoverAnchor` (not `PopoverTrigger`) wrapping a button that opens the popover on hover via a shared `useHoverPopover` hook, used for a small "pane arrangement" menu — `PopoverAnchor` decouples the element that positions the popover from the element that would normally toggle it, which is what makes hover-to-open (as opposed to click-to-toggle) possible.

**Files:**
- Create: `packages/shared-ui/src/components/ui/popover.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Command`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandList` from `./command.js`; `Button` from `./button.js`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/popover.stories.tsx`:

```tsx
import { useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "./popover.js";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Popover",
};

interface PickerMachine {
  id: string;
  name: string;
  connected: boolean;
}

const PICKER_MACHINES: PickerMachine[] = [
  { id: "local", name: "This machine", connected: true },
  { id: "staging-01", name: "staging-01", connected: true },
  { id: "staging-02", name: "staging-02", connected: false },
];

function SearchablePickerDemo() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("local");
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () =>
      PICKER_MACHINES.filter((machine) =>
        machine.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );
  const selected = PICKER_MACHINES.find(
    (machine) => machine.id === selectedId,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Machine"
        >
          {selected?.name ?? "Select machine"}
          <Icon
            name="ChevronDown"
            className="ml-1 size-3.5 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" autoFocusRef={inputRef} className="w-64 p-0">
        <Command shouldFilter={false} label="Search machines">
          <CommandInput
            ref={inputRef}
            aria-label="Search machines"
            placeholder="Search machines"
            value={query}
            onValueChange={setQuery}
            className="h-8 text-xs"
          />
          <CommandList>
            <CommandGroup>
              {filtered.map((machine) => (
                <CommandItem
                  key={machine.id}
                  value={machine.id}
                  disabled={!machine.connected}
                  onSelect={() => {
                    setSelectedId(machine.id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {machine.name}
                  </span>
                  {machine.connected ? null : (
                    <span className="ml-auto text-2xs text-muted-foreground">
                      offline
                    </span>
                  )}
                  <Icon
                    name="Check"
                    className={
                      machine.id === selectedId
                        ? "ml-1 size-3.5 opacity-100"
                        : "ml-1 size-3.5 opacity-0"
                    }
                  />
                </CommandItem>
              ))}
              {filtered.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No machines found
                </div>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function HoverMenuDemo() {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimeoutRef.current === null) return;
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimeoutRef.current = window.setTimeout(() => setOpen(false), 150);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Pane arrangement"
          onPointerEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onPointerLeave={scheduleClose}
          onFocus={() => {
            cancelClose();
            setOpen(true);
          }}
          onBlur={scheduleClose}
        >
          <Icon name="Maximize2" className="size-4" />
        </Button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        className="w-40 p-1"
      >
        {["Move left", "Move right", "Move top", "Move bottom"].map(
          (label) => (
            <button
              key={label}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {label}
            </button>
          ),
        )}
      </PopoverContent>
    </Popover>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Searchable picker"
        hint="apps/app/src/components/pickers/MachinePicker.tsx — Popover anchors a Command combobox via PopoverTrigger, simplified to a static machine list"
      >
        <SearchablePickerDemo />
      </StoryRow>
      <StoryRow
        label="Hover menu"
        hint="apps/app/src/views/thread-detail/PaneMaximizeButton.tsx — PopoverAnchor (not PopoverTrigger) lets the real app open the menu on hover via a shared, app-internal useHoverPopover hook. This demo reimplements only the pointer-hover and close-delay behavior locally as a stand-in — it does not reproduce that hook's keyboard-focus handling"
      >
        <HoverMenuDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/popover.stories.tsx' -o /tmp/ladle-verify-popover`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors. (`@bb/shared-ui` has no `lint` script — see tier 2's parked follow-up note; don't add `lint` to this command.)

- [ ] **Step 4: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-popover && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-popover/meta.json`
Expected: exit code 0 for the build, and `"shared-ui--popover--overview"` present among the grep's matches (Review Focus: a story silently not appearing in the full build).

- [ ] **Step 5: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/popover.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output. The story above uses local static data instead of the real `Host`/`useHoverPopover` dependencies.

- [ ] **Step 6: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Popover` in the browser. For "Searchable picker," click the trigger, type into the search box, and confirm the list filters and a selection closes the popover without visually breaking out of the `StoryRow` layout. For "Hover menu," hover the icon button (and separately, Tab to focus it) and confirm the menu opens without escaping the grid (Review Focus: portal escaping the grid), then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-ui/src/components/ui/popover.stories.tsx
git commit -m "Add a shared-ui/Popover Ladle story from real app usage"
```

---

## Task 2: author-command-stories

`packages/shared-ui/src/components/ui/command.tsx` exports 9 symbols; this task uses `Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandEmpty` (`CommandDialog` and `CommandShortcut` have zero real usage anywhere in this repo — the app's own command palette, `apps/app/src/components/commands/CommandPalette.tsx`, reimplements its own list UI on top of `Dialog` rather than using `CommandDialog`, so there's no real call site to derive a `CommandDialog` demo from). Real usage covers two distinct shapes, both from `apps/app/src/components/pickers/*.tsx` (plugin usage of `Command` didn't turn up in this survey — every hit was a false positive on the word "command" meaning something else, like `KeyboardCommandId`). `ProjectSelector.tsx` shows a `CommandGroup` of real items followed by a `CommandSeparator` and a second `CommandGroup` holding a "create new" action — the common "results, then actions" shape. `ReuseEnvironmentPicker.tsx` shows `CommandEmpty`, which `cmdk` renders whenever the `CommandList` below it has zero matching `CommandItem`s.

**Files:**
- Create: `packages/shared-ui/src/components/ui/command.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/command.stories.tsx`:

```tsx
import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./command.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Command",
};

interface PickerProject {
  id: string;
  name: string;
}

const PROJECTS: PickerProject[] = [
  { id: "bb", name: "bb" },
  { id: "docs-site", name: "docs-site" },
  { id: "infra", name: "infra" },
];

function GroupedListDemo() {
  const [selectedId, setSelectedId] = useState<string | null>("bb");

  return (
    <Command className="w-72 rounded-md border" shouldFilter={false}>
      <CommandList>
        <CommandGroup heading="Project">
          {PROJECTS.map((project) => (
            <CommandItem
              key={project.id}
              value={project.id}
              onSelect={() => setSelectedId(project.id)}
              className="text-xs"
            >
              <Icon
                name="Folder"
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <Icon
                name="Check"
                className={
                  project.id === selectedId
                    ? "ml-auto size-4 opacity-100"
                    : "ml-auto size-4 opacity-0"
                }
                aria-hidden
              />
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup>
          <CommandItem value="new-project" className="text-xs">
            <Icon
              name="FolderPlus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            New project
          </CommandItem>
          <CommandItem
            value="no-project"
            onSelect={() => setSelectedId(null)}
            className="text-xs"
          >
            <Icon
              name="FolderMinus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            Don&apos;t work in a project
            <Icon
              name="Check"
              className={
                selectedId === null
                  ? "ml-auto size-4 opacity-100"
                  : "ml-auto size-4 opacity-0"
              }
              aria-hidden
            />
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function EmptySearchDemo() {
  const [query, setQuery] = useState("zzz");
  const filtered = useMemo(
    () =>
      PROJECTS.filter((project) =>
        project.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  return (
    <Command
      className="w-72 rounded-md border"
      shouldFilter={false}
      label="Search projects"
    >
      <CommandInput
        aria-label="Search projects"
        placeholder="Search projects"
        value={query}
        onValueChange={setQuery}
        className="h-8 text-xs"
      />
      <CommandList>
        {filtered.length === 0 ? (
          <CommandEmpty className="px-2 py-2 text-xs text-muted-foreground">
            No projects match.
          </CommandEmpty>
        ) : (
          <CommandGroup heading="Project">
            {filtered.map((project) => (
              <CommandItem
                key={project.id}
                value={project.id}
                className="text-xs"
              >
                {project.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Grouped list with separator"
        hint="apps/app/src/components/pickers/ProjectSelector.tsx — a CommandGroup of real items, a CommandSeparator, then a second CommandGroup with a 'create new' action. Normally rendered inside a Popover; simplified here to a bordered standalone block since shared-ui/Popover's own story already covers that combination"
      >
        <GroupedListDemo />
      </StoryRow>
      <StoryRow
        label="Empty search state"
        hint="apps/app/src/components/pickers/ReuseEnvironmentPicker.tsx — CommandEmpty renders only when the CommandGroup below it has zero matching CommandItems. Starts pre-filled with a non-matching query so the empty state is visible without typing; edit the search box to see real matches"
      >
        <EmptySearchDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/command.stories.tsx' -o /tmp/ladle-verify-command`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 4: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-command && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-command/meta.json`
Expected: exit code 0 for the build, and `"shared-ui--command--overview"` present among the grep's matches.

- [ ] **Step 5: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/command.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 6: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Command` in the browser. For "Grouped list with separator," click a few items and confirm the check mark moves. For "Empty search state," confirm "No projects match." shows by default, then clear the search box and confirm real project names appear (Review Focus: manual filtering silently doing nothing), then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-ui/src/components/ui/command.stories.tsx
git commit -m "Add a shared-ui/Command Ladle story from real app usage"
```

---

## Task 3: author-context-menu-stories

`packages/shared-ui/src/components/ui/context-menu.tsx` exports 15 symbols; this task uses `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator`, `ContextMenuSub`, `ContextMenuSubTrigger`, `ContextMenuSubContent` (the checkbox/radio-item/label/group variants have real usage too, in `plugins/tasks/views/list/property-menus.tsx`, but that file's own composition is property-filter-specific in a way that would need more app-internal state than is worth carrying into a static demo — left for a later tier's pass at "components with partial pre-existing coverage" if that grows relevant, per tier 2's own follow-up note). Real usage covers two distinct shapes, both from `apps/app/src`. `ExperimentalFileLinkMenu.tsx` (rendered inside `ExperimentalFileLink.tsx`'s `ContextMenu`/`ContextMenuTrigger`) shows a nested `ContextMenuSub`/`ContextMenuSubTrigger`/`ContextMenuSubContent` "Open with" picker alongside plain top-level items. `ProjectActionsMenu.tsx`, via the shared `apps/app/src/components/ui/action-menu-items.tsx` helper, shows the repo's "destructive item" convention — a trailing action styled red via `text-destructive focus:bg-destructive/15 focus:text-destructive` — and, notably, that same helper renders the identical item set as a `DropdownMenu` on touch surfaces (`surface="dropdown"`), which is why `shared-ui/DropdownMenu`'s tier-1 story and this one will look related if viewed side by side.

**Files:**
- Create: `packages/shared-ui/src/components/ui/context-menu.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/context-menu.stories.tsx`:

```tsx
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ContextMenu",
};

const TRIGGER_AREA_CLASS =
  "flex h-16 w-72 cursor-default select-none items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground";

function FileActionsDemo() {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={TRIGGER_AREA_CLASS}>Right-click this file row</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        <ContextMenuItem>Open preview</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Open with</ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-48">
            <ContextMenuItem>BB preview</ContextMenuItem>
            <ContextMenuItem>VS Code</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem>Copy file path</ContextMenuItem>
        <ContextMenuItem>Copy file name</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RowActionsDemo() {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={TRIGGER_AREA_CLASS}>Right-click this project row</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <ContextMenuItem>
          <Icon name="Settings" aria-hidden />
          Project settings
        </ContextMenuItem>
        <ContextMenuItem>
          <Icon name="Edit" aria-hidden />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:bg-destructive/15 focus:text-destructive">
          <Icon name="Trash2" aria-hidden />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Nested submenu"
        hint="apps/app/src/components/plugin/ExperimentalFileLinkMenu.tsx + ExperimentalFileLink.tsx — ContextMenuTrigger wraps the target row; ContextMenuSub/SubTrigger/SubContent nests an 'Open with' picker. Right-click the dashed box to open"
      >
        <FileActionsDemo />
      </StoryRow>
      <StoryRow
        label="Destructive item"
        hint="apps/app/src/components/project/ProjectActionsMenu.tsx via apps/app/src/components/ui/action-menu-items.tsx — the repo's shared action-menu-item helper styles a trailing destructive action in red; the same helper renders these exact items as a DropdownMenu on touch surfaces (see shared-ui/DropdownMenu). Right-click the dashed box to open"
      >
        <RowActionsDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/context-menu.stories.tsx' -o /tmp/ladle-verify-context-menu`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 4: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-context-menu && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-context-menu/meta.json`
Expected: exit code 0 for the build, and `"shared-ui--contextmenu--overview"` present among the grep's matches.

- [ ] **Step 5: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/context-menu.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 6: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/ContextMenu` in the browser. Right-click each dashed box (Review Focus: no visible affordance otherwise) and confirm the menu opens without escaping the `StoryRow` grid (Review Focus: portal escaping the grid). For "Nested submenu," hover "Open with" and confirm the submenu opens to the side. For "Destructive item," confirm "Remove" renders in a distinct (red) color, then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-ui/src/components/ui/context-menu.stories.tsx
git commit -m "Add a shared-ui/ContextMenu Ladle story from real app usage"
```

---

## Follow-up plans (not in this plan's scope)

- **Tier 4** (everything else with nonzero usage) and **Tier 5** (zero-usage components) — per tier 1's own follow-up note, likely want a batching/parallelization strategy of their own given the volume.
- **Components with partial pre-existing coverage** (`Button`, `Input`, `ResourceList`, `Switch`, `EmptyState` — real story coverage today, but scattered across `apps/app/**/*.stories.tsx` rather than a `packages/shared-ui` `Overview`) are a different task shape than "zero coverage" components: the task is consolidating/porting an existing story's real pattern into the new convention, not deriving one from scratch. Not addressed by this plan; flagged for whichever tier's plan reaches them.
- **`ContextMenu`'s checkbox/radio/label/group variants** (real usage in `plugins/tasks/views/list/property-menus.tsx`) were left out of Task 3 as too app-state-specific for a static demo — revisit if a later tier's pass at "partial pre-existing coverage" components reaches property-menus-style filter UIs.
- Three small deferred items carried over from tier 2, still unaddressed: `ladle build` exits 0 even when a story fails to bundle; the plan's own verification steps litter `apps/app/tmp/` with untracked build output per tier; the "verify typecheck and lint" step (renamed to just "verify typecheck" in this plan, see Global Constraints) is a reminder that `@bb/shared-ui` has no lint script at all.

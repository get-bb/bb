# shared-ui component catalog — tier 2 (Tooltip/Tabs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the second priority tier of the shared-ui component catalog — real, composed-usage Ladle `Overview` stories for the `Tooltip` and `Tabs` component families in `packages/shared-ui` — reusing the pipeline tier 1 already built, unchanged.

**Architecture:** No new infrastructure. Tier 1 (`packages/shared-ui/src/lib/story-card.tsx`, the `ladle build` CI gate scoped to `packages/shared-ui/src/components/ui/*.stories.tsx`, the `AGENTS.md` convention) already covers this tier and every later one. This plan is exactly two tasks, one per component family, each repeating tier 1's per-file recipe: grep `plugins/*` for real usage, write one `Overview` story, verify with a scoped `ladle build`, confirm the story appears in the full build's `meta.json`, grep for leaked plugin-only imports, commit.

**Tech Stack:** React, Radix UI primitives (`@radix-ui/react-tooltip`, `@radix-ui/react-tabs`), Ladle (`@ladle/react`), Turborepo, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-09-25-shared-ui-component-catalog-design.md](../specs/2026-09-25-shared-ui-component-catalog-design.md)

**Prior art:** [docs/superpowers/plans/2026-09-25-shared-ui-component-catalog-tier1.md](../plans/2026-09-25-shared-ui-component-catalog-tier1.md) — the executed tier-1 plan this one copies its recipe from verbatim.

## Global Constraints

- Story file path: `packages/shared-ui/src/components/ui/<name>.stories.tsx`, co-located with the component it exercises (spec "Location and format").
- Story title: the literal string `"shared-ui/<Name>"` (spec "Location and format").
- Exactly one `Overview` export per component file. Use `StoryCard`/`StoryRow` (`../../lib/story-card`, from tier 1) when the component has more than one real pattern worth showing; otherwise render it plainly. No atomic per-state split, no story-count cap (spec "Content convention").
- Every story must be derived from a real call site: grep `plugins/*` first (primary source), `apps/app/**/*.stories.tsx` second (secondary source). This tier's priority order — Tooltip subparts, then Tabs\* — comes from the spec's install-weighted marketplace-plugin survey, not from a same-session in-repo usage count; do not re-rank components within this plan based on raw grep hit counts (spec "Scope and priority order").
- Compound components must always be shown composed with their sibling sub-parts, never in isolation (spec "Content convention"). `Tooltip` cannot render its content without a `TooltipTrigger` and (per this tier's Review Focus below) a `TooltipProvider`; `Tabs` cannot render without a `TabsList`/`TabsTrigger`.
- CI gate is `ladle build` succeeding for `packages/shared-ui/**/*.stories.tsx` — a build-health check only. It does not enforce coverage or freshness (spec "CI"). No changes to the gate itself are needed this tier — the existing glob (`apps/app/.ladle/config.mjs`) already matches any new `*.stories.tsx` file under `packages/shared-ui/src/components/ui/`.
- `Icon` and `Textarea` ([PR #4286](https://github.com/get-bb/bb/pull/4286)) remain out of scope. `Select`, `Dialog`, `DropdownMenu` are already done (tier 1). `Popover`/`Command`/`ContextMenu` are tier 3, not this plan.

## Review Focus

- **A `Tooltip` story rendered without its own `TooltipProvider` wrapper.** Every real call site found (`plugins/tasks/shell/topbar.tsx`, `plugins/thread-list/app/rows/SidebarRowControls.tsx`, `plugins/automations/detail-view.tsx`, `plugins/docs/app.tsx`) wraps in a `TooltipProvider` somewhere in its own tree — in `docs/app.tsx` that wrapper is ~100 lines above the specific `Tooltip` usage, easy to miss when copying just the local snippet. Ladle renders each story with no ambient provider, so an unwrapped `Tooltip`/`TooltipTrigger` in this catalog would silently fail to open on hover at all — a materially different (and broken-looking) result from the real app. Task 1's demos must each wrap locally in `TooltipProvider`.
- **`TooltipContent` escaping the `StoryRow` grid when opened.** `tooltip.tsx:45` confirms `TooltipContent` renders through `TooltipPrimitive.Portal` to `document.body` — the same portal-escape risk tier 1 flagged for Select/Dialog/DropdownMenu. Task 1 includes a manual `ladle serve` check for this.
- **The controlled "Tabs as navigation" pattern (`plugins/github/app.tsx`) rendering an apparently empty or broken tab bar in the catalog.** That real call site drives page content from an external route, not from `TabsContent` — pasted verbatim into a story, `TabsList`/`TabsTrigger` alone would render with nothing visibly changing when a trigger is clicked, looking like a bug in the story rather than a deliberate pattern. Task 2's second demo must pair the controlled `Tabs` with a small piece of visible state-driven output next to it, while staying honest that the pattern itself doesn't use `TabsContent`.
- **A story importing a plugin-SDK-only or plugin-local dependency** because its real call site used one (e.g. `useTasksRefresh`, `AutomationLifecycleControlProps`, a relative import into `plugins/*`). `packages/shared-ui` cannot depend on plugin code. Both tasks end with a grep confirming the new story file has no such import.
- **A story silently not appearing in the full catalog build** — a typo in the file path or in the required `Overview` export name would leave `ladle build` green (build-health only, per spec) while the component quietly has no browsable story. Both tasks confirm the story's title string appears in the full build's bundled output, same check as tier 1's Task 3 Step 4.

---

## Task 1: author-tooltip-stories

`packages/shared-ui/src/components/ui/tooltip.tsx` exports 4 symbols: `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`. Real usage covers two distinct shapes. `plugins/tasks/shell/topbar.tsx` (`RefreshTasksButton`) shows an icon-only ghost button as the trigger, with `disableHoverableContent` and a bottom-side tooltip repeating the button's own `aria-label` — the common "icon button needs a visible label" pattern also seen in `plugins/thread-list/app/rows/SidebarRowControls.tsx`. `plugins/automations/detail-view.tsx` (`AutomationLifecycleControl`) shows the other real shape: a disabled `Switch` wrapped in a focusable `<span tabIndex={0}>` (a disabled form control cannot itself receive hover/focus reliably, so the wrapping span is the actual `TooltipTrigger`) explaining, via `disabledReason`, why the control is disabled.

**Files:**
- Create: `packages/shared-ui/src/components/ui/tooltip.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card` (tier 1); `Button` from `./button.js`; `Icon` from `./icon.js`; `Switch` from `./switch.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/tooltip.stories.tsx`:

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Switch } from "./switch.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Tooltip",
};

function IconButtonTooltipDemo() {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh tasks"
          >
            <Icon name="RotateCcw" className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Refresh tasks</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DisabledControlTooltipDemo() {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex cursor-not-allowed rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            tabIndex={0}
            aria-label="Run automation on schedule. Disabled: no environment variables configured."
          >
            <Switch
              checked={false}
              disabled
              aria-label="Run automation on schedule"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          Disabled: no environment variables configured.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Icon button"
        hint="plugins/tasks/shell/topbar.tsx — a ghost icon button with a bottom tooltip repeating its own aria-label, disableHoverableContent"
      >
        <IconButtonTooltipDemo />
      </StoryRow>
      <StoryRow
        label="Disabled control"
        hint="plugins/automations/detail-view.tsx — a focusable span wraps a disabled Switch so the reason it's disabled is still reachable by keyboard and screen readers"
      >
        <DisabledControlTooltipDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/tooltip.stories.tsx' -o /tmp/ladle-verify-tooltip`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm exec turbo run typecheck lint --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 4: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-tooltip && grep -rl "shared-ui/Tooltip" /tmp/ladle-verify-full-tooltip`
Expected: exit code 0 for the build, and at least one match from the `grep` (Review Focus: a story silently not appearing in the full build).

- [ ] **Step 5: Confirm no plugin dependency leaked in**

Run: `grep -nE '@get-bb/plugin-sdk|from "@/|plugins/' packages/shared-ui/src/components/ui/tooltip.stories.tsx`
Expected: no output. The story above uses local static strings instead of the plugin's real `useTasksRefresh`/`AutomationLifecycleControlProps`.

- [ ] **Step 6: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Tooltip` in the browser, and hover (or focus via Tab) each of the two triggers. Confirm each tooltip opens without visually breaking out of the `StoryRow` layout (Review Focus: `TooltipContent` escaping the grid via its portal), then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-ui/src/components/ui/tooltip.stories.tsx
git commit -m "Add a shared-ui/Tooltip Ladle story from real plugin usage"
```

---

## Task 2: author-tabs-stories

`packages/shared-ui/src/components/ui/tabs.tsx` exports 4 symbols: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`. Real usage covers two distinct shapes. `plugins/tasks/views/manage/manage-panel.tsx` shows the ordinary shape — an uncontrolled `Tabs defaultValue="labels"` switching between three `TabsContent` panels (`LabelsSection`/`PresetsSection`/`FoldersSection`, simplified below to short representative text since those are plugin-local components). `plugins/github/app.tsx` shows a different real shape: a controlled `Tabs value={route.view} onValueChange={...}` used purely as a segmented navigation control — `TabsList`/`TabsTrigger` only, no `TabsContent`, because the actual page content is driven by the app's router rather than by Radix's tab-panel mechanism.

**Files:**
- Create: `packages/shared-ui/src/components/ui/tabs.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card` (tier 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/tabs.stories.tsx`:

```tsx
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Tabs",
};

function ContentSwitcherDemo() {
  return (
    <Tabs defaultValue="labels" className="w-72">
      <TabsList>
        <TabsTrigger value="labels">Labels</TabsTrigger>
        <TabsTrigger value="presets">Presets</TabsTrigger>
        <TabsTrigger value="folders">Folders</TabsTrigger>
      </TabsList>
      <TabsContent
        value="labels"
        className="pt-3 text-sm text-muted-foreground"
      >
        Manage the labels used across tasks.
      </TabsContent>
      <TabsContent
        value="presets"
        className="pt-3 text-sm text-muted-foreground"
      >
        Manage agent presets.
      </TabsContent>
      <TabsContent
        value="folders"
        className="pt-3 text-sm text-muted-foreground"
      >
        Manage folders.
      </TabsContent>
    </Tabs>
  );
}

function NavigationDemo() {
  const [view, setView] = useState("issues");
  return (
    <div className="flex w-72 flex-col gap-3">
      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="pulls">Pull requests</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground">
        {view === "issues"
          ? "Showing open issues."
          : "Showing open pull requests."}
      </p>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Content switcher"
        hint="plugins/tasks/views/manage/manage-panel.tsx — an uncontrolled Tabs with TabsContent panels, simplified"
      >
        <ContentSwitcherDemo />
      </StoryRow>
      <StoryRow
        label="Navigation control"
        hint="plugins/github/app.tsx — a controlled Tabs used as a segmented nav; the selected view drives content rendered outside Tabs, not TabsContent"
      >
        <NavigationDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/tabs.stories.tsx' -o /tmp/ladle-verify-tabs`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm exec turbo run typecheck lint --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 4: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-tabs && grep -rl "shared-ui/Tabs" /tmp/ladle-verify-full-tabs`
Expected: exit code 0 for the build, and at least one match from the `grep`.

- [ ] **Step 5: Confirm no plugin dependency leaked in**

Run: `grep -nE '@get-bb/plugin-sdk|from "@/|plugins/' packages/shared-ui/src/components/ui/tabs.stories.tsx`
Expected: no output.

- [ ] **Step 6: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Tabs` in the browser. For "Content switcher," click all three triggers and confirm the panel text changes each time. For "Navigation control," click "Pull requests" and confirm the paragraph below the tabs updates to "Showing open pull requests." (Review Focus: confirming the no-`TabsContent` pattern doesn't read as a broken/empty tab bar), then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-ui/src/components/ui/tabs.stories.tsx
git commit -m "Add a shared-ui/Tabs Ladle story from real plugin usage"
```

---

## Follow-up plans (not in this plan's scope)

- **Tier 3** (Popover\*/Command\*/ContextMenu\*) — separate plan, same per-file task shape as Tasks 1-2 above.
- **Tier 4** (everything else with nonzero usage) and **Tier 5** (zero-usage components) — per tier 1's own follow-up note, likely want a batching/parallelization strategy of their own given the volume.
- **Components with partial pre-existing coverage** (`Button`, `Input`, `ResourceList`, `Switch`, `EmptyState` — real story coverage today, but scattered across `apps/app/**/*.stories.tsx` rather than a `packages/shared-ui` `Overview`) are a different task shape than "zero coverage" components: the task is consolidating/porting an existing story's real pattern into the new convention, not deriving one from scratch. Not addressed by this plan; flagged for whichever tier's plan reaches them.

# shared-ui component catalog — tier 1 (Select/DropdownMenu/Dialog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first priority tier of the shared-ui component catalog — real, composed-usage Ladle `Overview` stories for the `Select`, `Dialog`, and `DropdownMenu` component families in `packages/shared-ui` — plus the reusable pipeline (build gate, shared story helper, contributor convention) that every later tier reuses unchanged.

**Architecture:** This plan does not attempt all 253 components at once. It builds the pipeline once (a relocated `StoryCard`/`StoryRow` helper that `packages/shared-ui` can use without depending on `apps/app`, a `ladle build` CI gate scoped to `packages/shared-ui/**/*.stories.tsx`, and an `AGENTS.md` convention line), then authors exactly the three component families the spec's priority order puts first. Each later tier (Tooltip/Tabs, Popover/Command/ContextMenu, the long tail, zero-usage components) is a separate follow-up plan that repeats the same per-file task shape established here — grep `plugins/*` for real usage, write one `Overview` story, verify with a scoped `ladle build`, commit.

**Tech Stack:** React, Radix UI primitives (`@radix-ui/react-select`, `-dialog`, `-dropdown-menu`), Ladle (`@ladle/react`), Turborepo, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-09-25-shared-ui-component-catalog-design.md](../specs/2026-09-25-shared-ui-component-catalog-design.md)

## Global Constraints

- Story file path: `packages/shared-ui/src/components/ui/<name>.stories.tsx`, co-located with the component it exercises (spec "Location and format").
- Story title: the literal string `"shared-ui/<Name>"` (spec "Location and format").
- Exactly one `Overview` export per component file. Use `StoryCard`/`StoryRow` when the component has more than one real pattern worth showing; otherwise render it plainly. No atomic per-state split, no story-count cap — those existed only to serve a design-sync grading pipeline this effort has dropped (spec "Content convention").
- Every story must be derived from a real call site: grep `plugins/*` first (primary source), `apps/app/**/*.stories.tsx` second (secondary source). Compound components — `Select`, `DropdownMenu`, `Dialog`, and similar — must always be shown composed with their sibling sub-parts, never in isolation; they cannot render meaningfully alone anyway (spec "Content convention").
- Zero-usage components get a single plausible render using the component's own default/example props. Not applicable to this plan — all three tier-1 families have real usage in `plugins/*` (spec "Content convention").
- CI gate is `ladle build` succeeding for `packages/shared-ui/**/*.stories.tsx` — a build-health check only. It does not enforce coverage (a missing story doesn't fail CI) or freshness (a drifted story doesn't fail CI) (spec "CI").
- `Icon` and `Textarea` ([PR #4286](https://github.com/get-bb/bb/pull/4286), now closed) are explicitly out of scope for this effort. Do not touch `packages/shared-ui/src/components/ui/icon.stories.tsx` or `textarea.stories.tsx` in this plan (spec "Scope and priority order").

## Review Focus

- **A compound component shown in isolation.** The spec's most load-bearing rule (`<Icon name="Plus" />` alone tells a plugin author nothing) extends to Select/Dialog/DropdownMenu: a `SelectTrigger` with no real `SelectContent`/`SelectItem`s, or a `DropdownMenuContent` with placeholder items instead of a real menu shape, would ship something that compiles but teaches nothing. Every `StoryRow` in Tasks 3-5 must combine the trigger with its real content/items, matching a concrete `plugins/*` call site named in that task.
- **A portal-based overlay (`SelectContent`/`DialogContent`/`DropdownMenuContent`) escaping the `StoryCard`/`StoryRow` grid when opened.** All three components portal to `document.body` via their Radix primitive, which can visually break out of a side-by-side row layout. Tasks 3-5 each include a manual `ladle serve` check for this.
- **The `ladle build` CI gate silently matching zero files** if the new glob path in `apps/app/.ladle/config.mjs` is mistyped — CI would stay green while gating nothing. Task 3 verifies the glob actually picks up the new file by grepping the full (non-scoped) build output for the new story's title.
- **A duplicate story-ID collision from a pnpm-symlinked vendored copy of `@bb/shared-ui` under `node_modules`** — the exact failure [PR #4286](https://github.com/get-bb/bb/pull/4286) hit when it first added a `packages/shared-ui` stories glob. Task 2 calls this out explicitly with the fix if it recurs.
- **A story importing a plugin-SDK-only or plugin-local dependency** (e.g. `experimental_useSidebarThreadActions`, `@get-bb/plugin-sdk/app`, a relative import into `plugins/*`) because its real call site used one. `packages/shared-ui` cannot depend on plugin code. Tasks 3-5 each end with a grep confirming the new story file has no such import.

---

## Task: relocate-story-card-helper

`StoryCard`/`StoryRow` (`apps/app/.ladle/story-card.tsx`) is the layout helper every `Overview` story in this plan needs. It currently lives in `apps/app`, but its only dependency is `cn` from `@bb/shared-ui/lib/utils` — nothing app-specific. A `packages/shared-ui` story importing it from `apps/app/.ladle/story-card` would invert the monorepo's dependency direction (a package depending on the app that consumes it) and reach across a relative path five directories up and back down. Relocate the canonical implementation into `packages/shared-ui`, and leave a re-export shim at the old path so the 95 existing `apps/app` consumers need no changes.

**Files:**
- Create: `packages/shared-ui/src/lib/story-card.tsx`
- Modify: `apps/app/.ladle/story-card.tsx` (becomes a two-line re-export shim)
- Modify: `packages/shared-ui/package.json` (new `./lib/story-card` export subpath)

**Interfaces:**
- Produces: `StoryCard(props: { children, className?, labelWidth?, columns?: readonly string[], valueAlign?: "start" | "end" })` and `StoryRow(props: { label: ReactNode, hint?: ReactNode, children: ReactNode, className?: string })`, importable from `../../lib/story-card` by any file under `packages/shared-ui/src/components/ui/`, and from `@bb/shared-ui/lib/story-card` by `apps/app`. Tasks 3-5 consume both.

- [ ] **Step 1: Create the relocated helper**

Create `packages/shared-ui/src/lib/story-card.tsx` with the same implementation as the current `apps/app/.ladle/story-card.tsx`, changing only the `cn` import to the sibling-file relative form already used by every other file in `packages/shared-ui/src/lib/` (no `.js` extension — matches `dialog.tsx`'s `import { cn } from "../../lib/utils";`):

```tsx
import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "./utils";

const ROW_GRID =
  "grid grid-cols-[var(--story-label-width,210px)_minmax(0,1fr)] gap-x-4";

function labelWidthStyle(
  labelWidth: string | undefined,
): CSSProperties | undefined {
  if (!labelWidth) return undefined;
  return { "--story-label-width": labelWidth } as CSSProperties;
}

type ValueAlign = "start" | "end";

const StoryCardContext = createContext<{
  inGrid: boolean;
  valueAlign: ValueAlign;
}>({
  inGrid: false,
  valueAlign: "start",
});

interface StoryCardProps {
  children: ReactNode;
  className?: string;
  labelWidth?: string;
  columns?: readonly string[];
  valueAlign?: ValueAlign;
}

export function StoryCard({
  children,
  className,
  labelWidth,
  columns,
  valueAlign = "start",
}: StoryCardProps) {
  if (columns && columns.length > 0) {
    const style: CSSProperties = {
      "--story-label-width": labelWidth ?? "210px",
      gridTemplateColumns: `var(--story-label-width) repeat(${columns.length}, minmax(max-content, 1fr))`,
    } as CSSProperties;
    return (
      <StoryCardContext.Provider value={{ inGrid: true, valueAlign }}>
        <div
          className={cn(
            "m-6 grid items-center gap-x-4 gap-y-3 rounded-md px-4 py-3",
            valueAlign === "end" ? "justify-items-end" : "justify-items-start",
            className,
          )}
          style={style}
        >
          <span aria-hidden="true" />
          {columns.map((column, index) => (
            <span
              key={index}
              className="text-xs font-medium text-muted-foreground"
            >
              {column}
            </span>
          ))}
          {children}
        </div>
      </StoryCardContext.Provider>
    );
  }
  return (
    <StoryCardContext.Provider value={{ inGrid: false, valueAlign }}>
      <div
        className={cn("m-6 flex flex-col rounded-md", className)}
        style={labelWidthStyle(labelWidth)}
      >
        {children}
      </div>
    </StoryCardContext.Provider>
  );
}

interface StoryRowProps {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function StoryRow({ label, hint, children, className }: StoryRowProps) {
  const { inGrid, valueAlign } = useContext(StoryCardContext);

  const labelEl = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {hint ? (
        <span className="text-xs break-words text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );

  if (inGrid) {
    return (
      <>
        {labelEl}
        {children}
      </>
    );
  }
  return (
    <div className={cn(ROW_GRID, "items-start px-4 py-3", className)}>
      {labelEl}
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-3",
          valueAlign === "end" && "justify-end",
        )}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Shim the old location**

Replace the entire contents of `apps/app/.ladle/story-card.tsx` with:

```tsx
export { StoryCard, StoryRow } from "@bb/shared-ui/lib/story-card";
```

- [ ] **Step 3: Add the package export**

In `packages/shared-ui/package.json`, add a new entry next to the existing `"./lib/portal-scope"` entry (same shape as the other `./lib/*` exports):

```json
    "./lib/story-card": {
      "source": "./src/lib/story-card.tsx",
      "types": "./src/lib/story-card.tsx",
      "default": "./src/lib/story-card.tsx"
    },
```

- [ ] **Step 4: Typecheck both packages**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --filter=@bb/app --output-logs=new-only`
Expected: 0 errors. This confirms the shim resolves and all 95 existing `apps/app` consumers of `StoryCard`/`StoryRow` still compile against the new indirection.

- [ ] **Step 5: Confirm an existing consumer still builds through the shim**

Run: `pnpm --filter @bb/app exec ladle build --stories src/components/ui/icon.stories.tsx -o /tmp/ladle-verify-shim`
Expected: exit code 0. `icon.stories.tsx` uses `StoryCard`/`StoryRow` today; a successful scoped build proves the re-export shim works end to end, not just at the type level.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-ui/src/lib/story-card.tsx packages/shared-ui/package.json apps/app/.ladle/story-card.tsx
git commit -m "Move StoryCard/StoryRow into shared-ui so shared-ui stories can use it"
```

---

## Task: wire-ladle-build-gate

Add the CI build-health gate the spec requires, and the `AGENTS.md` maintenance line. `apps/app/package.json` already has a `"storybook:build": "ladle build"` script and `/apps/app/build/` is already gitignored — this task only needs to point Ladle's `stories` glob at `packages/shared-ui`, give Turbo a cacheable task name for the script, and run it in CI.

**Files:**
- Modify: `apps/app/.ladle/config.mjs` (add the `packages/shared-ui` stories glob)
- Modify: `turbo.json` (new `storybook:build` task)
- Modify: `.github/workflows/ci.yml` (run `storybook:build` in the existing combined step)
- Modify: `AGENTS.md` (convention line in `## UI`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: a working `pnpm exec turbo run storybook:build` task that Task 3's verification step depends on to confirm the glob actually picks up new files.

- [ ] **Step 1: Add the shared-ui stories glob**

In `apps/app/.ladle/config.mjs`, add one line to the `stories` array (after the existing `"src/**/*.stories.tsx"` entry):

```js
  stories: [
    "src/**/*.stories.tsx",
    "../../packages/shared-ui/src/components/ui/*.stories.tsx",
    "../../plugins/automations/*.stories.tsx",
    "../../plugins/workflows/**/*.stories.tsx",
    "../../plugins/provider-usage/*.stories.tsx",
  ],
```

Note: this glob is scoped to `.../ui/*.stories.tsx` (one level, not `**`) so it cannot accidentally reach into a `node_modules` copy of `@bb/shared-ui` nested under `packages/shared-ui`. If the build in Step 5 fails with a duplicate story ID error naming a `node_modules` path, that means a pnpm-symlinked vendored copy is being matched anyway — [PR #4286](https://github.com/get-bb/bb/pull/4286) hit exactly this and fixed it by adding explicit `node_modules` exclusion patterns to this same array; do the same here if it recurs.

- [ ] **Step 2: Add the Turbo task**

In `turbo.json`, add a new task entry next to the existing `"storybook"` entry:

```json
    "storybook:build": {
      "dependsOn": ["@bb/templates#generate:templates"],
      "outputs": ["build/**"]
    },
```

- [ ] **Step 3: Run the gate in CI**

In `.github/workflows/ci.yml`, change the existing "Build, typecheck, and lint" step in the `checks` job to also run `storybook:build`:

```yaml
      - name: Build, typecheck, lint, and story catalog build
        run: pnpm exec turbo run build typecheck lint storybook:build --cache-dir=.turbo/cache --output-logs=new-only --concurrency=4
```

- [ ] **Step 4: Add the AGENTS.md convention line**

In `AGENTS.md`, add one bullet to the end of the `## UI` section:

```markdown
- Add or update a `packages/shared-ui` component's Ladle story (`packages/shared-ui/src/components/ui/<name>.stories.tsx`) when you add the component or meaningfully change how it is used. `ladle build` only catches build breaks, not staleness — this convention is the only thing keeping stories current.
```

- [ ] **Step 5: Verify the gate doesn't break the existing build**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-gate`
Expected: exit code 0. No `packages/shared-ui` story files exist yet (Task 3 adds the first one), so this only proves the new glob and config change don't break the 112 existing app-level stories. It does not yet prove the gate can see `packages/shared-ui` files — that's confirmed in Task 3, Step 4.

- [ ] **Step 6: Commit**

```bash
git add apps/app/.ladle/config.mjs turbo.json .github/workflows/ci.yml AGENTS.md
git commit -m "Add a ladle build gate for packages/shared-ui stories"
```

---

## Task: author-select-stories

`packages/shared-ui/src/components/ui/select.tsx` exports 10 symbols: `Select`, `SelectGroup`, `SelectValue`, `SelectTrigger`, `SelectContent`, `SelectLabel`, `SelectItem`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton`. Real usage in `plugins/tasks/views/manage/preset-dialog.tsx` and `plugins/tasks/views/manage/new-project-dialog.tsx` covers three distinct patterns: a fixed-option select, a data-driven select with a synthetic default value, and a select with a separator dividing a list from a trailing action item. `SelectScrollUpButton`/`SelectScrollDownButton` render automatically inside `SelectContent` when a list overflows and are never referenced directly by any real call site — they don't need their own row. `SelectGroup`/`SelectLabel` have no clean non-plugin-specific real usage (the one hit, `plugins/theme-preview/app.tsx`, wraps items in a plugin-local `ThemeOption` swatch component) — leave them out of this `Overview`; note the gap rather than fabricate a pattern with no real basis.

**Files:**
- Create: `packages/shared-ui/src/components/ui/select.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/select.stories.tsx`:

```tsx
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Select",
};

const ENVIRONMENT_LABELS: Record<string, string> = {
  "project-default": "Project default",
  "new-worktree": "New worktree",
};

function EnvironmentKindSelect() {
  const [value, setValue] = useState("project-default");
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Execution environment" className="h-8 w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(ENVIRONMENT_LABELS).map(([kind, label]) => (
          <SelectItem key={kind} value={kind}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const MACHINES = [
  { id: "m_local", name: "Local" },
  { id: "m_prod-1", name: "prod-1" },
];
const DEFAULT_MACHINE_VALUE = "__default-machine__";

function MachineSelect() {
  const [value, setValue] = useState(DEFAULT_MACHINE_VALUE);
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Machine" className="h-8 w-56">
        <SelectValue placeholder="Machine" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MACHINE_VALUE}>Default machine</SelectItem>
        {MACHINES.map((machine) => (
          <SelectItem key={machine.id} value={machine.id}>
            {machine.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const FOLDERS = [
  { id: "f_design", name: "Design" },
  { id: "f_backend", name: "Backend" },
];
const NO_FOLDER = "__no-folder__";
const NEW_FOLDER = "__new-folder__";

function FolderSelect() {
  const [value, setValue] = useState(NO_FOLDER);
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Folder" className="h-8 w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FOLDER}>No folder</SelectItem>
        {FOLDERS.map((folder) => (
          <SelectItem key={folder.id} value={folder.id}>
            {folder.name}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={NEW_FOLDER}>New folder…</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Execution environment"
        hint="plugins/tasks/views/manage/preset-dialog.tsx — a fixed set of options"
      >
        <EnvironmentKindSelect />
      </StoryRow>
      <StoryRow
        label="Machine"
        hint="plugins/tasks/views/manage/preset-dialog.tsx — a data-driven list with a synthetic default value"
      >
        <MachineSelect />
      </StoryRow>
      <StoryRow
        label="Folder"
        hint="plugins/tasks/views/manage/new-project-dialog.tsx — a separator dividing a list from a trailing action item"
      >
        <FolderSelect />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/select.stories.tsx' -o /tmp/ladle-verify-select`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm exec turbo run typecheck lint --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 4: Confirm the CI gate's glob actually picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-select && grep -rl "shared-ui/Select" /tmp/ladle-verify-full-select`
Expected: exit code 0 for the build, and at least one match from the `grep` (the literal story title string bundled into the build output). This is the Review Focus check that the `stories` glob added in the previous task isn't silently matching zero files.

- [ ] **Step 5: Confirm no plugin dependency leaked in**

Run: `grep -nE '@get-bb/plugin-sdk|from "@/|plugins/' packages/shared-ui/src/components/ui/select.stories.tsx`
Expected: no output. `packages/shared-ui` cannot depend on plugin-only code; the story above uses local static data instead of the plugin's real `useTasksQuery`/`listMachines` RPC call.

- [ ] **Step 6: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Select` in the browser, and click each of the three triggers. Confirm each dropdown opens without visually breaking out of the `StoryRow` layout (Review Focus: portal-based overlays escaping the grid), then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-ui/src/components/ui/select.stories.tsx
git commit -m "Add a shared-ui/Select Ladle story from real plugin usage"
```

---

## Task: author-dialog-stories

`packages/shared-ui/src/components/ui/dialog.tsx` exports 9 symbols: `Dialog`, `DialogOverlay`, `DialogTrigger`, `DialogClose`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`. `DialogOverlay` renders automatically inside `DialogContent` (`dialog.tsx:254`) and is never referenced directly by real call sites — it doesn't need its own row. Real usage covers two distinct shapes: a confirm-style dialog (`plugins/tasks/components/confirm-dialog.tsx`) and a form-style dialog with fields in the body (`plugins/tasks/views/manage/preset-dialog.tsx`, simplified to drop plugin-SDK-only pickers). `plugins/theme-preview/app.tsx` and `plugins/account-pool/app.tsx` show `Dialog` used uncontrolled with `DialogTrigger asChild` and `DialogClose asChild` rather than manually tracked `open` state — use that pattern; it's both more real and simpler than manual state.

**Files:**
- Create: `packages/shared-ui/src/components/ui/dialog.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card` (Task 1); `Button` from `./button.js`; `Input` from `./input.js`; `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` from `./select.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/dialog.stories.tsx`:

```tsx
import { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Dialog",
};

function ConfirmDialogDemo() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Delete project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete project?</DialogTitle>
          <DialogDescription>
            This removes the project and its presets. Threads already created
            from it are not affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" size="sm">
              Delete
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormDialogDemo() {
  const [name, setName] = useState("");
  const [environmentKind, setEnvironmentKind] = useState("project-default");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">New preset</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New preset</DialogTitle>
          <DialogDescription>
            Presets pick the provider, model, and guardrails for dispatched
            threads.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Name</label>
            <Input
              autoFocus
              value={name}
              placeholder="e.g. Sonnet · high"
              onChange={(event) => setName(event.target.value)}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">
              Execution environment
            </label>
            <Select value={environmentKind} onValueChange={setEnvironmentKind}>
              <SelectTrigger aria-label="Execution environment" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project-default">
                  Project default
                </SelectItem>
                <SelectItem value="new-worktree">New worktree</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button size="sm">Create preset</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Confirm dialog"
        hint="plugins/tasks/components/confirm-dialog.tsx — title, description, cancel/destructive footer"
      >
        <ConfirmDialogDemo />
      </StoryRow>
      <StoryRow
        label="Form dialog"
        hint="plugins/tasks/views/manage/preset-dialog.tsx — fields composed inside the dialog body, simplified"
      >
        <FormDialogDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/dialog.stories.tsx' -o /tmp/ladle-verify-dialog`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm exec turbo run typecheck lint --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 4: Confirm no plugin dependency leaked in**

Run: `grep -nE '@get-bb/plugin-sdk|from "@/|plugins/' packages/shared-ui/src/components/ui/dialog.stories.tsx`
Expected: no output.

- [ ] **Step 5: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Dialog`, and click both triggers. Confirm each dialog opens centered over the page (not confined to or clipped by the `StoryRow` cell it was triggered from) and that `Cancel`/`Delete`/`Create preset` all close it, then stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-ui/src/components/ui/dialog.stories.tsx
git commit -m "Add a shared-ui/Dialog Ladle story from real plugin usage"
```

---

## Task: author-dropdown-menu-stories

`packages/shared-ui/src/components/ui/dropdown-menu.tsx` exports 15 symbols. Real usage in `plugins/thread-list/app/rows/ThreadActionsMenu.tsx` shows an icon-triggered actions menu with plain items, a submenu (`DropdownMenuSub`/`SubTrigger`/`SubContent`), a separator, and a destructive item (`variant="destructive"` on `DropdownMenuItem`, confirmed at `dropdown-menu.tsx:203`). `plugins/tasks/views/list/filter-bar.tsx` shows `DropdownMenuCheckboxItem` used as a single-select toggle group with a `mobileTitle` on `DropdownMenuContent`. `DropdownMenuSubTrigger` renders its own trailing chevron automatically (`dropdown-menu.tsx:599`) — do not add a second one. `DropdownMenuRadioItem`/`DropdownMenuRadioGroup`/`DropdownMenuLabel`/`DropdownMenuShortcut`/`DropdownMenuGroup`/`DropdownMenuPortal` have no real usage found in `plugins/*` — leave them out of this `Overview` rather than fabricate a pattern.

**Files:**
- Create: `packages/shared-ui/src/components/ui/dropdown-menu.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card` (Task 1); `Button` from `./button.js`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/dropdown-menu.stories.tsx`:

```tsx
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/DropdownMenu",
};

const SECTIONS = ["Threads", "Backlog", "Done"];

function ActionsMenuDemo() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Thread actions"
        >
          <Icon name="MoreHorizontal" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          <Icon name="Copy" aria-hidden="true" />
          Copy thread link
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Icon name="Edit" aria-hidden="true" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="SectionMove" aria-hidden="true" />
            Move to section
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {SECTIONS.map((section) => (
              <DropdownMenuItem key={section}>{section}</DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Icon name="Trash2" aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SORTS = ["Priority", "Recently updated", "Alphabetical"] as const;

function SortMenuDemo() {
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Priority");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Sort: {sort}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        mobileTitle="Sort tasks"
      >
        {SORTS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={sort === option}
            onCheckedChange={(checked) => {
              if (checked) setSort(option);
            }}
          >
            {option}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Actions menu"
        hint="plugins/thread-list/app/rows/ThreadActionsMenu.tsx — icon items, a submenu, and a destructive item"
      >
        <ActionsMenuDemo />
      </StoryRow>
      <StoryRow
        label="Sort menu"
        hint="plugins/tasks/views/list/filter-bar.tsx — checkbox items used as a single-select toggle group"
      >
        <SortMenuDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/dropdown-menu.stories.tsx' -o /tmp/ladle-verify-dropdown-menu`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm exec turbo run typecheck lint --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 4: Confirm no plugin dependency leaked in**

Run: `grep -nE '@get-bb/plugin-sdk|from "@/|plugins/' packages/shared-ui/src/components/ui/dropdown-menu.stories.tsx`
Expected: no output.

- [ ] **Step 5: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/DropdownMenu`, and open both menus. For the actions menu, hover "Move to section" and confirm the submenu opens to the side without breaking the row layout. For the sort menu, click a different option and confirm the trigger label and checkmark update. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-ui/src/components/ui/dropdown-menu.stories.tsx
git commit -m "Add a shared-ui/DropdownMenu Ladle story from real plugin usage"
```

---

## Follow-up plans (not in this plan's scope)

- **Tier 2** (Tooltip subparts, Tabs\*) and **Tier 3** (Popover\*/Command\*/ContextMenu\*) — separate plans, same per-file task shape as Tasks 3-5 above: grep `plugins/*`, write one `Overview` story, verify with a scoped `ladle build`, confirm the CI glob and plugin-dependency checks, commit.
- **Tier 4** (everything else with nonzero usage, 79-82 components) and **Tier 5** (zero-usage components) — likely want a batching/parallelization strategy of their own given the volume; the spec's "Generation approach" section explicitly leaves this open.
- **Known gaps left in this plan's tier:** `SelectGroup`/`SelectLabel` (no clean non-plugin-specific real usage found) and `DropdownMenuRadioItem`/`DropdownMenuRadioGroup`/`DropdownMenuLabel`/`DropdownMenuShortcut`/`DropdownMenuGroup` (no real usage found at all). Revisit if a later tier's grep turns up real usage, or add a single plausible render if the "zero-usage" convention is judged to apply.
- **PR #4380's own fate** (spec-only, still open) — separate decision from this plan; see the parked handoff for context.

# shared-ui component catalog — tier 4 (everything else with nonzero usage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship real, composed-usage Ladle `Overview` stories for every remaining `packages/shared-ui` component with nonzero real usage (tiers 1-3 already covered Select/Dialog/DropdownMenu/Tooltip/Tabs/Popover/Command/ContextMenu) — 8 tasks, 17 story files, covering Button, five form controls, two loading-state components, the whole `Resource*` family, `WorkflowProgress`, `QuestionForm`, five misc single-use widgets, and `Pill`.

**Architecture:** No new infrastructure. Tier 1's pipeline (`packages/shared-ui/src/lib/story-card.tsx`, the `ladle build` CI gate, the `AGENTS.md` convention) already covers this tier. Unlike tiers 1-3 (one component family per task), this tier batches multiple small, thematically-related components into a single task where their real usage is genuinely related (e.g. RadioGroup+Checkbox+Switch all come from the same settings-form call site), and gives the one large family (`Resource*`) its own task producing a single co-located file with two `StoryRow`s (collection/browse, detail/activity) rather than splitting it across files — `Resource*`'s barrel export (`resource-list.tsx`) is the one file every real call site actually imports from.

**Tech Stack:** React, Radix UI primitives, `cva` (button/badge variants), Ladle (`@ladle/react`), Turborepo, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-09-25-shared-ui-component-catalog-design.md](../specs/2026-09-25-shared-ui-component-catalog-design.md)

**Prior art:** [docs/superpowers/plans/2026-09-27-shared-ui-component-catalog-tier3.md](../plans/2026-09-27-shared-ui-component-catalog-tier3.md) — the executed tier-3 plan this one copies its recipe and verification steps from, with two corrections folded in from the start (see Global Constraints) instead of rediscovered mid-execution, per that plan's own resume notes.

## Global Constraints

- Story file path: `packages/shared-ui/src/components/ui/<name>.stories.tsx`, co-located with the component's own source file (spec "Location and format"). For the `Resource*` family, "the component's own source file" is the barrel `resource-list.tsx` — every real call site imports the family through it, so the story is `resource-list.stories.tsx`, not one file per sub-symbol.
- Story title: the literal string `"shared-ui/<Name>"` (spec "Location and format").
- Exactly one `Overview` export per story file. Use `StoryCard`/`StoryRow` (`../../lib/story-card`) — plain (no `columns`) for label/value rows, `columns={...}` only for a true variant×size grid (Task 1 reuses this for Button, matching the existing `apps/app` precedent).
- Every story must be derived from a real call site: grep `plugins/*` first (primary source), `apps/app/**/*.stories.tsx` second (secondary source). **This tier's research finding, not previously true for tiers 1-3:** real plugin code never imports shared-ui via `@bb/shared-ui/<name>` — it imports via the app-local path alias `@/components/ui/<name>` (every plugin's `tsconfig.json` maps `@/*` straight at `packages/shared-ui/src/*`). When porting a real call site's JSX into a story, always swap that alias for shared-ui's own relative import (`./button.js`, not `@/components/ui/button` or `@bb/shared-ui/button`) — every task below already does this, it's called out here so it isn't silently "fixed" per-task as if newly discovered.
- Compound components must always be shown composed with their sibling sub-parts, never in isolation (spec "Content convention"). This is most load-bearing for `Resource*` (Task 4): `ResourceRow` needs a `ResourceListPanel` parent for its `divide-y` styling to mean anything, `ResourceCollectionPage` needs real content in its active mode's tabpanel, and `ResourceDetailPage` needs its `ResourceDetailStack` children to look like anything but an empty shell.
- Every real call site this tier touches app-internal-only or plugin-SDK-only dependencies that cannot be imported into `packages/shared-ui` (RPC/view types, `@get-bb/plugin-sdk/app` hooks, app-only hooks like `useAppCommandShortcuts`, plugin-local formatting helpers and wrapper components). Each task's own notes list exactly what to strip and what local `useState`/inline-fixture stand-in replaces it — this was resolved once during this plan's own research pass specifically so no task has to re-derive it from scratch or guess.
- Icon-name verification (tier-3 follow-up correction, not yet enforced by any prior tier's plan): before committing, confirm every `Icon name="..."` string used in new story code is a real key in `CORE_ICON_MAP` (`packages/shared-ui/src/components/ui/icon.tsx`) or `EXTENDED_ICON_NAMES` (`packages/shared-ui/src/components/ui/icon-extended.tsx`) — `IconName` is typed as plain `string`, so a typo silently renders a fallback glyph and typecheck won't catch it. Every icon name used in this plan's code has already been verified against those two files (`Archive`, `ArchiveRestore`, `Workflow`, `ChevronDown`, `ChevronRight`, `Edit`, `AlertCircle`, `Plus`, `Folder`, `DateTime`, `MessageSquare`, `CircleCheck`, `CircleX`, `Loading`, `Check`, `ArrowRight`, `Clock`, `Play`, `Trash2`, `Eye`, `EyeOff`, `Github` all confirmed present) — each task's own verification step re-confirms this mechanically rather than trusting that this list stays accurate if code changes during implementation.
- Hint length (tier-3 follow-up correction): keep every `hint` string under ~140 characters. Tier 3's hints ran up to 359 characters and made the `StoryRow` grid visibly ragged; every hint in this plan's task code is already within that budget.
- Verification correction 1 (tier 1/2, reconfirmed tier 3): confirming the full catalog build picked up a new story must use `grep -o '"shared-ui[^"]*"' <builddir>/meta.json`, not a literal `grep -rl "shared-ui/<Name>"` — Ladle's `meta.json` keys each story as `shared-ui--<name>--overview` (lowercased, dash-joined from the title).
- Verification correction 2 (tier 1/2, reconfirmed tier 3): confirming no plugin/app-only dependency leaked into a story must scope to `^import` lines first (`grep -n '^import' <file> | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`), not an unscoped grep — `hint="..."` strings legitimately cite real call sites like `plugins/...` as provenance and would false-positive against an unscoped check.
- CI gate is `ladle build` succeeding for `packages/shared-ui/**/*.stories.tsx` — a build-health check only, no changes needed this tier (spec "CI").
- `Icon` and `Textarea` ([PR #4286](https://github.com/get-bb/bb/pull/4286)) remain out of scope. `Select`, `Dialog`, `DropdownMenu`, `Tooltip`, `Tabs`, `Popover`, `Command`, `ContextMenu` are already done (tiers 1-3). This plan covers every other component this tier's own research confirmed has a real `plugins/*` or `apps/app/**/*.stories.tsx` call site. `OptionDisplay` is explicitly **not** a task here — this tier's research found the component itself has zero real call sites anywhere in `plugins/*` (only its exported class-name constants, `OPTION_BASE_CLASS_NAME`/`OPTION_INTERACTIVE_CLASS_NAME`, are reused, applied directly to a plain `Button` in `plugins/provider-usage/app.tsx`) and no existing `apps/app` story either — it belongs in tier 5's zero/weak-usage treatment, not forced into this tier as a synthetic story. The remaining zero-usage components (`accordion`, `alert-dialog`, `alert`, `aspect-ratio`, `avatar`, `branch-picker-primitives`, `breadcrumb`, `calendar`, `card`, `carousel`, `chart`, `drawer`, `form`, `input-otp`, `menu-item-hover`, `menubar`, `navigation-menu`, `pagination`, `progress`, `resizable`, `responsive-overlay`, `scroll-area`, `separator`, `sheet`, `slider`, `table`, `toggle`, `toggle-group`) are tier 5, not this plan. **Superseded:** this list was re-verified before tier 5 was planned and turned out wrong on 12 of the 28 — see [docs/superpowers/plans/2026-09-28-shared-ui-component-catalog-tier5-scope-survey.md](2026-09-28-shared-ui-component-catalog-tier5-scope-survey.md) for the corrected 17-component zero-usage scope and why.

## Review Focus

- **A story importing an app-internal-only or plugin-SDK-only symbol through the swapped-in shared-ui import path, missed because the substitution looked mechanical.** Every task below names its own safe substitute for the real call site's app/plugin-only pieces (RPC types, `useRpc`/`definePluginApp`, app-command hooks, plugin-local wrapper components) — the corrected `^import`-scoped grep at the end of each task is what actually catches anything a task's own notes missed, not just documentation of intent.
- **`ResourceCollectionPage`/`ResourceRow`/`ResourceDetailPage` (Task 4) rendering as an empty or broken shell because a required compositional sibling was sampled in isolation instead of nested.** `ResourceRow` outside a `ResourceListPanel` loses its `divide-y` row styling; `ResourceCollectionPage`'s inactive mode's content isn't in the DOM at all (conditional render, not `display:none`) so a story that doesn't switch `activeMode` never shows the browse-grid half.
- **`WorkflowPhaseStrip` (Task 5) rendering a phase strip with a silently-empty phase** if the fixture `WorkflowProgressSnapshot` declares a phase index no agent's `phaseIndex` references, or omits the "unphased/other work" case (`phaseIndex: undefined`) that the real call site's `buildSharedWorkflowView` always appends when `unphasedCalls.length > 0`.
- **`QuestionForm` (Task 6) returning `null` or losing its shortcut hints silently** — it renders nothing if passed an empty `questions` array, and its internal `shortcuts.get(String(index))` lookup fails silently (no `<kbd>` hint, not an error) if a demo host's shortcut map keys don't exactly match `String(optionIndex)`.
- **A story silently absent from the full catalog build, or a leaked plugin/app-only import, going unnoticed because this tier adds far more files (~19) than any prior tier (2-3 each).** Every task ends with the same corrected `meta.json` grep and `^import`-scoped grep tiers 1-3 used — for multi-file tasks, that verification step explicitly lists every file it must confirm, not "the files from this task," so a partially-forgotten file can't hide inside a vague check.

---

## Task 1: author-button-story

`packages/shared-ui/src/components/ui/button.tsx` exports `Button`/`buttonVariants` (variants `default|secondary|outline|ghost|destructive|link`, sizes `sm|default|lg|icon`). `apps/app/src/components/ui/button.stories.tsx` already has a synthetic variant×size grid — this task ports that grid unchanged (just swapping its `@bb/shared-ui/button` import for a local relative one) and adds two real-call-site rows: `plugins/thread-list/app/rows/ThreadActionsMenu.tsx`'s icon-only ghost archive toggle, and `plugins/thread-list/app/list/ProjectList.tsx`'s async "load more" button.

**Files:**
- Create: `packages/shared-ui/src/components/ui/button.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/button.stories.tsx`:

```tsx
import { useState } from "react";
import { Button, type ButtonProps } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Button",
};

type ButtonVariant = NonNullable<ButtonProps["variant"]>;
type ButtonSize = NonNullable<ButtonProps["size"]>;

const variants: readonly ButtonVariant[] = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
];

const sizes: readonly ButtonSize[] = ["sm", "default", "lg", "icon"];

const VARIANT_LABEL: Record<ButtonVariant, string> = {
  default: "Save changes",
  secondary: "Cancel",
  outline: "Connect repo",
  ghost: "Settings",
  destructive: "Delete project",
  link: "View docs",
};

function ArchiveThreadRowDemo() {
  const [archived, setArchived] = useState(false);
  const [restoring, setRestoring] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate">Sprint planning notes</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${archived ? "Restore" : "Archive"} thread`}
        disabled={restoring}
        onClick={(event) => {
          event.preventDefault();
          if (archived) {
            setRestoring(true);
            setTimeout(() => {
              setArchived(false);
              setRestoring(false);
            }, 400);
            return;
          }
          setArchived(true);
        }}
      >
        <Icon name={archived ? "ArchiveRestore" : "Archive"} />
      </Button>
    </div>
  );
}

function LoadMoreArchivedDemo() {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const hasNextPage = page < 3;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        setTimeout(() => {
          setPage((current) => current + 1);
          setLoading(false);
        }, 400);
      }}
    >
      {loading ? "Loading…" : hasNextPage ? "Show more" : "No more results"}
    </Button>
  );
}

export function Overview() {
  return (
    <>
      <StoryCard columns={sizes}>
        {variants.map((variant) => (
          <StoryRow key={variant} label={variant}>
            {sizes.map((size) => (
              <Button
                key={size}
                variant={variant}
                size={size}
                aria-label={
                  size === "icon" ? VARIANT_LABEL[variant] : undefined
                }
              >
                {size === "icon" ? (
                  <Icon name="Plus" />
                ) : (
                  VARIANT_LABEL[variant]
                )}
              </Button>
            ))}
          </StoryRow>
        ))}
      </StoryCard>
      <StoryCard>
        <StoryRow label="with icons">
          <Button>
            <Icon name="Check" />
            Save changes
          </Button>
          <Button variant="outline" size="sm">
            Add local path
            <Icon name="ArrowRight" />
          </Button>
        </StoryRow>
        <StoryRow label="disabled">
          {variants.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {variant}
            </Button>
          ))}
        </StoryRow>
        <StoryRow
          label="Icon-only row action"
          hint="plugins/thread-list/app/rows/ThreadActionsMenu.tsx — ghost icon-size button toggling archive state"
        >
          <ArchiveThreadRowDemo />
        </StoryRow>
        <StoryRow
          label="Async pagination trigger"
          hint="plugins/thread-list/app/list/ProjectList.tsx — ghost sm button whose label reflects fetch-next-page state"
        >
          <LoadMoreArchivedDemo />
        </StoryRow>
      </StoryCard>
    </>
  );
}
```

- [ ] **Step 2: Verify icon names**

Run: `grep -nE "^\s*(Plus|Check|ArrowRight|Archive|ArchiveRestore)\s*:" packages/shared-ui/src/components/ui/icon.tsx packages/shared-ui/src/components/ui/icon-extended.tsx`
Expected: one match per name (5 total).

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/button.stories.tsx' -o /tmp/ladle-verify-button`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 5: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-button && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-button/meta.json`
Expected: exit code 0, and `"shared-ui--button--overview"` present among the matches.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/button.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Button`. Confirm the variant×size grid, icon rows, and the two new real-usage rows (archive toggle click-through, load-more click-through) all render and interact correctly, then stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/button.stories.tsx
git commit -m "Add a shared-ui/Button Ladle story from real app usage"
```

---

## Task 2: author-form-control-stories

`Input`, `Label`, `RadioGroup`/`RadioGroupItem`, `Checkbox`, `Switch` — five small components whose clearest real usage comes from the same handful of settings/form call sites (`plugins/thread-list/app/list/ThreadSectionCreateDialog.tsx`, `plugins/secrets/app.tsx`, `plugins/keep-awake/app.tsx`, `plugins/account-pool/app.tsx`). Each still gets its own co-located story file per the location convention; this task batches their authoring since none is large enough alone to be its own task.

**Files:**
- Create: `packages/shared-ui/src/components/ui/input.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/label.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/radio-group.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/checkbox.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/switch.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Button` from `./button.js`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `input.stories.tsx`**

```tsx
import { useId, useState } from "react";
import { Input } from "./input.js";
import { Button } from "./button.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Input",
};

function CreateSectionFormDemo() {
  const inputId = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="w-64 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === "") {
          setError("Name is required");
          return;
        }
        setPending(true);
        setTimeout(() => {
          setPending(false);
          setError(null);
          setName("");
        }, 400);
      }}
    >
      <div className="space-y-2">
        <Input
          id={inputId}
          aria-label="Section name"
          value={name}
          autoCapitalize="sentences"
          autoCorrect="off"
          spellCheck={false}
          disabled={pending}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creating…" : "Create section"}
      </Button>
    </form>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Dialog form field"
        hint="plugins/thread-list/app/list/ThreadSectionCreateDialog.tsx — required text input in a dialog form with inline validation"
      >
        <CreateSectionFormDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write `label.stories.tsx`**

```tsx
import { useId, useState } from "react";
import { Label } from "./label.js";
import { Input } from "./input.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Label",
};

function SecretFieldDemo() {
  const inputId = useId();
  const [value, setValue] = useState("sk-live-••••••••••••");
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="w-72 space-y-1.5">
      <div className="space-y-0.5">
        <Label
          htmlFor={inputId}
          className="font-mono text-xs font-semibold text-foreground"
        >
          ANTHROPIC_API_KEY
        </Label>
        <p className="text-xs leading-snug text-muted-foreground">
          Used for provider requests from this plugin.
        </p>
      </div>
      <div className="relative">
        <Input
          id={inputId}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="pr-11 font-mono"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
          aria-label={`${revealed ? "Hide" : "Show"} ANTHROPIC_API_KEY`}
          aria-pressed={revealed}
          onClick={() => setRevealed((current) => !current)}
        >
          <Icon name={revealed ? "EyeOff" : "Eye"} />
        </Button>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Secret field label"
        hint="plugins/secrets/app.tsx — Label + password-style Input + icon-button reveal toggle"
      >
        <SecretFieldDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Write `radio-group.stories.tsx`**

```tsx
import { useState } from "react";
import { RadioGroup, RadioGroupItem } from "./radio-group.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/RadioGroup",
};

function HostModeDemo() {
  const [mode, setMode] = useState<"all" | "selected">("all");
  const hasHosts = true;

  return (
    <RadioGroup
      className="w-72 gap-1"
      value={mode}
      onValueChange={(value) => {
        if (value === "all" || value === "selected") setMode(value);
      }}
    >
      <label
        htmlFor="keep-awake-all-hosts"
        className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
      >
        <RadioGroupItem
          id="keep-awake-all-hosts"
          value="all"
          aria-label="All hosts"
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium">All hosts</span>
          <span className="block text-xs text-muted-foreground">
            Include hosts added in the future. Only macOS hosts are
            supported.
          </span>
        </span>
      </label>
      <label
        htmlFor="keep-awake-selected-hosts"
        className={
          hasHosts
            ? "flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
            : "flex cursor-not-allowed items-start gap-3 rounded-md px-2 py-2 opacity-50"
        }
      >
        <RadioGroupItem
          id="keep-awake-selected-hosts"
          value="selected"
          aria-label="Specific hosts"
          disabled={!hasHosts}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium">Specific hosts</span>
          <span className="block text-xs text-muted-foreground">
            Choose individual Macs below.
          </span>
        </span>
      </label>
    </RadioGroup>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Mode selector"
        hint="plugins/keep-awake/app.tsx — two-option radio group gating a checklist below it"
      >
        <HostModeDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 4: Write `checkbox.stories.tsx`**

```tsx
import { useState } from "react";
import { Checkbox } from "./checkbox.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Checkbox",
};

interface Host {
  id: string;
  name: string;
  status: "connected" | "offline";
}

const HOSTS: readonly Host[] = [
  { id: "host-1", name: "Josh's MacBook Pro", status: "connected" },
  { id: "host-2", name: "build-vm-02", status: "connected" },
  { id: "host-3", name: "staging-runner", status: "offline" },
];

function HostChecklistDemo() {
  const [selected, setSelected] = useState<readonly string[]>(["host-1"]);

  return (
    <div className="w-80 divide-y divide-border rounded-md border border-border">
      {HOSTS.map((host) => {
        const isSelected = selected.includes(host.id);
        const isOnlySelectedHost = isSelected && selected.length === 1;
        return (
          <div
            key={host.id}
            className="flex min-h-10 items-center gap-3 px-3 py-2"
          >
            <Checkbox
              checked={isSelected}
              disabled={isOnlySelectedHost}
              aria-label={host.name}
              onCheckedChange={(checked) => {
                setSelected((current) =>
                  checked === true
                    ? [...current, host.id]
                    : current.filter((id) => id !== host.id),
                );
              }}
            />
            <span className="min-w-0 flex-1 truncate text-sm">
              {host.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {host.status === "connected" ? "Connected" : "Offline"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Host checklist"
        hint="plugins/keep-awake/app.tsx — per-row checklist checkbox; last checked row disables to avoid empty selection"
      >
        <HostChecklistDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 5: Write `switch.stories.tsx`**

```tsx
import { useState } from "react";
import { Switch } from "./switch.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Switch",
};

function KeepAwakeMasterToggleDemo() {
  const [enabled, setEnabled] = useState(true);
  return (
    <Switch
      checked={enabled}
      size="default"
      aria-label="Keep Awake"
      onCheckedChange={setEnabled}
    />
  );
}

function ProviderRoutingRowDemo() {
  const [routing, setRouting] = useState(true);
  const [pending, setPending] = useState(false);

  return (
    <div className="flex w-64 items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span>Route Anthropic threads</span>
      <Switch
        checked={routing}
        size="sm"
        disabled={pending}
        aria-label="Route Anthropic threads"
        onCheckedChange={(next) => {
          setPending(true);
          setTimeout(() => {
            setRouting(next);
            setPending(false);
          }, 300);
        }}
      />
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Settings master toggle"
        hint="plugins/keep-awake/app.tsx — default-size switch as the view's top-level enable/disable control"
      >
        <KeepAwakeMasterToggleDemo />
      </StoryRow>
      <StoryRow
        label="Per-row routing toggle"
        hint="plugins/account-pool/app.tsx — sm switch in a settings row, disabled while its own RPC call is pending"
      >
        <ProviderRoutingRowDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 6: Verify icon names used**

None of these 5 files use `Icon` except `label.stories.tsx` (`Eye`, `EyeOff`).

Run: `grep -nE "^\s*(Eye|EyeOff)\s*:" packages/shared-ui/src/components/ui/icon.tsx packages/shared-ui/src/components/ui/icon-extended.tsx`
Expected: one match per name (2 total).

- [ ] **Step 7: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{input,label,radio-group,checkbox,switch}.stories.tsx -o /tmp/ladle-verify-form-controls`
Expected: exit code 0.

- [ ] **Step 8: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 9: Confirm the full catalog build picks these files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-form-controls && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-form-controls/meta.json`
Expected: exit code 0, and all five of `"shared-ui--input--overview"`, `"shared-ui--label--overview"`, `"shared-ui--radiogroup--overview"`, `"shared-ui--checkbox--overview"`, `"shared-ui--switch--overview"` present among the matches.

- [ ] **Step 10: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{input,label,radio-group,checkbox,switch}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 11: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open each of `shared-ui/Input`, `shared-ui/Label`, `shared-ui/RadioGroup`, `shared-ui/Checkbox`, `shared-ui/Switch`. Type into the Input/Label demos, toggle the RadioGroup and confirm the disabled Checkbox row responds, toggle both Switch rows, then stop the dev server.

- [ ] **Step 12: Commit**

```bash
git add packages/shared-ui/src/components/ui/input.stories.tsx packages/shared-ui/src/components/ui/label.stories.tsx packages/shared-ui/src/components/ui/radio-group.stories.tsx packages/shared-ui/src/components/ui/checkbox.stories.tsx packages/shared-ui/src/components/ui/switch.stories.tsx
git commit -m "Add shared-ui form-control Ladle stories from real app usage"
```

---

## Task 3: author-loading-state-stories

`Skeleton` (`skeleton.tsx`) and `DelayedLoading` (`delayed-loading.tsx`) — both real usage in `plugins/thread-list/app/ui/sidebar.tsx` and `plugins/docs/app.tsx` respectively, with `DelayedLoading` wrapping a `Skeleton` composition in the `docs` call site.

**Files:**
- Create: `packages/shared-ui/src/components/ui/skeleton.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/delayed-loading.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Button` from `./button.js`; `cn` from `../../lib/utils`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `skeleton.stories.tsx`**

```tsx
import { useId, useMemo } from "react";
import { Skeleton } from "./skeleton.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Skeleton",
};

function SidebarMenuSkeletonDemo() {
  const skeletonId = useId();
  const width = useMemo(() => {
    let hash = 0;
    for (let index = 0; index < skeletonId.length; index += 1) {
      hash = (hash + skeletonId.charCodeAt(index) * (index + 1)) % 40;
    }
    return `${hash + 50}%`;
  }, [skeletonId]);

  return (
    <div className="w-64 space-y-1 rounded-md border border-border p-2">
      {[width, "70%", "55%"].map((rowWidth, index) => (
        <div
          key={index}
          className="flex h-8 items-center gap-2 rounded-md px-2"
        >
          <Skeleton className="h-4 flex-1" style={{ maxWidth: rowWidth }} />
        </div>
      ))}
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Sidebar menu row"
        hint="plugins/thread-list/app/ui/sidebar.tsx — SidebarMenuSkeleton sizes each row to a pseudo-random width via a hashed id"
      >
        <SidebarMenuSkeletonDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write `delayed-loading.stories.tsx`**

```tsx
import { useState } from "react";
import { DelayedLoading } from "./delayed-loading.js";
import { Skeleton } from "./skeleton.js";
import { Button } from "./button.js";
import { cn } from "../../lib/utils";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/DelayedLoading",
};

function DocumentSkeletonDemo() {
  return (
    <div
      className="mx-auto w-full max-w-sm space-y-6 rounded-md border border-border p-6"
      role="status"
      aria-label="Loading document"
    >
      <span className="sr-only">Loading…</span>
      <div className="space-y-3">
        <Skeleton className="h-6 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="space-y-2">
        {["w-11/12", "w-4/5", "w-2/3"].map((widthClass) => (
          <div className="flex items-center gap-3" key={widthClass}>
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className={cn("h-4", widthClass)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ToggleReplayDemo() {
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setKey((current) => current + 1)}
      >
        Replay 200ms delay
      </Button>
      <DelayedLoading key={key}>
        <DocumentSkeletonDemo />
      </DelayedLoading>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Document skeleton, gated"
        hint="plugins/docs/app.tsx — DocumentSkeleton wrapped in DelayedLoading so a fast load never flashes a skeleton"
      >
        <ToggleReplayDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{skeleton,delayed-loading}.stories.tsx -o /tmp/ladle-verify-loading`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 5: Confirm the full catalog build picks these files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-loading && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-loading/meta.json`
Expected: exit code 0, and both `"shared-ui--skeleton--overview"` and `"shared-ui--delayedloading--overview"` present among the matches.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{skeleton,delayed-loading}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Skeleton` and `shared-ui/DelayedLoading`. Click "Replay 200ms delay" a few times (Review Focus note: it may resolve before you notice — that's expected, not a bug), then stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/skeleton.stories.tsx packages/shared-ui/src/components/ui/delayed-loading.stories.tsx
git commit -m "Add shared-ui loading-state Ladle stories from real app usage"
```

---

## Task 4: author-resource-list-story

The `Resource*` family — the largest single component group in the catalog, re-exported entirely from `packages/shared-ui/src/components/ui/resource-list.tsx` (a barrel over `./resource/atoms`, `./resource/toolbar`, `./resource/row`, `./resource/detail-shell`, `./resource/detail-sections`, `./resource/collection`) plus the sibling `resource-pagination.tsx` (not re-exported by the barrel — imported separately). Real usage is concentrated entirely in `plugins/automations/{overview-view,detail-view}.tsx`. One file, one `Overview`, two `StoryRow`s: collection/browse and detail/activity — matching the family's own two real usage shapes rather than being split across files, since every real call site composes them through the one barrel import.

**Files:**
- Create: `packages/shared-ui/src/components/ui/resource-list.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`; `Switch` from `./switch.js`; `ResourcePagination`, `useResourcePagination` from `./resource-pagination.js` (not re-exported by `resource-list.tsx` — a separate sibling file).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/resource-list.stories.tsx`:

```tsx
import { useMemo, useState } from "react";
import {
  ResourceActionButton,
  ResourceActivitySection,
  ResourceBrowseGrid,
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceCreateButton,
  ResourceDefinitionSection,
  ResourceDetailCollection,
  ResourceDetailPage,
  ResourceDetailStack,
  ResourceFilterMenu,
  ResourceListPanel,
  ResourceMeta,
  ResourceOverflowMenu,
  ResourcePromptPreview,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceSortMenu,
  ResourceTemplateBrowseCard,
  ResourceToolbar,
  type ResourceOption,
} from "./resource-list.js";
import { ResourcePagination, useResourcePagination } from "./resource-pagination.js";
import { Icon } from "./icon.js";
import { Switch } from "./switch.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ResourceList",
};

interface AutomationRowData {
  id: string;
  name: string;
  project: string;
  schedule: string;
  enabled: boolean;
}

const AUTOMATIONS: readonly AutomationRowData[] = [
  {
    id: "auto-1",
    name: "CI failure triage",
    project: "bb",
    schedule: "Weekdays 8:00am",
    enabled: true,
  },
  {
    id: "auto-2",
    name: "Weekly changelog digest",
    project: "bb",
    schedule: "Mondays 9:00am",
    enabled: true,
  },
  {
    id: "auto-3",
    name: "Stale PR nudge",
    project: "bb-marketing-site",
    schedule: "Daily 5:00pm",
    enabled: false,
  },
];

const CREATE_TEMPLATES = [
  {
    label: "CI failure triage",
    description:
      "Checks failed main-branch CI and opens fixer threads only for new failures.",
    prompt: "Watch CI on main and open a thread for any new failure.",
  },
  {
    label: "Weekly digest",
    description: "Summarizes merged PRs into a weekly changelog thread.",
    prompt: "Summarize this week's merged PRs into a changelog draft.",
  },
];

const PROJECT_OPTIONS: readonly ResourceOption[] = [
  { id: "bb", label: "bb" },
  { id: "bb-marketing-site", label: "bb-marketing-site" },
];

function CollectionBrowseDemo() {
  const [activeMode, setActiveMode] = useState<"installed" | "browse">(
    "installed",
  );
  const [query, setQuery] = useState("");
  const [projectFilters, setProjectFilters] = useState<readonly string[]>([]);
  const [sortMode, setSortMode] = useState<"project" | "alpha">("alpha");

  const filtered = useMemo(() => {
    return AUTOMATIONS.filter((automation) => {
      if (
        projectFilters.length > 0 &&
        !projectFilters.includes(automation.project)
      )
        return false;
      if (
        query.trim() !== "" &&
        !automation.name.toLowerCase().includes(query.toLowerCase())
      )
        return false;
      return true;
    }).sort((left, right) =>
      sortMode === "alpha"
        ? left.name.localeCompare(right.name)
        : left.project.localeCompare(right.project),
    );
  }, [projectFilters, query, sortMode]);

  const pagination = useResourcePagination(filtered, {
    pageSize: 2,
    resetKey: `${query}-${projectFilters.join(",")}-${sortMode}`,
  });

  return (
    <div className="h-96 w-[420px] overflow-hidden rounded-md border border-border">
      <ResourceCollectionPage
        id="demo-automations-collection"
        description="Manage scheduled bb work across projects and folders."
        modes={[
          { id: "installed", label: "Installed", count: AUTOMATIONS.length },
          { id: "browse", label: "Browse" },
        ]}
        activeMode={activeMode}
        onModeChange={(mode) => setActiveMode(mode)}
        actions={
          <ResourceCreateButton
            label="New automation"
            templates={CREATE_TEMPLATES}
            onCreate={() => {}}
          />
        }
      >
        {activeMode === "browse" ? (
          <ResourceCollectionViewport contentClassName="space-y-3">
            <ResourceBrowseGrid>
              {CREATE_TEMPLATES.map((template) => (
                <ResourceTemplateBrowseCard
                  key={template.label}
                  title={template.label}
                  description={template.description}
                  onUse={() => {}}
                />
              ))}
            </ResourceBrowseGrid>
          </ResourceCollectionViewport>
        ) : (
          <ResourceCollectionViewport
            toolbar={
              <ResourceToolbar
                searchValue={query}
                searchPlaceholder="Search automations"
                onSearchChange={setQuery}
                controls={
                  <>
                    <ResourceFilterMenu
                      compact
                      groups={[
                        {
                          id: "projects",
                          label: "Projects",
                          options: PROJECT_OPTIONS,
                          selectedValues: projectFilters,
                          onChange: setProjectFilters,
                        },
                      ]}
                    />
                    <ResourceSortMenu
                      value={sortMode}
                      direction="asc"
                      compact
                      options={[
                        { id: "project", label: "Project" },
                        { id: "alpha", label: "Automation name" },
                      ]}
                      onChange={(next) =>
                        setSortMode(next as "project" | "alpha")
                      }
                    />
                  </>
                }
              />
            }
            footer={
              <ResourcePagination
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                visibleCount={pagination.visibleCount}
                onPageChange={pagination.setPage}
              />
            }
          >
            <ResourceListPanel>
              {pagination.items.map((automation) => (
                <ResourceRow
                  key={automation.id}
                  leading={
                    <Icon name="Clock" className="size-4 text-muted-foreground" />
                  }
                  title={automation.name}
                  muted={!automation.enabled}
                  description={
                    <ResourceMeta
                      items={[
                        <span key="project">{automation.project}</span>,
                        <span key="schedule">{automation.schedule}</span>,
                      ]}
                    />
                  }
                  onOpen={() => {}}
                  actions={
                    <ResourceOverflowMenu
                      label={`${automation.name} actions`}
                      items={[
                        { label: "Run now", icon: "Play", onSelect: () => {} },
                        { kind: "separator" },
                        {
                          label: "Delete",
                          icon: "Trash2",
                          tone: "destructive",
                          onSelect: () => {},
                        },
                      ]}
                    />
                  }
                  actionsVisibility="always"
                  persistentActions={
                    <Switch
                      checked={automation.enabled}
                      size="sm"
                      aria-label={`${automation.enabled ? "Disable" : "Enable"} ${automation.name}`}
                      onCheckedChange={() => {}}
                    />
                  }
                  trailingVisual={<ResourceRowDetailChevron />}
                />
              ))}
            </ResourceListPanel>
          </ResourceCollectionViewport>
        )}
      </ResourceCollectionPage>
    </div>
  );
}

function DetailActivityDemo() {
  const [pending, setPending] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const runs = [
    {
      id: "run-1",
      status: "succeeded" as const,
      startedAt: "2026-09-27 08:00",
      threadId: "thr_1",
    },
    {
      id: "run-2",
      status: "failed" as const,
      startedAt: "2026-09-26 08:00",
      threadId: "thr_2",
    },
    {
      id: "run-3",
      status: "running" as const,
      startedAt: "2026-09-28 08:00",
      threadId: null,
    },
  ];

  return (
    <div className="h-96 w-[420px] overflow-y-auto rounded-md border border-border p-4">
      <ResourceDetailPage
        leading={
          <Icon name="Clock" className="size-4 shrink-0 text-muted-foreground" />
        }
        title="CI failure triage"
        metadata={
          <ResourceMeta
            items={[
              <span key="project">bb</span>,
              <span key="schedule">Weekdays 8:00am</span>,
            ]}
          />
        }
        lifecycleControl={
          <Switch
            checked={enabled}
            size="default"
            disabled={pending}
            aria-label={`${enabled ? "Disable" : "Enable"} CI failure triage`}
            onCheckedChange={(next) => {
              setPending(true);
              setTimeout(() => {
                setEnabled(next);
                setPending(false);
              }, 300);
            }}
          />
        }
        overflowMenu={
          <ResourceOverflowMenu
            label="CI failure triage actions"
            items={[
              { label: "Run now", icon: "Play", onSelect: () => {} },
              {
                label: "Delete",
                icon: "Trash2",
                tone: "destructive",
                onSelect: () => {},
              },
            ]}
          />
        }
      >
        <ResourceDetailStack>
          <ResourceDefinitionSection
            label="Prompt"
            actions={
              <ResourceActionButton
                label="Edit prompt"
                icon="Edit"
                onClick={() => {}}
              />
            }
          >
            <ResourcePromptPreview
              disabled
              context={[{ label: "claude-sonnet-5" }]}
            >
              Watch CI on main and open a thread for any new failure.
            </ResourcePromptPreview>
          </ResourceDefinitionSection>
          <ResourceActivitySection label="Runs">
            <ResourceDetailCollection>
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <Icon
                    name={
                      run.status === "succeeded"
                        ? "CircleCheck"
                        : run.status === "failed"
                          ? "CircleX"
                          : "Loading"
                    }
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {run.startedAt}
                  </span>
                  {run.threadId ? <ResourceRowDetailChevron /> : null}
                </div>
              ))}
            </ResourceDetailCollection>
          </ResourceActivitySection>
        </ResourceDetailStack>
      </ResourceDetailPage>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Collection / browse"
        hint="plugins/automations/overview-view.tsx — installed-list toolbar (search/filter/sort) and browse-grid tabs"
      >
        <CollectionBrowseDemo />
      </StoryRow>
      <StoryRow
        label="Detail / activity"
        hint="plugins/automations/detail-view.tsx — read-only prompt definition plus a run-history activity section"
      >
        <DetailActivityDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify icon names**

Run: `grep -nE "^\s*(Clock|Play|Trash2|Edit|CircleCheck|CircleX|Loading)\s*:" packages/shared-ui/src/components/ui/icon.tsx packages/shared-ui/src/components/ui/icon-extended.tsx`
Expected: one match per name (7 total).

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/resource-list.stories.tsx' -o /tmp/ladle-verify-resource-list`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors. This is the tier's largest single file by far — if this fails, prefer fixing prop-shape mismatches over deleting functionality (e.g. a `ResourceOverflowMenuItem`'s `tone` value, or `ResourceSortMenu`'s `onChange` signature) over dropping the composition down to something less representative of the real call site.

- [ ] **Step 5: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-resource-list && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-resource-list/meta.json`
Expected: exit code 0, and `"shared-ui--resourcelist--overview"` present among the matches.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/resource-list.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/ResourceList`. In the "Collection / browse" row: type into the search box, toggle the project filter and sort menu, switch to the "Browse" tab and back, page through results. In the "Detail / activity" row: toggle the lifecycle switch, open the overflow menu, confirm the run rows show distinct status icons. Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/resource-list.stories.tsx
git commit -m "Add a shared-ui/ResourceList Ladle story from real app usage"
```

---

## Task 5: author-workflow-progress-story

`WorkflowProgress`/`WorkflowStatusPill`/`WorkflowPhaseStrip` (`workflow-progress.tsx`) — real usage in `plugins/workflows/src/app.tsx`, composed as a collapsible activity card. The real `WorkflowProgressSnapshot` is built from RPC-internal types this story can't import, so this task hand-writes an equivalent literal snapshot instead.

**Files:**
- Create: `packages/shared-ui/src/components/ui/workflow-progress.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Icon` from `./icon.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/workflow-progress.stories.tsx`:

```tsx
import { useState } from "react";
import {
  WorkflowPhaseStrip,
  WorkflowProgress,
  WorkflowStatusPill,
  type WorkflowProgressSnapshot,
} from "./workflow-progress.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/WorkflowProgress",
};

const SNAPSHOT: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Research" },
    { index: 2, title: "Implement" },
    { index: 3, title: "Review" },
  ],
  agents: [
    {
      index: 1,
      label: "Survey call sites",
      state: "done",
      model: "claude-sonnet-5",
      attempt: 1,
      cached: false,
      lastProgressAt: Date.now() - 1000 * 60 * 8,
      phaseIndex: 1,
      metadata: ["anthropic", "sonnet-5", "medium"],
      tokens: 42000,
      toolCalls: 12,
      durationMs: 95000,
    },
    {
      index: 2,
      label: "Write implementation",
      state: "running",
      model: "claude-opus-5",
      attempt: 1,
      cached: false,
      lastProgressAt: Date.now() - 1000 * 20,
      phaseIndex: 2,
      metadata: ["anthropic", "opus-5", "high"],
      tokens: 18500,
      toolCalls: 6,
    },
    {
      index: 3,
      label: "Fix failing test",
      state: "failed",
      model: "claude-sonnet-5",
      attempt: 2,
      cached: false,
      lastProgressAt: Date.now() - 1000 * 60 * 2,
      phaseIndex: 2,
      error: "Test suite exited with code 1",
      metadata: ["anthropic", "sonnet-5", "medium"],
      durationMs: 31000,
    },
    {
      index: 4,
      label: "Other work",
      state: "queued",
      model: "claude-opus-5",
      attempt: 1,
      cached: false,
      lastProgressAt: Date.now(),
      phaseIndex: undefined,
      metadata: ["anthropic", "opus-5", "high"],
    },
  ],
};

function WorkflowRunCardDemo() {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="w-[420px] overflow-hidden rounded-lg border border-border bg-surface-recessed">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <Icon name="Workflow" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 truncate">Fix flaky CI job</span>
          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
            2/4 agents
          </span>
        </span>
        <WorkflowStatusPill state="failed" />
        <Icon
          name="ChevronDown"
          className={`size-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      <WorkflowPhaseStrip
        progress={SNAPSHOT}
        currentPhaseIndex={2}
        settled={false}
        className="px-3 pb-2"
      />
      {expanded ? (
        <div className="border-t border-border bg-popover">
          <div className="max-h-72 overflow-y-auto px-2.5 py-2">
            <WorkflowProgress
              progress={SNAPSHOT}
              settled={false}
              currentPhaseIndex={2}
              collapsiblePhases
              onAgentActivate={() => {}}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Expandable run card"
        hint="plugins/workflows/src/app.tsx — phase strip + status pill + progress list as a collapsible run card"
      >
        <WorkflowRunCardDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify icon names**

Run: `grep -nE "^\s*(Workflow|ChevronDown)\s*:" packages/shared-ui/src/components/ui/icon.tsx packages/shared-ui/src/components/ui/icon-extended.tsx`
Expected: one match per name (2 total).

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/workflow-progress.stories.tsx' -o /tmp/ladle-verify-workflow-progress`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 5: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-workflow-progress && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-workflow-progress/meta.json`
Expected: exit code 0, and `"shared-ui--workflowprogress--overview"` present among the matches.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/workflow-progress.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/WorkflowProgress`. Confirm the phase strip shows all 3 phases plus the "Other work" agent isn't dropped, click the header to collapse/expand, then stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/workflow-progress.stories.tsx
git commit -m "Add a shared-ui/WorkflowProgress Ladle story from real app usage"
```

---

## Task 6: author-question-form-story

`QuestionForm` (`question-form.tsx`) always reads from `useQuestionFormHost()` (`question-form-host.tsx`) internally — real usage in `plugins/ask-user-question/app.tsx` (the form itself) and the provider pairing in `apps/app/.../ThreadQuestionFormHost.tsx` (app-internal, not importable). `QuestionFormHostProvider` has no visible output of its own and no other real `plugins/*` call site pairs it with `QuestionForm` directly, so this task demonstrates both together in one file rather than giving the host its own separate story — the same reasoning tier 3 used for not re-wrapping `Command` in its own `Popover` story.

**Files:**
- Create: `packages/shared-ui/src/components/ui/question-form.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/question-form.stories.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { QuestionForm } from "./question-form.js";
import type { Question } from "./question-form-state.js";
import {
  QuestionFormHostProvider,
  type QuestionFormHost,
} from "./question-form-host.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/QuestionForm",
};

const QUESTIONS: readonly Question[] = [
  {
    id: "environment",
    prompt: "Which environment should this run against?",
    shortLabel: "Environment",
    multiSelect: false,
    allowFreeText: false,
    options: [
      { value: "staging", label: "Staging", description: "Safe to break" },
      { value: "production", label: "Production", description: "Customer-facing" },
    ],
  },
  {
    id: "notify",
    prompt: "Who should be notified when this finishes?",
    shortLabel: "Notify",
    multiSelect: true,
    allowFreeText: true,
    options: [
      { value: "me", label: "Just me" },
      { value: "team", label: "#platform-team" },
    ],
  },
];

function useDemoQuestionFormHost(): QuestionFormHost {
  const [handler, setHandler] = useState<((index: number) => boolean) | null>(
    null,
  );
  const shortcuts = useMemo(
    () =>
      new Map([
        ["0", { label: "1", ariaKeyshortcuts: "1" }],
        ["1", { label: "2", ariaKeyshortcuts: "2" }],
      ]),
    [],
  );
  const registerChoiceHandler = useCallback(
    (next: (index: number) => boolean) => {
      setHandler(() => next);
      return () => setHandler(null);
    },
    [],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const index = Number(event.key) - 1;
      if (!Number.isNaN(index)) handler?.(index);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handler]);

  return { shortcuts, registerChoiceHandler };
}

function AskUserQuestionDemo() {
  const host = useDemoQuestionFormHost();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <QuestionFormHostProvider value={host}>
      <div className="w-96">
        {result ? (
          <p className="text-sm text-muted-foreground">{result}</p>
        ) : (
          <QuestionForm
            questions={QUESTIONS}
            disabled={busy}
            cancelDisabled={busy}
            onSubmit={(answers) => {
              setBusy(true);
              setTimeout(() => {
                setBusy(false);
                setResult(`Submitted: ${JSON.stringify(answers)}`);
              }, 400);
            }}
            onCancel={() => setResult("Cancelled")}
          />
        )}
      </div>
    </QuestionFormHostProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Question form with number-key shortcuts"
        hint="plugins/ask-user-question/app.tsx + apps/app ThreadQuestionFormHost.tsx — host-provided number-key shortcuts"
      >
        <AskUserQuestionDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/question-form.stories.tsx' -o /tmp/ladle-verify-question-form`
Expected: exit code 0.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 4: Confirm the full catalog build picks this file up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-question-form && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-question-form/meta.json`
Expected: exit code 0, and `"shared-ui--questionform--overview"` present among the matches.

- [ ] **Step 5: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/question-form.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 6: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/QuestionForm`. Confirm both questions render with the `1`/`2` shortcut hints on the first question's options, press `1` on your keyboard and confirm it selects the first option, submit and cancel both to confirm the result text swaps in. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-ui/src/components/ui/question-form.stories.tsx
git commit -m "Add a shared-ui/QuestionForm Ladle story from real app usage"
```

---

## Task 7: author-misc-widget-stories

Five components whose real usage is each self-contained to one plugin file: `Badge`, `PluginBrandIcon`/`PluginCompactIconMask`, `Collapsible`, `HoverCard`, `EmptyState`. `HoverCard`'s only real call site (`plugins/theme-preview/app.tsx`) is that plugin's own overlay-gallery demo rather than a feature UI — still real in-repo plugin code, so this task derives from it, but replaces its plugin-local `tone`-prop `Badge` shadow, `Dot`, and `v()` token-accessor helpers with shared-ui's own `Badge`/Tailwind classes rather than porting those helpers' inline-style approach.

**Files:**
- Create: `packages/shared-ui/src/components/ui/badge.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/plugin-icon.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/collapsible.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/hover-card.stories.tsx`
- Create: `packages/shared-ui/src/components/ui/empty-state.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`; `Button` from `./button.js`; `Icon` from `./icon.js`; `Input` from `./input.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `badge.stories.tsx`**

```tsx
import { Badge } from "./badge.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Badge",
};

function PullStateBadge({
  state,
}: {
  state: "DRAFT" | "OPEN" | "MERGED" | "CLOSED";
}) {
  const parts =
    state === "DRAFT"
      ? { dot: "bg-muted-foreground/60", label: "draft" }
      : state === "OPEN"
        ? { dot: "bg-green-500", label: "open" }
        : state === "MERGED"
          ? { dot: "bg-purple-500", label: "merged" }
          : { dot: "bg-red-500", label: "closed" };
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={`size-2 shrink-0 rounded-full ${parts.dot}`} />
      {parts.label}
    </Badge>
  );
}

function ReviewDecisionBadge({
  decision,
}: {
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
}) {
  if (decision === "APPROVED") {
    return (
      <Badge className="bg-green-600 text-white hover:bg-green-600">
        approved
      </Badge>
    );
  }
  if (decision === "CHANGES_REQUESTED") {
    return <Badge variant="destructive">changes requested</Badge>;
  }
  return <Badge variant="secondary">review required</Badge>;
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="PR state dot badge"
        hint="plugins/github/app.tsx — outline badge with a colored status dot per pull-request state"
      >
        <PullStateBadge state="DRAFT" />
        <PullStateBadge state="OPEN" />
        <PullStateBadge state="MERGED" />
        <PullStateBadge state="CLOSED" />
      </StoryRow>
      <StoryRow
        label="Review decision"
        hint="plugins/github/app.tsx — semantic badge variants for a review decision"
      >
        <ReviewDecisionBadge decision="APPROVED" />
        <ReviewDecisionBadge decision="CHANGES_REQUESTED" />
        <ReviewDecisionBadge decision="REVIEW_REQUIRED" />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 2: Write `plugin-icon.stories.tsx`**

```tsx
import { PluginBrandIcon, PluginCompactIconMask } from "./plugin-icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/PluginIcon",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Brand icon lookup"
        hint="plugins/plugin-api-docs/app.tsx — brand icon falling back through icon/iconUrl/tinted variants"
      >
        <PluginBrandIcon icon="Github" iconUrl={null} iconTinted={false} className="size-4" />
        <PluginBrandIcon
          icon={null}
          iconUrl="https://example.com/icon.svg"
          iconTinted
          className="size-4"
        />
      </StoryRow>
      <StoryRow
        label="Compact mask icon"
        hint="plugins/theme-preview/app.tsx — compact CSS-mask icon inline in a label row"
      >
        <PluginCompactIconMask url="https://example.com/icon.svg" className="size-4" />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 3: Write `collapsible.stories.tsx`**

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.js";
import { Input } from "./input.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Collapsible",
};

function AdvancedSettingsDemo() {
  return (
    <Collapsible className="w-80 rounded-lg border border-border px-4">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2.5 text-sm font-medium text-foreground">
        <Icon
          name="ChevronRight"
          className="size-4 transition-transform [[data-state=open]>&]:rotate-90"
        />
        Advanced
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 divide-y divide-border border-t border-border py-3">
          <div className="space-y-1 pt-3 first:pt-0">
            <label className="text-xs font-medium text-muted-foreground">
              Anthropic upstream base URL
            </label>
            <Input
              aria-label="Anthropic upstream base URL"
              placeholder="https://api.anthropic.com"
            />
          </div>
          <div className="space-y-1 pt-3">
            <label className="text-xs font-medium text-muted-foreground">
              OpenAI upstream base URL
            </label>
            <Input
              aria-label="OpenAI upstream base URL"
              placeholder="https://api.openai.com"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Advanced settings disclosure"
        hint="plugins/account-pool/app.tsx — chevron-rotating disclosure revealing a divided settings-field list"
      >
        <AdvancedSettingsDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 4: Write `hover-card.stories.tsx`**

```tsx
import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card.js";
import { Button } from "./button.js";
import { Badge } from "./badge.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/HoverCard",
};

function ThemeHoverCardDemo() {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <Button variant="outline" size="sm" onClick={() => setOpen((current) => !current)}>
          Hover card
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="start" sideOffset={6} className="w-60 space-y-2 p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Endless theme family</span>
          <Badge variant="secondary">Running</Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">bb/endless-theme</p>
        <p className="text-xs text-muted-foreground">
          Sidebar reads true black with the orange seam; blue selection at .20.
        </p>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="h-7 flex-1 px-2 text-xs">
            Copy branch
          </Button>
          <Button size="sm" className="h-7 flex-1 px-2 text-xs">
            Open in split
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Branch preview card"
        hint="plugins/theme-preview/app.tsx — its own overlay-gallery demo; ported with shared-ui Badge/Icon, not the plugin's local helpers"
      >
        <ThemeHoverCardDemo />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 5: Write `empty-state.stories.tsx`**

```tsx
import { EmptyState } from "./empty-state.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/EmptyState",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Empty thread list"
        hint="plugins/thread-list/app/ui/ThreadListEmptyState.tsx — sidebar's no-threads message, icon + muted text"
      >
        <EmptyState
          message="No threads"
          icon="MessageSquare"
          iconClassName="size-3.5 text-subtle-foreground/50"
          messageClassName="text-xs leading-4 text-subtle-foreground/60"
        />
      </StoryRow>
    </StoryCard>
  );
}
```

- [ ] **Step 6: Verify icon names used**

Run: `grep -nE "^\s*(Github|ChevronRight|MessageSquare)\s*:" packages/shared-ui/src/components/ui/icon.tsx packages/shared-ui/src/components/ui/icon-extended.tsx`
Expected: one match per name (3 total).

- [ ] **Step 7: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories ../../packages/shared-ui/src/components/ui/{badge,plugin-icon,collapsible,hover-card,empty-state}.stories.tsx -o /tmp/ladle-verify-misc-widgets`
Expected: exit code 0.

- [ ] **Step 8: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --output-logs=new-only`
Expected: 0 errors.

- [ ] **Step 9: Confirm the full catalog build picks these files up**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-misc-widgets && grep -o '"shared-ui[^"]*"' /tmp/ladle-verify-full-misc-widgets/meta.json`
Expected: exit code 0, and all five of `"shared-ui--badge--overview"`, `"shared-ui--pluginicon--overview"`, `"shared-ui--collapsible--overview"`, `"shared-ui--hovercard--overview"`, `"shared-ui--emptystate--overview"` present among the matches.

- [ ] **Step 10: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/{badge,plugin-icon,collapsible,hover-card,empty-state}.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 11: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open each of `shared-ui/Badge`, `shared-ui/PluginIcon`, `shared-ui/Collapsible`, `shared-ui/HoverCard`, `shared-ui/EmptyState`. Expand the Collapsible demo, hover/click the HoverCard trigger and confirm the card doesn't escape the `StoryRow` grid (portal escape — same risk tier 1-3 flagged for other overlays), then stop the dev server.

- [ ] **Step 12: Commit**

```bash
git add packages/shared-ui/src/components/ui/badge.stories.tsx packages/shared-ui/src/components/ui/plugin-icon.stories.tsx packages/shared-ui/src/components/ui/collapsible.stories.tsx packages/shared-ui/src/components/ui/hover-card.stories.tsx packages/shared-ui/src/components/ui/empty-state.stories.tsx
git commit -m "Add shared-ui misc-widget Ladle stories from real app usage"
```

---

## Task 8: consolidate-pill-story

`Pill` (`pill.tsx`) has zero real `plugins/*` call sites — its only existing coverage is `apps/app/src/components/ui/pill.stories.tsx`, which already imports `Pill` from `@bb/shared-ui/pill` (the component itself already lives in `packages/shared-ui`; only its story is still stranded in `apps/app`). This task ports that story into `packages/shared-ui` essentially verbatim (swap the `story-card` import path and the external `@bb/shared-ui/pill` import for a local relative one, retitle to the `shared-ui/*` namespace) and deletes the now-stale `apps/app` copy.

**Files:**
- Create: `packages/shared-ui/src/components/ui/pill.stories.tsx`
- Delete: `apps/app/src/components/ui/pill.stories.tsx`

**Interfaces:**
- Consumes: `StoryCard`, `StoryRow` from `../../lib/story-card`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the story file**

Create `packages/shared-ui/src/components/ui/pill.stories.tsx`:

```tsx
import { Pill, type PillVariant } from "./pill.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Pill",
};

const variants: readonly PillVariant[] = [
  "secondary",
  "destructive",
  "outline",
  "emphasis",
];

const VARIANT_CONTENT: Record<PillVariant, string> = {
  secondary: "managed",
  destructive: "failed",
  outline: "manager",
  emphasis: "active",
};

export function Overview() {
  return (
    <>
      <StoryCard>
        {variants.map((variant) => (
          <StoryRow key={variant} label={variant}>
            <Pill variant={variant}>{VARIANT_CONTENT[variant]}</Pill>
          </StoryRow>
        ))}
      </StoryCard>
      <StoryCard>
        <StoryRow label="standard">
          <Pill variant="outline">feat/review-flow</Pill>
        </StoryRow>
        <StoryRow label="truncated" hint="max-w-40">
          <Pill variant="outline" className="max-w-40">
            feat/very-long-branch-name-that-truncates
          </Pill>
        </StoryRow>
      </StoryCard>
      <StoryCard>
        <StoryRow label="child" hint="non-fork child thread">
          <Pill variant="outline">child</Pill>
        </StoryRow>
        <StoryRow label="fork" hint="forked thread">
          <Pill variant="outline">fork</Pill>
        </StoryRow>
      </StoryCard>
      <StoryCard>
        <StoryRow label="default" hint="px-2 py-0.5">
          <Pill variant="outline">fork</Pill>
        </StoryRow>
        <StoryRow label="sm" hint="compact — thread header">
          <Pill variant="outline" size="sm">
            fork
          </Pill>
        </StoryRow>
      </StoryCard>
    </>
  );
}
```

- [ ] **Step 2: Delete the stale apps/app copy**

Run: `git rm apps/app/src/components/ui/pill.stories.tsx`

- [ ] **Step 3: Verify the scoped build**

Run: `pnpm --filter @bb/app exec ladle build --stories '../../packages/shared-ui/src/components/ui/pill.stories.tsx' -o /tmp/ladle-verify-pill`
Expected: exit code 0.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --filter=@bb/app --output-logs=new-only`
Expected: 0 errors (the `@bb/app` filter here specifically confirms deleting `apps/app/src/components/ui/pill.stories.tsx` didn't break anything that referenced it).

- [ ] **Step 5: Confirm the full catalog build picks the new file up and the old one is gone**

Run: `pnpm --filter @bb/app exec ladle build -o /tmp/ladle-verify-full-pill && grep -o '"[a-z-]*pill[^"]*"' /tmp/ladle-verify-full-pill/meta.json`
Expected: exit code 0, and only `"shared-ui--pill--overview"` present — no `"ui--pill--overview"` (the old `apps/app` title) remaining.

- [ ] **Step 6: Confirm no plugin/app-only dependency leaked in**

Run: `grep -n '^import' packages/shared-ui/src/components/ui/pill.stories.tsx | grep -E '@get-bb/plugin-sdk|from "@/|plugins/'`
Expected: no output.

- [ ] **Step 7: Manual layout check**

Run: `pnpm --filter @bb/app run storybook`, open `shared-ui/Pill` and confirm all four `StoryCard`s render (variant sweep, truncation, semantic labels, size), then stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-ui/src/components/ui/pill.stories.tsx apps/app/src/components/ui/pill.stories.tsx
git commit -m "Move the shared-ui/Pill Ladle story from apps/app into packages/shared-ui"
```

---

## Follow-up plans (not in this plan's scope)

- **Tier 5** (zero-usage components — `accordion`, `alert-dialog`, `alert`, `aspect-ratio`, `avatar`, `branch-picker-primitives`, `breadcrumb`, `calendar`, `card`, `carousel`, `chart`, `drawer`, `form`, `input-otp`, `menu-item-hover`, `menubar`, `navigation-menu`, `pagination`, `progress`, `resizable`, `responsive-overlay`, `scroll-area`, `separator`, `sheet`, `slider`, `table`, `toggle`, `toggle-group`) — per every prior tier's own follow-up note, needs its own batching/parallelization strategy given the volume (28 files). This tier's own research additionally confirms **`OptionDisplay`** belongs here too, despite technically having "usage" via its exported class-name constants — the component itself has no real call site to derive an `Overview` story from; tier 5's plan should either give it a single plausible default-props render (per spec's own zero-usage convention) or explicitly punt it further if that's judged not worth doing.
- **`ResourceInstallControl`/`ResourceInstalledControl`** (from `resource/detail-controls.tsx`) have no real call site in `plugins/automations/*` or `plugins/account-pool/*` — their only real usage found is `apps/app/src/components/tools/SkillsBrowse.tsx`, outside `plugins/*`. Not included in Task 4's `resource-list.stories.tsx`; flagged here as a gap for whoever next touches that file (could be added as a third `StoryRow` sourced from `apps/app` as the spec's secondary source, if judged worth a special case).
- **`Button`/`Input`/`Switch`/`ResourceList`(as a symbol)/`EmptyState`** all had scattered `apps/app/**/*.stories.tsx` coverage before this tier per the spec's own baseline list. Tasks 1, 2, 4, and 7 above already incorporate or supersede that coverage in their new `packages/shared-ui` stories — no separate consolidation task needed, unlike `Pill` (Task 8), which had literally nothing else to derive from and so needed the dedicated port-and-delete treatment.
- Three small deferred items carried over from tier 2/3, still unaddressed: `ladle build` exits 0 even when a story fails to bundle; the plan's own verification steps litter `apps/app/tmp/` with untracked build output per tier; `@bb/shared-ui` has no `lint` script (already dropped from "verify typecheck and lint" in tier 3's plan and this one — don't re-add without adding the script first).

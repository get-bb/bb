# shared-ui Ladle Stories: Icon + Textarea Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author real, atomic Ladle (CSF) stories for the two highest-priority
`@bb/shared-ui` components (Icon, Textarea per the install-weighted plugin
survey), proving out the conventions in the spec end to end on real
components before the remaining priority batch (Select*/DropdownMenu*/Dialog*)
or the design-sync Ladle fork (separate sub-projects) build on them.

**Architecture:** Each component gets one co-located `<name>.stories.tsx`
file under `packages/shared-ui/src/components/ui/`. Story variants are not
invented — they're derived from grepping real usage in `plugins/*`, capped at
~6 stories per component. Both components use the hand-JSX pattern (neither
imports `cva`/`VariantProps`, per the spec's mechanical selection rule), so
this plan does not exercise the args-based (`Story<P>` + `.args`) pattern —
that will land naturally once a cva-based component (Button, Badge, Alert,
Toggle, Sheet, NavigationMenu) reaches the front of the priority queue.
Each task's deliverable is verified by a real scoped `ladle build`, not just
a visual read of the code.

**Tech Stack:** Ladle 5.1.1 (`@ladle/react`, already installed), React 19,
TypeScript. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-shared-ui-ladle-stories-design.md`

## Global Constraints

- Stories are co-located: `packages/shared-ui/src/components/ui/<name>.stories.tsx`.
- Atomic CSF only: one named export = one distinct visual state. No
  `Overview`-grid stories (that's the existing `apps/app`-level convention,
  not this one).
- Cap ~6 stories per component; fewer is fine when a component genuinely has
  fewer distinct real-world states (Textarea has 4 here, not 6 — no plugin
  usage evidence supports padding it to 6).
- Title convention: `"shared-ui/<Name>"`, never `"ui/<Name>"` (the latter is
  already used by existing `apps/app/src/components/ui/*.stories.tsx` files
  for some of these same components — a shared title risks the adapter
  treating both files as one ambiguous group).
- No `Date.now()`, `Math.random()`, live timers, or real network calls in any
  story's render path.
- Every story must be traceable to a real usage pattern found via grep in
  `plugins/*` — not a generic prop-matrix guess. Each task below quotes the
  exact grep evidence each story is derived from.
- Authoring pattern selection is mechanical: `grep -l "cva\|VariantProps" <component>.tsx` — a hit means args-based (`Story<P>` + `.args`), no hit means hand-JSX. Both components in this plan have no hit.

## Review Focus

1. **Invented story with no usage evidence** — the spec requires every story
   trace to a real plugin usage pattern. A reviewer should check each story
   in a task against that task's quoted grep output and reject anything
   that doesn't match a real pattern.
2. **Story count or duplication** — more than ~6 stories per component, or
   two stories that render the same visual state under different names
   (e.g., two "sized icon" stories that differ only in an arbitrary,
   non-representative size).
3. **Title convention violated** — `title` must be `"shared-ui/<Name>"`
   exactly; a `"ui/<Name>"` title here would collide with the existing
   app-level story for the same component.
4. **Nondeterministic content copied verbatim from real usage** — real
   plugin code sometimes wires values through state/handlers; a story must
   render a fixed, deterministic snapshot (e.g., a fixed `value=` string),
   never an actual `useState`/timer/network call lifted wholesale from the
   plugin source.
5. **Build not actually verified** — the deliverable is a story file that
   `ladle build` succeeds against with the expected named exports in
   `meta.json`, not just code that looks plausible. A reviewer should
   re-run the verification command themselves, not trust the implementer's
   report of it.

---

### Task 1: Icon stories

**Files:**
- Create: `packages/shared-ui/src/components/ui/icon.stories.tsx`
- Delete: `packages/shared-ui/src/components/ui/button.stories.tsx` (a
  throwaway probe file from earlier spike work in this repo, unrelated to
  this task — Button isn't due until later in the priority order; removing
  it here just clears stray state before this task's build verification
  runs, so it isn't mistaken for in-scope work)

**Interfaces:**
- Consumes: `Icon` component and `IconProps` from
  `packages/shared-ui/src/components/ui/icon.tsx` (props: `name: IconName`
  required, `fallback?`, `className?`, `style?`, `"aria-hidden"?`,
  `"aria-label"?`; no `cva`/`VariantProps` in this file, confirmed via
  `grep -n "cva\|VariantProps" packages/shared-ui/src/components/ui/icon.tsx`
  returning nothing).
- Produces: `packages/shared-ui/src/components/ui/icon.stories.tsx`, title
  `"shared-ui/Icon"`, exports `Default`, `Loading`, `Decorative`, `Small`,
  `CopyIdle`, `CopySuccess` — consumed by later sub-projects (design-sync
  Ladle fork), not by any task in this plan.

- [ ] **Step 1: Remove the leftover probe file**

```bash
rm -f packages/shared-ui/src/components/ui/button.stories.tsx
```

- [ ] **Step 2: Confirm real usage evidence (read-only, no code yet)**

Run:
```bash
grep -rhoE '<Icon\s[^>]*/?>' plugins --include="*.tsx" | sort | uniq -c | sort -rn | head -25
```
Expected output includes (already captured during spec research — re-run to
confirm nothing has changed since):
```
     12 <Icon name="Plus" className="size-3.5" />
      4 <Icon name="Spinner" className="size-4 animate-spin" />
      3 <Icon name="X" className="size-3" />
      2 <Icon name="Check" aria-hidden className="size-3.5" />
      1 <Icon name={copyState === "copied" ? "Check" : "Copy"} />
```
These five real patterns (the bare-conditional line expands to two stories,
`CopyIdle`/`CopySuccess`, since it's a real two-state idiom — see Step 3)
are what the six stories below are derived from. No `fallback=` or
`aria-label=` (value-setting, not `aria-hidden`) usage was found anywhere in
`plugins/*` (confirmed via `grep -rn "Icon[^>]*fallback="` and
`grep -rn "<Icon[^>]*aria-label="` — both empty) — do not author stories for
those, there's no real usage evidence for them.

- [ ] **Step 3: Write the story file**

Create `packages/shared-ui/src/components/ui/icon.stories.tsx`:

```tsx
import { Icon } from "./icon";

export default {
  title: "shared-ui/Icon",
};

export const Default = () => <Icon name="Plus" className="size-3.5" />;

export const Loading = () => (
  <Icon name="Spinner" className="size-4 animate-spin" />
);

export const Decorative = () => (
  <Icon name="Check" aria-hidden className="size-3.5" />
);

export const Small = () => <Icon name="X" className="size-3" />;

export const CopyIdle = () => <Icon name="Copy" />;

export const CopySuccess = () => <Icon name="Check" />;
```

- [ ] **Step 4: Verify with a scoped Ladle build**

Run from `apps/app/`:
```bash
cd apps/app
pnpm exec ladle build --stories '../../packages/shared-ui/src/components/ui/icon.stories.tsx' --outDir /tmp/ladle-verify-icon
```
Expected: exit code 0, output ends with `Meta.json successfully created.`
and a `⏱️  Ladle finished the production build in ...` line — no `✗ Build
failed` line anywhere in the output.

- [ ] **Step 5: Confirm the six stories are all present and correctly paired**

Run:
```bash
python3 -c "
import json
meta = json.load(open('/tmp/ladle-verify-icon/meta.json'))
stories = meta['stories']
assert len(stories) == 6, f'expected 6 stories, got {len(stories)}'
exports = sorted(s['namedExport'] for s in stories.values())
expected = sorted(['Default', 'Loading', 'Decorative', 'Small', 'CopyIdle', 'CopySuccess'])
assert exports == expected, f'{exports} != {expected}'
print('OK: 6 stories present with correct named exports')
"
```
Expected output: `OK: 6 stories present with correct named exports`

- [ ] **Step 6: Clean up the verification build output**

```bash
rm -rf apps/app/build 2>/dev/null; rm -rf /tmp/ladle-verify-icon
```
(The build output is a verification artifact, not a deliverable — don't
commit it.)

- [ ] **Step 7: Commit**

```bash
cd /Users/technicalpickles/github.com/get-bb/bb
git add packages/shared-ui/src/components/ui/icon.stories.tsx
git commit -m "$(cat <<'EOF'
Add real-usage-derived Ladle stories for shared-ui Icon

Six stories (Default, Loading, Decorative, Small, CopyIdle, CopySuccess)
derived from grepping actual <Icon> usage across plugins/*, per the
shared-ui Ladle story conventions spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Textarea stories

**Files:**
- Create: `packages/shared-ui/src/components/ui/textarea.stories.tsx`

**Interfaces:**
- Consumes: `Textarea` component from
  `packages/shared-ui/src/components/ui/textarea.tsx` (a
  `React.forwardRef` wrapping a plain `<textarea>`, props are
  `React.ComponentProps<"textarea">` passthrough plus `className`; no
  `cva`/`VariantProps` in this file, confirmed via
  `grep -n "cva\|VariantProps" packages/shared-ui/src/components/ui/textarea.tsx`
  returning nothing).
- Produces: `packages/shared-ui/src/components/ui/textarea.stories.tsx`,
  title `"shared-ui/Textarea"`, exports `Default`, `Filled`, `CommentBox`,
  `Disabled` — consumed by later sub-projects, not by any task in this plan.

- [ ] **Step 1: Confirm real usage evidence (read-only, no code yet)**

Run:
```bash
grep -rn "<Textarea" plugins --include="*.tsx"
```
Then read the surrounding JSX for each hit. Already captured during spec
research — four distinct real patterns:
- `plugins/tasks/views/manage/preset-dialog.tsx:311` — empty/controlled with
  a placeholder, wrapped in a `Field`, `className="min-h-20 text-xs"`.
- `plugins/memory/app.tsx:63` — pre-filled `value`, `maxLength={16_000}`,
  `aria-label="Memory details"`.
- `plugins/github/app.tsx:1143` and `:1580` — identical shape both places:
  `rows={3}`, `placeholder="Leave a comment…"` — a genuinely repeated
  "comment box" pattern, not a one-off.
- `plugins/automations/detail-view.tsx:600` — `disabled={pending}` — the
  only real `disabled` usage found across all four hits.

- [ ] **Step 2: Write the story file**

Create `packages/shared-ui/src/components/ui/textarea.stories.tsx`:

```tsx
import { Textarea } from "./textarea";

export default {
  title: "shared-ui/Textarea",
};

export const Default = () => (
  <Textarea
    placeholder="Extra instructions prepended to dispatched threads"
    className="min-h-20 text-xs"
    onChange={() => {}}
  />
);

export const Filled = () => (
  <Textarea
    value="Prefers concise summaries and avoids jargon."
    maxLength={16_000}
    aria-label="Memory details"
    className="min-h-28 resize-y text-sm"
    onChange={() => {}}
  />
);

export const CommentBox = () => (
  <Textarea
    placeholder="Leave a comment…"
    rows={3}
    onChange={() => {}}
  />
);

export const Disabled = () => (
  <Textarea
    value="Summarize the last 10 commits."
    disabled
    aria-label="Automation prompt"
    className="min-h-28 resize-none border-0 bg-transparent px-4 pb-1 pr-14 pt-3 text-sm leading-relaxed shadow-none focus-visible:ring-0"
    onChange={() => {}}
  />
);
```

`onChange={() => {}}` is present on every story because `Textarea` forwards
`value`/`onChange` as ordinary controlled-input props — React warns on a
controlled `value` with no `onChange` handler. This is boilerplate the
render needs, not an invented prop the real usage didn't have (every real
call site had its own real `onChange`; a story has no state to update, so a
no-op is the deterministic equivalent).

- [ ] **Step 3: Verify with a scoped Ladle build**

Run from `apps/app/`:
```bash
cd apps/app
pnpm exec ladle build --stories '../../packages/shared-ui/src/components/ui/textarea.stories.tsx' --outDir /tmp/ladle-verify-textarea
```
Expected: exit code 0, `Meta.json successfully created.`, no `✗ Build
failed` line.

- [ ] **Step 4: Confirm the four stories are all present and correctly paired**

Run:
```bash
python3 -c "
import json
meta = json.load(open('/tmp/ladle-verify-textarea/meta.json'))
stories = meta['stories']
assert len(stories) == 4, f'expected 4 stories, got {len(stories)}'
exports = sorted(s['namedExport'] for s in stories.values())
expected = sorted(['Default', 'Filled', 'CommentBox', 'Disabled'])
assert exports == expected, f'{exports} != {expected}'
print('OK: 4 stories present with correct named exports')
"
```
Expected output: `OK: 4 stories present with correct named exports`

- [ ] **Step 5: Clean up the verification build output**

```bash
rm -rf apps/app/build 2>/dev/null; rm -rf /tmp/ladle-verify-textarea
```

- [ ] **Step 6: Commit**

```bash
cd /Users/technicalpickles/github.com/get-bb/bb
git add packages/shared-ui/src/components/ui/textarea.stories.tsx
git commit -m "$(cat <<'EOF'
Add real-usage-derived Ladle stories for shared-ui Textarea

Four stories (Default, Filled, CommentBox, Disabled) derived from
grepping actual <Textarea> usage across plugins/*, per the shared-ui
Ladle story conventions spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

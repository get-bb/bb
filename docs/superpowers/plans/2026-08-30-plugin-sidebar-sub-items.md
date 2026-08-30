# Plugin Sidebar Sub-Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add host-rendered, expandable plugin sidebar sub-items with optional icons and live accessories while preserving existing `navPanel` behavior.

**Architecture:** Extend the existing `PluginNavPanelRegistration` collector and last-known chrome model, then render children inside `PluginNavSidebarItems` as part of the parent group. Reuse current navigation, split-drag, slot isolation, ordering, hiding, icon, and local-storage patterns; add no second navigation system or backend protocol.

**Tech Stack:** TypeScript, React, Jotai, React Router, Zod, Vitest, Testing Library, Turbo.

**Spec:** `docs/superpowers/specs/2026-08-30-plugin-sidebar-sub-items-design.md`

## Global Constraints

- The public field is named `experimental_sidebarSubItems`.
- Each child supports `id`, `title`, `subPath`, optional `icon`, and optional `experimental_sidebarAccessory`.
- Existing `navPanel` registrations that omit the field retain current markup and behavior.
- Plugins declare data; bb owns rendering, navigation, accessibility, persistence, compact behavior, and failure isolation.
- The parent remains the only sortable and hideable row.
- No content script, DOM observer, dependency, database table, server route, or daemon protocol change.
- New public plugin API stays experimental, is added to `docs/api_to_audit.md`, and is documented in the Plugin Guide and API map.
- Bump the Plugin SDK patch version with `node scripts/bump-plugin-sdk.mjs --patch`.
- Use Turbo for builds, tests, and typechecks.

---

### Task 1: Validate and publish the Plugin SDK contract

**Files:**
- Modify: `packages/plugin-sdk/src/app-contract.ts`
- Modify: `packages/plugin-sdk/src/internal/plugin-app-collector.ts`
- Test: `packages/plugin-sdk/src/testing/__tests__/app-harness.test.tsx`
- Modify via script: `packages/plugin-sdk/package.json`
- Modify via script: `packages/domain/src/constants.ts`

**Interfaces:**
- Consumes: existing `PluginNavPanelRegistration`, `ComponentType`, `requireSlotId`, `requireNonEmptyString`, and `PLUGIN_SLOT_ID_PATTERN`.
- Produces: `PluginNavPanelRegistration.experimental_sidebarSubItems` as a normalized readonly array of `{ id, title, icon?, subPath, experimental_sidebarAccessory? }`.

- [ ] **Step 1: Write failing collector tests**

Add one acceptance test that registers two ordered children, including an icon and accessory, then asserts the captured objects. Add table-driven rejection cases for an empty/non-array value, duplicate id, duplicate subpath, leading/trailing slash, empty/traversal/query/fragment segments, empty title/icon, and non-component accessory. Mutation after registration must not change the captured array.

```tsx
const sidebarSubItems = [
  {
    id: "issues",
    title: "Issues",
    icon: "CircleDot",
    subPath: "issues",
    experimental_sidebarAccessory: IssueCount,
  },
  { id: "reviews", title: "Reviews", subPath: "reviews/open" },
];

expect(captured.navPanels[0]?.experimental_sidebarSubItems).toEqual(
  sidebarSubItems,
);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm exec turbo run test --filter=@get-bb/plugin-sdk -- --run packages/plugin-sdk/src/testing/__tests__/app-harness.test.tsx
```

Expected: typecheck/test compilation fails because `experimental_sidebarSubItems` is not in the contract.

- [ ] **Step 3: Add the inline contract and collector normalization**

Add the optional inline field to `PluginNavPanelRegistration`. In the collector, add it to `NAV_PANEL_REGISTRATION_KEYS`, validate a non-empty array, copy each child, and reject ambiguous routes.

```ts
experimental_sidebarSubItems?: readonly {
  id: string;
  title: string;
  icon?: string;
  subPath: string;
  experimental_sidebarAccessory?: ComponentType;
}[];
```

Use a focused helper that accepts a relative `subPath` only when every `/`-separated segment is non-empty, not `.` or `..`, and contains neither `?` nor `#`. Track both ids and subpaths in sets. Copy only validated known fields into the collected registration.

- [ ] **Step 4: Run Plugin SDK tests and typecheck**

```bash
pnpm exec turbo run test typecheck --filter=@get-bb/plugin-sdk
```

Expected: PASS.

- [ ] **Step 5: Bump the public SDK patch version**

```bash
node scripts/bump-plugin-sdk.mjs --patch
```

Expected: `@get-bb/plugin-sdk` and the shared domain version constant move from `0.4.29` to `0.4.30`.

- [ ] **Step 6: Commit the contract**

```bash
git add packages/plugin-sdk packages/domain
git commit -m "Add plugin sidebar sub-item contract"
```

---

### Task 2: Carry child chrome through frontend boot

**Files:**
- Modify: `apps/app/src/lib/plugin-nav-panel-chrome.ts`
- Test: `apps/app/src/lib/plugin-nav-panel-chrome.test.tsx`

**Interfaces:**
- Consumes: normalized `experimental_sidebarSubItems` from Task 1.
- Produces: `PluginNavPanelChrome.experimental_sidebarSubItems`, containing only serializable `{ id, title, icon?, subPath }` values.

- [ ] **Step 1: Write failing cache tests**

Extend the Tasks fixture with children and a live accessory component. Assert that pre-boot remembered chrome contains child ids, titles, icons, and subpaths but no `experimental_sidebarAccessory`, and that the live panel still retains the component.

```ts
expect(readLastKnownPluginNavPanelChrome()[0]?.experimental_sidebarSubItems).toEqual([
  { id: "issues", title: "Issues", icon: "CircleDot", subPath: "issues" },
]);
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm exec turbo run test --filter=@bb/app -- --run apps/app/src/lib/plugin-nav-panel-chrome.test.tsx
```

Expected: FAIL because child chrome is not cached.

- [ ] **Step 3: Extend the Zod cache schema and mapper**

Add a child chrome schema, make its array optional, map live registrations to serializable copies, and bump the last-known cache version from `1` to `2` so older persisted data is discarded safely.

```ts
const pluginNavPanelSidebarSubItemChromeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  icon: z.string().min(1).optional(),
  subPath: z.string().min(1),
});
```

- [ ] **Step 4: Run the focused test and typecheck**

```bash
pnpm exec turbo run test typecheck --filter=@bb/app -- --run apps/app/src/lib/plugin-nav-panel-chrome.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit boot-safe chrome**

```bash
git add apps/app/src/lib/plugin-nav-panel-chrome.ts apps/app/src/lib/plugin-nav-panel-chrome.test.tsx
git commit -m "Cache plugin sidebar sub-item chrome"
```

---

### Task 3: Render accessible expandable child rows

**Files:**
- Modify: `apps/app/src/components/plugin/pluginNavSidebarAtoms.ts`
- Modify: `apps/app/src/components/plugin/PluginNavSidebarItems.tsx`
- Test: `apps/app/src/components/plugin/PluginNavSidebarItems.test.tsx`

**Interfaces:**
- Consumes: `PluginNavPanelChrome.experimental_sidebarSubItems` and the matching live panel registration.
- Produces: `expandedPluginNavPanelsAtom`, parent disclosure controls, child route matching, child navigation/split content, and isolated child accessories.

- [ ] **Step 1: Expand the test registration helper**

Allow `registerPanel` to accept `experimental_sidebarSubItems` and allow `renderSidebarItems` to choose the initial route. Keep the existing no-children test as the regression assertion for unchanged plugins.

- [ ] **Step 2: Write failing behavior tests**

Add focused tests proving:

- the parent exposes an accessible collapsed disclosure;
- clicking it renders ordered indented children and persists the parent key;
- re-mounting restores expansion;
- `/plugins/lens/main/issues/123` reveals and marks Issues active, while `issues-old` does not;
- the parent title still navigates to the panel root;
- a child click navigates to its subpath;
- a child icon renders when supplied and alignment remains when omitted;
- the child accessory is absent on compact viewports, isolated on crash, and retried on plugin reload;
- hiding a parent removes its children and showing it restores the group;
- children never get panel-options buttons or sortable identities.

Use stable accessible queries such as:

```tsx
const disclosure = screen.getByRole("button", { name: "Expand Lens" });
expect(disclosure.getAttribute("aria-expanded")).toBe("false");
fireEvent.click(disclosure);
expect(screen.getByRole("button", { name: "Issues" })).toBeTruthy();
```

- [ ] **Step 3: Run the focused sidebar test and confirm RED**

```bash
pnpm exec turbo run test --filter=@bb/app -- --run apps/app/src/components/plugin/PluginNavSidebarItems.test.tsx
```

Expected: FAIL because no disclosure or child rows exist.

- [ ] **Step 4: Add persisted expansion state**

Add a string-array atom following the existing storage pattern:

```ts
export const expandedPluginNavPanelsAtom = atomWithStorage<string[]>(
  "bb.sidebar.expandedPluginPanels",
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);
```

- [ ] **Step 5: Render the parent group and child rows**

Keep the existing `SidebarNavRowChrome` path untouched for rows without children. For a panel with children, render sibling disclosure and navigation buttons, then children when stored-expanded or route-active. Use the existing `getPluginPanelRoutePath`, `PluginIcon`, `usePaneContentSplitDrag`, `usePaneContentSplitIndicator`, and `PluginSlotMount` patterns. Match child live registrations by `id`; remembered chrome can render navigation before the live component arrives, while its accessory waits for the live registration.

Child split content must be:

```ts
{
  kind: "plugin-panel",
  pluginId: chrome.pluginId,
  panelPath: chrome.path,
  subPath: child.subPath,
}
```

Mount child accessories with a slot id that cannot collide with the parent, such as `${panel.id}/${child.id}`, while retaining `slotKind="navPanelSidebarAccessory"` and the live plugin generation key.

- [ ] **Step 6: Run focused tests and app typecheck**

```bash
pnpm exec turbo run test typecheck --filter=@bb/app -- --run apps/app/src/components/plugin/PluginNavSidebarItems.test.tsx
```

Expected: PASS, including all pre-existing sidebar tests.

- [ ] **Step 7: Commit the sidebar UI**

```bash
git add apps/app/src/components/plugin apps/app/src/lib/plugin-nav-panel-chrome.ts apps/app/src/lib/plugin-nav-panel-chrome.test.tsx
git commit -m "Render plugin sidebar sub-items"
```

---

### Task 4: Document and exercise the public feature

**Files:**
- Modify: `docs/api_to_audit.md`
- Modify: `packages/plugin-api-map/src/surfaces.ts`
- Modify: `packages/templates/src/templates/bb-guide-plugins.md`
- Modify: `apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/references/frontend-core-slots.md`
- Modify: `apps/server/test/services/plugins/plugin-authoring-docs.test.ts`
- Modify: `plugins/plugin-api-tester/app.tsx`
- Test: `plugins/plugin-api-tester/app.test.tsx`

**Interfaces:**
- Consumes: the exact Task 1 field and child property names.
- Produces: discoverable Plugin Guide/API-map documentation and a development-only representative registration for live QA.

- [ ] **Step 1: Write failing documentation and tester assertions**

Add `experimental_sidebarSubItems` to `NAV_PANEL_REGISTRATION_FIELDS`. Extend the plugin API tester assertion with child metadata and make the panel body display the received `subPath`, proving deep links reach the component.

- [ ] **Step 2: Run focused docs and tester tests and confirm RED**

```bash
pnpm exec turbo run test --filter=@bb/server --filter=bb-plugin-plugin-api-tester
```

Expected: FAIL until the guide and tester registration include the new field.

- [ ] **Step 3: Update every discoverable surface**

Document the API with this canonical example:

```tsx
experimental_sidebarSubItems: [
  {
    id: "issues",
    title: "Issues",
    icon: "CircleDot",
    subPath: "issues",
    experimental_sidebarAccessory: OpenIssueCount,
  },
],
```

Explain parent-owned ordering/hiding, persisted disclosure, active deep routes,
desktop-only accessories, and unchanged behavior when omitted. Add a dedicated
`docs/api_to_audit.md` entry covering component-versus-value accessories,
route grammar, nesting depth, item count, compact behavior, accessibility,
and whether sub-items should stabilize with the parent accessory. Add a bullet
to the API map's Full-page panels card without inventing a second surface.

- [ ] **Step 4: Register representative children in Plugin API Tester**

Register two children, one with an icon and accessory, and render the current
`subPath` in `PluginApiTesterPanel`. This fixture is development-only and gives
the live loop a stable target without changing a product plugin.

- [ ] **Step 5: Run docs, API-map, template, and tester gates**

```bash
pnpm exec turbo run test typecheck --filter=@bb/server --filter=@bb/templates --filter=@bb/plugin-api-map --filter=bb-plugin-plugin-api-tester
```

Expected: PASS.

- [ ] **Step 6: Commit documentation and fixture coverage**

```bash
git add docs/api_to_audit.md packages/plugin-api-map packages/templates apps/server/src/services/skills/builtin-skills/bb-plugin-authoring apps/server/test/services/plugins/plugin-authoring-docs.test.ts plugins/plugin-api-tester
git commit -m "Document plugin sidebar sub-items"
```

---

### Task 5: Run complete affected verification and live QA

**Files:**
- Verify all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: the complete feature.
- Produces: current test, typecheck, build, and runtime evidence.

- [ ] **Step 1: Run all affected automated gates through Turbo**

```bash
pnpm exec turbo run test typecheck build --filter=@get-bb/plugin-sdk --filter=@bb/app --filter=@bb/server --filter=@bb/templates --filter=@bb/plugin-api-map --filter=bb-plugin-plugin-api-tester > /tmp/plugin-sidebar-sub-items-turbo.log 2>&1
```

Expected: exit 0. Read the bounded tail from `/tmp/plugin-sidebar-sub-items-turbo.log` and preserve the command and result in the handoff.

- [ ] **Step 2: Run repository diff checks**

```bash
git diff --check origin/main...HEAD
git status --short
```

Expected: no whitespace errors and no uncommitted implementation changes.

- [ ] **Step 3: Exercise the development fixture in the live app**

Launch the repository QA app with `scripts/bb-dev-app`, open Plugin API Tester,
and verify desktop and compact behavior: disclosure, both child icons/alignment,
live accessory, persisted collapse/expand, direct child deep link, keyboard
focus/activation, and split opening. Confirm health and settled renderer behavior.

- [ ] **Step 4: Record any environment boundary honestly**

If browser or local runtime access is unavailable, keep automated evidence
separate and report live QA as unverified rather than converting build success
into a runtime claim.

- [ ] **Step 5: Commit any verification-driven fixes**

```bash
git add -u
git commit -m "Fix plugin sidebar sub-item verification findings"
```

Skip this commit when verification required no code changes.

# WP-26 — Manual triage flow & keyboard shortcuts

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §2 Flow A, §3.4, §3.6, §4.4 · RECON §2.6 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-25, WP-27 · **Blocks:** Golden Loop manual review behavior
**Produces a FROZEN artifact:** no — replace only the WP-24 triage stub and call WP-27's local writer.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/ui/triage/{index,TriageEditor,BulkDecisionBar,JustificationPicker,ShortcutSheet}.tsx
plugins/bb-plugin-finite-state/lanes/findings/ui/triage/{keyboard,undo,validation}.ts
plugins/bb-plugin-finite-state/lanes/findings/ui/triage/*.test.tsx
```

## Files you must not touch
Frontend/backend registration, frozen interfaces, table/detail internals, overlay writer/index, sync push, theme/formatters, dependencies, and other lanes.

## Context
Manual triage speed is a core product claim. Every action writes reviewable local YAML through WP-27; **nothing in this package contacts Forge or pushes**. Six VEX statuses use six explicit keys. `NOT_AFFECTED` requires one of the nine exact justifications, and `CODE_NOT_REACHABLE` forces `pin: exact_version`. UUIDs are irrelevant; the selected stable key is the target. UI follows shared-ui/Hugeicons/theme-token rules and all four states.

## What to build
1. Implement global shortcuts scoped to the active findings surface: `j/k` navigate, `Enter` detail, `/` filter, `x` toggle, `Shift-X` range, `b` bulk bar, `u` undo, `?` sheet, plus the exact status map `n` NOT_AFFECTED, `e` EXPLOITABLE, `t` IN_TRIAGE, `f` FALSE_POSITIVE, `r` RESOLVED, `R` RESOLVED_WITH_PEDIGREE.
2. Never intercept keys inside inputs, textareas, contenteditable elements, dialogs, or while modifier chords belong to the host. Surface shortcuts through ARIA descriptions and the shortcut sheet.
3. For a status decision, open inline fields as required: justification for `NOT_AFFECTED`, optional response, reason (minimum meaningful length), evidence, and pin. Seed reason from reachability evidence but require user confirmation.
4. Enforce the exact 6/5/9 VEX vocabularies from the frozen contract. Force exact-version for `CODE_NOT_REACHABLE` and disable the promotion control with an explanation.
5. Commit with Cmd/Ctrl+Enter via WP-27's CAS writer, update local UI optimistically only after CAS success, auto-advance, and announce the result accessibly.
6. Bulk actions operate on explicit or predicate selection. Preview counts and require confirmation; stream writes in bounded chunks to the local writer, reporting individual failures without losing successful YAML changes.
7. Implement session undo as a compensating CAS write restoring the exact prior decision. Undo is local only and must refuse if the file changed since the action.
8. Render no-selection empty, loading/commit pending, scoped write error, and unconfigured states without losing the user's draft.

## Interface contract
```ts
export const VEX_SHORTCUTS = {
  n: "NOT_AFFECTED", e: "EXPLOITABLE", t: "IN_TRIAGE",
  f: "FALSE_POSITIVE", r: "RESOLVED", R: "RESOLVED_WITH_PEDIGREE",
} as const;
export interface TriageDraft {
  stableKey: string;
  status: VexStatus;
  justification: VexJustification | null;
  response: VexResponse | null;
  reason: string;
  evidence: string;
  pin: "exact_version" | "any_version";
}
export interface UndoToken { file: string; beforeSha256: string; afterSha256: string; prior: unknown; }
export function validateTriageDraft(draft: TriageDraft): { ok: true } | { ok: false; field: string; message: string };
```

## Acceptance criteria
- [ ] All listed shortcuts work and never fire while the user types in an editor/control.
- [ ] Six status letters map one-to-one to frozen VEX statuses and are documented in `?`.
- [ ] `NOT_AFFECTED` cannot commit without a valid justification.
- [ ] `CODE_NOT_REACHABLE` cannot be saved with `any_version`.
- [ ] Single and predicate-bulk decisions write YAML only; network/Forge spies stay at zero.
- [ ] Partial local-write failure preserves successes and lists failed stable keys with retry.
- [ ] Undo restores prior bytes only when CAS still matches; concurrent edit is preserved.
- [ ] UI uses Hugeicons/shared-ui/theme tokens and covers loading, empty, error, unconfigured.

## Test plan
`triage-keyboard.test.tsx`
- `j/k and Enter preserve cursor`, `six status shortcuts open correct draft`, `input focus suppresses shortcuts`, `Shift-X selects range`, and `? is complete`.

`triage-flow.test.tsx`
- `valid decision writes once and advances`, `NOT_AFFECTED validation`, `CODE_NOT_REACHABLE pin enforcement`, and `bulk partial result retry`.
- **Error path:** CAS conflict retains the user's draft and offers Reload/Compare; it never overwrites the newer file.
- **Undo fault path:** external edit after commit makes undo fail closed.

## Do not
- Do not call a model-mutating endpoint, plan, or push from a keypress.
- Do not fabricate a reason/justification or treat pre-seeded text as approved.
- Do not use browser-global handlers without mount/unmount scoping.
- Do not create a second overlay schema or stable-key codec.

## Open questions
1. Session undo is intentionally not a persisted history; git remains the durable recovery mechanism.
2. `Shift-X` is the index-authoritative range shortcut; retain `J/K` extension only as an optional alias if it does not conflict with host navigation.

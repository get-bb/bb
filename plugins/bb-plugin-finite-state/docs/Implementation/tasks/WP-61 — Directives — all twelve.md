# WP-61 — Directives — all twelve

**Lane:** L7 Agentic surfaces · **Spec:** SPEC 00 §7–8 · SPEC 06 §2.2, §4.6 · RECON §1.3, §1.6, §1.12 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-57 and the owning domain-component WPs (WP-21, WP-25, WP-28, WP-32–40, WP-42, WP-45, WP-54–56) · **Blocks:** WP-65, WP-67, WP-68, WP-69
**Produces a FROZEN artifact:** no

> **SPEC 07/08 intake note (2026-08-12).** "All twelve" is now the SPEC 06
> set only. Eight more directives ship with their surfaces, not here:
> `::fs-schematic` `::fs-part` `::fs-board` `::fs-drc` in WP-81 and
> `::fs-citation` `::fs-probe` `::fs-serial` `::fs-build` in WP-96 — all
> following this WP's registration and self-fetching-component conventions.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/agentic/register.app.tsx
plugins/bb-plugin-finite-state/lanes/agentic/directives/attributes.ts
plugins/bb-plugin-finite-state/lanes/agentic/directives/DirectiveBoundary.tsx
plugins/bb-plugin-finite-state/lanes/agentic/directives/register.tsx
plugins/bb-plugin-finite-state/lanes/agentic/directives/directives.test.tsx
plugins/bb-plugin-finite-state/lanes/agentic/directives/attributes.test.ts
```

## Files you must not touch
`app.tsx`, backend composition, frozen interfaces, the domain components owned by other lanes, theme/dependencies, agent tools, or mock fixtures.

## Context
Directives are live, compact renderings of the exact same self-fetching components used in panels and sync diffs. They are not a second model or a place to trust message text. `messageDirective` attributes arrive as untrusted strings. Every directive validates them, fetches by id through the owning RPC, survives cold/offline cache state, and falls back to safe literal text under an error boundary.

## What to build
1. Register exactly twelve ids: `fs-plan`, `fs-finding`, `fs-triage-summary`, `fs-threat`, `fs-canvas`, `fs-req`, `fs-matrix`, `fs-component`, `fs-hbom-summary`, `fs-bench`, `fs-verdict`, and `fs-doc`.
2. Replace the WP-01 frontend agentic stub with a composition-only registrar. Each id maps to a wrapper that imports the owner lane's domain component; do not fork card implementations.
3. Parse attributes through per-directive Zod schemas. Required identity is `id` except for canvas, matrix, and HBOM summary; accept only the documented auxiliary keys. Reject oversized ids/filter strings and unsafe route values.
4. Treat triage stable keys as opaque and use the shared route encoder. Never interpolate raw identity into a URL or filesystem path.
5. Add a shared boundary with designed loading skeleton, actionable empty/cold-cache state, retryable error, and unconfigured state. Unknown ids render a bounded “not found / pull to load” card, never crash the message.
6. Keep canvas read-only in-message, lazy-loaded, height-clamped, and linked to the full panel. Matrix is capped at 15 rows. Logs and unbounded lists remain virtualized in their owner components.
7. Ensure every card opens the owning panel/subPath and uses `openWorkspaceFile` only for validated workspace-relative paths.
8. Consume bb theme tokens, `@bb/shared-ui`, and Hugeicons only. Severity/verdict states use label plus color.
9. Test cold cache and warm cache offline; directive rendering must never trigger a Forge call.

## Interface contract
```tsx
type DirectiveProps = {
  attributes: Readonly<Record<string, string>>;
  source: string;
  message: { id: string; threadId: string; turnId: string; projectId: string };
  openWorkspaceFile(path: string): void;
};

export const directiveSchemas = {
  "fs-plan": z.strictObject({ id: boundedId }),
  "fs-finding": z.strictObject({ id: boundedId }).or(z.strictObject({ cve: boundedId, purl: boundedId })),
  "fs-triage-summary": z.strictObject({ id: boundedId, version: boundedId.optional() }),
  "fs-threat": z.strictObject({ id: boundedSlug }),
  "fs-canvas": z.strictObject({ focus: boundedSlug.optional(), highlight: boundedSlug.optional(), height: z.coerce.number().min(280).max(560).default(420) }),
  "fs-req": z.strictObject({ id: boundedSlug }),
  "fs-matrix": z.strictObject({ filter: boundedFilter.optional() }),
  "fs-component": z.union([z.strictObject({ purl: boundedId }), z.strictObject({ part: boundedSlug })]),
  "fs-hbom-summary": z.strictObject({}),
  "fs-bench": z.strictObject({ id: boundedId }),
  "fs-verdict": z.strictObject({ id: boundedId }),
  "fs-doc": z.strictObject({ id: boundedId }),
} as const;

export function registerDirectives(app: PluginAppBuilder, ctx: AppContext): void;
```
Use the current SDK's actual directive prop type instead of duplicating it if exported.

## Acceptance criteria
- [ ] Twelve and only twelve ids are registered; registry and UI sets are identical.
- [ ] Every attribute is parsed as an untrusted string and unknown keys are rejected.
- [ ] Every directive reuses an owner domain component or a bounded composition of them; no copied business logic.
- [ ] All four UI states are implemented and tested.
- [ ] Unknown/malformed ids show a safe fallback and never throw from the message tree.
- [ ] Cold-cache and warm-cache renders work offline with zero Forge calls.
- [ ] Canvas is read-only/lazy in-message; matrix cannot render more than 15 rows.
- [ ] Theme-token, shared-ui, and Hugeicons rules pass lint.
- [ ] Click-through navigation targets the correct panel and validated subPath.

## Test plan
`attributes.test.ts`
- one valid and malformed fixture for every schema.
- `extra attributes and oversized values are rejected` (**input error path**).
- `raw stable key cannot escape route encoder`.

`directives.test.tsx`
- one cold-cache and warm-cache render per directive.
- `RPC failure renders retry card and ErrorBoundary preserves message` (**runtime error path**).
- `unconfigured host renders setup guidance`.
- `canvas lazy chunk has open-in-panel affordance and no mutation control`.
- `no directive performs a Forge request`.
- `registry parity with AGENT_SURFACE.directives`.

## Do not
- Do not render attribute strings as HTML or use them as unvalidated URLs/paths.
- Do not duplicate domain cards or fetch directly from Forge.
- Do not add mutations, push controls, HBOM acceptance, or conflict resolution inside a message.
- Do not introduce hex colors, Lucide, emoji, or new UI dependencies.
- Do not make cold cache look like an empty successful result.

## Open questions
1. Confirm the owner component import names after their WPs merge; adapt only this wrapper, not the domain API.
2. Keep in-message canvas non-interactive unless a rehearsal produces an explicit amendment with accessibility and conflict semantics.

# WP-62 — Mention providers

**Lane:** L7 Agentic surfaces · **Spec:** SPEC 06 §2.3 · RECON §1.7 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-57 and query/index services from WP-22, WP-23, WP-36, WP-41, WP-44, WP-52, WP-56 · **Blocks:** WP-65, WP-67–69
**Produces a FROZEN artifact:** no

> **SPEC 07 intake note (2026-08-12).** WP-81 later extends the `fs-intel`
> provider on `#` to resolve reference designators (`#U3`), pattern-
> disambiguated, surface named in the result label. Design `fs-intel`'s
> internal source registry so a third resolver can be added without
> re-registering the provider or touching this WP's files.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/agentic/mentions/register.ts
plugins/bb-plugin-finite-state/lanes/agentic/mentions/search.ts
plugins/bb-plugin-finite-state/lanes/agentic/mentions/resolve.ts
plugins/bb-plugin-finite-state/lanes/agentic/mentions/mentions.test.ts
plugins/bb-plugin-finite-state/lanes/agentic/mentions/mentions.integration.test.ts
```

## Files you must not touch
Composition roots, frozen contracts, owner indexes/query services, directives/tools, skills/CLI, manifest, dependencies, or fixtures.

## Context
Mentions let the user attach fresh structured context at send time. The partition is semantic: `@` authored things, `#` external intelligence, `~` events/evidence. Search runs server-side while typing and must finish inside two seconds; failures degrade to no suggestions. Resolve runs at send time and must never throw because a thrown resolver blocks the message.

## What to build
1. Register four providers across three triggers: `fs-model` and `fs-docs` on `@`, consolidated `fs-intel` on `#`, and `fs-runs` on `~`.
2. Search cache/YAML indexes only. Do not call any remote service, scan the whole worktree, parse whole documents, or block on a pull while the user types.
3. Apply a 2-second deadline and cancellation signal. Search failures log at debug/warn and return `[]`; keep provider failures isolated.
4. Rank exact id/prefix matches first, then normalized name matches. `fs-intel` deduplicates components that appear in findings/SBOM/HBOM and routes CVE/GHSA, purl/component, and MPN/ref-des patterns internally.
5. Return bounded display labels, descriptions, and opaque item ids. Escape untrusted source text and cap results.
6. Resolve at send time from fresh local state, returning a compact context block with identity, current status/decision, evidence/source ids, freshness, and the most relevant directive syntax.
7. A missing/deleted item resolves to a safe context explaining it is no longer present and suggesting a query; it does not throw or silently attach stale content.
8. Keep resolution under the context budget and never include full documents, raw findings, logs, or firmware bytes.

## Interface contract
```ts
export function registerMentions(bb: BbPluginApi, ctx: PluginContext): void;

type MentionProviderId = "fs-model" | "fs-docs" | "fs-intel" | "fs-runs";
type MentionItem = { id: string; label: string; description?: string; keywords?: string[] };

interface MentionIndex {
  search(provider: MentionProviderId, query: string, signal: AbortSignal): Promise<MentionItem[]>;
  resolve(provider: MentionProviderId, itemId: string): Promise<{
    context: string;
  }>;
}

const PROVIDERS = [
  { id: "fs-model", label: "Finite State model", triggers: ["@"] },
  { id: "fs-docs", label: "Finite State documents", triggers: ["@"] },
  { id: "fs-intel", label: "Finite State intelligence", triggers: ["#"] },
  { id: "fs-runs", label: "Finite State runs", triggers: ["~"] },
] as const;
```
Verify the actual `search(ctx)` return-item shape against `plugins/tasks/`; the behavior above is binding even if property names differ.

## Acceptance criteria
- [ ] Exactly four providers and the canonical `@/#/~` mapping are registered once per factory execution.
- [ ] Search is cache/index-only, capped, deadline-bound, cancellable, and failure-isolated.
- [ ] Consolidated `fs-intel` returns one ranked result for the same component across sources.
- [ ] Resolve reads current local state at send time and never throws.
- [ ] Missing ids attach an honest recovery context instead of blocking send.
- [ ] Context includes stable identity and freshness but excludes raw/bulk payloads.
- [ ] No resolver can mutate YAML, invoke Forge, push, or accept a review item.

## Test plan
`mentions.test.ts`
- exact/prefix/fuzzy ranking for every provider.
- `CVE, purl/name, and MPN route through one fs-intel provider without duplicates`.
- `search deadline returns empty and records timeout` (**timeout path**).
- `resolver exception is caught and converted to safe context` (**send-blocking error path**).
- `deleted item resolves as missing, never stale success`.

`mentions.integration.test.ts`
- update a local decision between search and resolve; assert resolved context reflects the newer state.
- one provider failure does not suppress other-provider results.
- context byte-size stays within the agentic budget on maximal seed entities.

## Do not
- Do not register two competing `#` providers.
- Do not throw from `resolve`, even for malformed ids or storage failures.
- Do not fetch Forge or parse full document bodies while typing.
- Do not attach secrets, raw audit payloads, logs, or unbounded lists.
- Do not use server UUIDs where a stable slug/key exists.

## Open questions
1. Verify how the current bb UI merges multiple providers on `@`; both providers still remain distinct and must return disjoint item-id namespaces.
2. Confirm whether the SDK passes an abort signal; if not, implement the two-second race and ignore late results safely.

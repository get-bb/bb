# WP-07 — FSDS theme, tokens & `lib/format.ts`

**Lane:** L0 Foundation · **Spec refs:** SPEC 00 §7 · UX & Front-End Plan §2 · RECON §1.3, §1.12 · **Effort:** 1.5 d · **Status:** unassigned
**Depends on:** WP-01 · **Blocks:** WP-21 and every UI work package
**Produces a FROZEN artifact:** no

## Files you own
`plugins/bb-plugin-finite-state/themes/fsds-dark.css`
`plugins/bb-plugin-finite-state/lib/format.ts`
`plugins/bb-plugin-finite-state/lib/format.test.ts`
`plugins/bb-plugin-finite-state/themes/fsds-dark.test.ts`
`plugins/bb-plugin-finite-state/assets/fonts/README.md` *(license/source record only; font bytes stay embedded in CSS)*

## Files you must not touch
`package.json`/manifest, composition roots, frozen interfaces, lanes, lockfile, bb shared UI, or global bb themes.

## Context
FSDS is shipped as a bb theme declared by WP-01's manifest; there is no frontend theme-registration API. The theme maps the authoritative FSDS source tokens onto bb CSS variables, so plugin components remain host-compatible by using `bg-card`, `text-muted-foreground`, and other bb token classes. Space Grotesk is the distributable heading stand-in; Instrument Sans is body copy. Font and design-system source/license must be verified at implementation time from `/CEO Strategy/Design System/`; this repo's supporting UX document is not a replacement for the source assets.

## What to build
1. Read the current bb theme variable contract and an official bundled theme. Map every required light/dark-independent variable into one dark FSDS theme scope using the selector convention verified in the fork.
2. Map FSDS canvas, surface, border, text, muted, teal primary, orange accent, destructive, warning, success, focus ring, chart, and severity tokens. Do not invent component-specific colors.
3. Embed licensed WOFF2 bytes as base64 `@font-face` sources inside the single CSS file. Record original filenames, licenses, hashes, and the Space Grotesk substitution rationale in `assets/fonts/README.md`. Use `font-display: swap`.
4. Provide visible focus, reduced-motion compatibility, selection color, monospace fallback, and adequate foreground/background contrast. Severity always has a text label at component level; token colors support but never replace it.
5. Implement pure formatters for severity, CVSS, EPSS, ISO dates, relative dates, hashes, purls, byte sizes, and counts. Inputs are nullable/untrusted; outputs are deterministic and locale-independent unless the locale is an explicit parameter.
6. Add a mechanical CSS test that rejects raw color literals in `lanes/**` later via WP-09, while this WP tests that the theme itself defines all required variables.

## Interface contract
```ts
// lib/format.ts
export type Severity = "critical" | "high" | "medium" | "low" | "none" | "unknown";
export function formatSeverity(value: string | null | undefined): { label: string; severity: Severity };
export function formatCvss(value: number | null | undefined): string;       // em dash or one decimal, clamp/reject outside 0..10
export function formatEpss(value: number | null | undefined): string;       // em dash or percentage; input 0..1
export function formatIsoDate(value: string | null | undefined): string;    // YYYY-MM-DD or em dash; UTC
export function formatRelativeDate(value: string | null | undefined, now: Date): string;
export function formatHash(value: string | null | undefined, visible?: number): string;
export function formatPurl(value: string | null | undefined, max?: number): string;
export function formatBytes(value: number | null | undefined): string;      // IEC units, deterministic
export function formatCount(value: number | null | undefined): string;
```

Theme variable identifiers are not reproduced here because the current bb theme contract is authoritative. At minimum the implemented file must cover the complete variable set of the current official dark theme and define `--font-sans`, `--font-heading`, and `--font-mono` using verified bb-supported names.

## Acceptance criteria
- [ ] Selecting manifest theme `plugin:finite-state:fsds-dark` (or the current verified generated id) skins bb and plugin surfaces without runtime registration.
- [ ] Theme CSS is one self-contained file; font network requests are zero.
- [ ] Font license/source/hash record exists and only distributable assets are embedded.
- [ ] Every variable required by the current bb official dark theme is defined; focus and destructive states remain legible.
- [ ] Every formatter is pure, deterministic, null-safe, and covered at boundaries.
- [ ] `lib/format.ts` contains no React/browser dependency.
- [ ] Typecheck/test/lint/build is green.

## Test plan — `fsds-and-format`
- `theme declares complete host variable set` — parse variables and compare to the verified official dark-theme baseline.
- `theme has two embedded WOFF2 faces and no url(http)` (**error path**).
- `contrast smoke matrix` — primary text, muted text, destructive, warning, success, and focus meet the product's chosen WCAG threshold; fail with the token pair named.
- `format numeric boundaries` — CVSS 0/10/out-of-range, EPSS 0/1/out-of-range, byte units and negative input (**error path**).
- `format invalid dates and identifiers` — returns em dash/unknown, never throws (**error path**).

## Do not
- Do not call a nonexistent `definePluginApp` theme API.
- Do not hard-code FSDS hex/oklch values in components; raw values belong only in this theme source.
- Do not use Lucide or emoji.
- Do not copy licensed TWK Everett into the repository without explicit distribution permission.
- Do not add a date/formatting dependency.

## Open questions
1. Confirm exact FSDS source paths and font redistribution rights before embedding bytes.
2. Confirm whether the current bb theme selector/variable set changed after SDK 0.4.1; copy identifiers from source, not from the UX sketch.

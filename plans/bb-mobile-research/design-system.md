## Token model (apps/app/src/components/ui/theme.css)

Tailwind v4 (no tailwind.config; `@import "tailwindcss"` + `@theme inline` at theme.css:1-102, plugin `@tailwindcss/vite` in apps/app/vite.config.ts:6). Two-tier token system:

**Anchors → derived ramp.** Each mode defines `--canvas` and `--ink` (light: `oklch(1 0 0)` / `oklch(0.3211 0 0)` at theme.css:408-409; dark: `oklch(0.195 0 0)` / `oklch(0.81 0 0)` at 654-658). Every neutral surface is `color-mix(in oklch, var(--ink) N%, var(--canvas))` (opaque) or `color-mix(in oklab, var(--ink) N%, transparent)` (translucent). Mix percentages (light/dark): secondary & accent 8/13; muted 11/16; state-hover 5.9/13.8 (translucent); state-active 11.8/22.5 (translucent); border 14/19.4; border-hairline 14.7/21; border-seam 9.5/11; input 29.5/32.6; sidebar 2.2/4.3; sidebar-accent 8/12; sidebar-border 14/18.1; surface-recessed 6 (translucent, both); surface-raised 2.5; surface-recessed-soft-solid 4.2. `card` and `popover` are `var(--canvas)` (flush; elevation via border+shadow — guarded by theme.test.ts:205-214). Ordering invariants guarded in theme.test.ts:216-235 (fills < border ≤ input; active > hover; sidebar < secondary).

**Hand-set semantic colors** (light/dark): primary `oklch(0.27 0 0)`/`oklch(0.82 0 0)`, primary-foreground `oklch(1 0 0)`/`oklch(0.2178 0 0)`; muted-foreground 0.44/0.78; subtle-foreground 0.5/0.68; readback-foreground 0.47/0.715; timeline-accent `oklch(0.55 0.1 250)`/`oklch(0.72 0.09 250)`; destructive `oklch(0.45 0.19 25.86)`/`oklch(0.56 0.19 22.17)`; destructive-text same-as-fill light / `oklch(0.65 0.16 22)` dark; attention 0.74/0.8 chroma .15 hue 80; warning `0.7 0.16 50`/`0.75 0.16 50`; success `0.7 0.15 155`/`0.74 0.15 155`; diff-added `0.4 0.13 163`/`0.77 0.17 163`; diff-removed `0.4 0.17 28`/`0.72 0.19 22`; pr-merged `0.53 0.2 295`/`0.68 0.18 295`; ring = primary. Plus surface-destructive/-attention/-selected (translucent mixes of destructive/attention/primary), pill-surface gradients, sidebar-search-match (manilla), 16-color ANSI palette + ansi-bg-fg (theme.css:605-637, 819-851), and `--diffs-*` bridge for @pierre/diffs.

**Radii:** `--radius: 0.5rem`; sm = radius-4px (4px), md = radius-2px (6px), lg = 8px, xl = 12px (theme.css:88-91).
**Spacing:** `--spacing: 0.25rem` (Tailwind default 4px grid).
**Typography:** `--font-sans: "Inter Variable", Inter, sans-serif` (loaded via `@import "@fontsource-variable/inter"` in app.css:1); `--font-mono: "Fira Code", monospace` (not bundled — falls back); serif Georgia. Scale overrides theme.css:118-139: text-2xs 10px/14px, text-sm 13px, text-base 15px/22px (Tailwind defaults otherwise: xs 12px). Under `(max-width:767px) and (pointer:coarse)`: 2xs 11px, xs 14px/20px, sm 15px/22px, base 16px/24px. `--icon-stroke-width: 1.75`.
**Shadows:** flat 2px-offset hard shadows: light `0 2px 0 0 hsl(0 0% 20%/.15)` family; dark uses black at .3-.6 alpha (theme.css:566-587, 798-817); `--shadow-lift` upward for composer.
**Sidebar row heights:** `--bb-sidebar-row-height: 1.75rem`, coarse `2.5rem`.

Coarse-pointer sizing tokens (class strings) in packages/shared-ui/src/components/ui/coarse-pointer-sizing.ts: input h-9→h-10, compact row h-7→h-9, header icon button 28px→36px, icons size-4→size-5, etc. Motion tokens in motion.ts: `CONTROL_HOVER_TRANSITION` (150ms out, 0ms in), `LIST_HOVER_TRANSITION` (none). Chrome tokens chrome-style-tokens.ts (section label = text-xs subtle-foreground/75).

## Theme/palette selection & persistence

Two independent axes:
1. **Light/dark mode** — client-local. `apps/app/src/hooks/useTheme.ts:11-30`: `atomWithStorage("bb.theme")` in localStorage, values `light|dark|system`; toggles `.dark` class on `<html>` and mirrors `<meta name="theme-color">`. `index.html:83-88` pre-paints from localStorage. NOT server-synced.
2. **Palette** — server-owned. `GET /system/config` → `appearance: AppTheme` (`packages/server-contract/src/api/system.ts:209`; server builds it at apps/server/src/routes/system.ts:170). `AppTheme = { themeId, customCss: string|null, faviconColor, resolvedCodeTheme }` (packages/domain/src/app-theme.ts:124-134). Built-in ids: default, nord, dracula, solarized, gruvbox, catppuccin (app-theme.ts:19-26). `PUT /settings/appearance` `{themeId, faviconColor}` (public-api.ts:1351); `GET /settings/themes` catalog; SDK `sdk.theme.get/catalog/set` (packages/sdk/src/areas/theme.ts). Change broadcast via realtime `config-changed` (packages/domain/src/change-kinds.ts:56); app refetches config (system-queries.ts:466-476). Built-in palettes are **CSS strings in the frontend** (apps/app/src/lib/themes/*.ts) overriding only anchors + accents per mode; injected via `<style id="bb-app-theme">` (lib/themes/index.ts:31-42), cached in localStorage `bb.appThemeCss`. Custom themes = `<dataDir>/theme/<name>/theme.css` read server-side (apps/server/src/services/system/custom-themes.ts); plugin themes via `pluginService.readThemeCss`. Custom/plugin CSS is opaque CSS — a native app cannot apply it without a CSS parser; it CAN read `themeId` and map built-ins to native palette objects. Built-in anchor hexes per palette listed in lib/themes/{nord,dracula,solarized,gruvbox,catppuccin}.ts (e.g., nord light canvas #eceff4/ink #2e3440/primary #5e81ac; dark #2e3440/#d8dee9/#88c0d0). Catppuccin also hand-sets muted/subtle/readback.

## Primitives inventory

`packages/shared-ui/src/components/ui/` (67 files, shadcn-derived, exported via package.json subpaths). **Radix-backed:** accordion, alert-dialog, aspect-ratio, avatar, checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, tabs, toggle, toggle-group, tooltip; button/breadcrumb/form/responsive-overlay use `@radix-ui/react-slot`. **Other DOM libs:** drawer (vaul), command (cmdk), calendar (react-day-picker), carousel (embla), chart (recharts), input-otp, resizable (react-resizable-panels), form (react-hook-form), sheet (Radix dialog). **Plain DOM+Tailwind (no Radix):** alert, badge, card, empty-state, input, textarea, switch (hand-rolled `<button role=switch>`), skeleton, table, pill, option-display, workflow-progress, resource-* family, menu-item-hover, responsive-overlay (custom persistent bottom drawer using `createPortal`, `document`, pointer events — responsive-overlay.tsx:325-700). Icons: `icon.tsx` wraps `@hugeicons/react` `HugeiconsIcon` with a ~170-name `ICON_MAP` from `@hugeicons/core-free-icons` + 2 inline SVG element arrays; lucide-react only in shared-ui pagination/input-otp/sheet/radio-group/navigation-menu/resizable/accordion/command/calendar/breadcrumb/menubar/carousel (0 direct uses in apps/app/src). Hooks: use-media-query (window.matchMedia), use-compact-viewport (`(max-width:767px)` + context override), use-pointer-coarse.

App-side `apps/app/src/components/ui/`: page-shell, sidebar (2282 lines, DOM/pointer/flushSync), tab-pill, detail-card, split-button, disclosure/height-transition (jotai), markdown-preview (react-markdown + rehype/remark + katex + mermaid), sonner toaster, image-lightbox, copy-button, truncate-start, overflow-fade, plus pure-TS token files (context-selection.ts, detail-scroll-size.ts, chromeStyleTokens.ts, activity-row-styles.ts). Usage counts in app: lib/utils 161, icon 151, button 95, coarse-pointer-sizing 49, use-compact-viewport 41, tooltip 39, dropdown-menu 32, dialog 21, empty-state 19, input 17, skeleton 14, resource-list 14, switch 8, pill 8, popover 5, context-menu 5, select 1.

## packages/core-ui
Pure TypeScript, depends only on `@bb/domain` (package.json): assertNever, formatEnvironmentDisplay, pending-interaction formatting/presentation, extractErrorMessage/toRecord. No React, no DOM. `@bb/thread-view` likewise has no document/window/react-dom refs (grep returned none).

## RN equivalents & recommendation
Web stack = Tailwind v4 utilities + cva + tailwind-merge + Radix. Recommend **NativeWind v4 + react-native-reusables (shadcn port using @rn-primitives)** with a generated `theme.native.ts` that mirrors the anchor→ramp math (compute oklch/oklab mixes at build time via `culori`, emit hex per token per mode per palette; RN has no `color-mix`). Rationale: same class vocabulary and cva pattern lets Button/Badge/Pill/Input variants port nearly verbatim; @rn-primitives cover dialog/dropdown/popover/select/tabs/tooltip/checkbox/switch semantics that Radix provides on web; NativeWind CSS variables per theme via `vars()` allow palette switching at runtime. Map: dialog/drawer → @gorhom/bottom-sheet (mirror the compact-viewport bottom-drawer behavior in responsive-overlay.tsx); tooltip → long-press popover or omit; scroll-area → ScrollView/FlashList; icons → `@hugeicons/react-native` (same IconSvgElement data as core-free-icons, keep ICON_MAP names); Inter → `@expo-google-fonts/inter` or bundle fontsource TTF; Fira Code → bundle. Tamagui rejected: different token/variant model, heavier compiler; plain StyleSheet rejected: loses variant reuse with 160+ cva/cn callsites.

## Key files
- apps/app/src/components/ui/theme.css
- apps/app/src/components/ui/theme.test.ts
- apps/app/src/app.css
- apps/app/src/hooks/useTheme.ts
- apps/app/src/hooks/useAppTheme.ts
- apps/app/src/lib/themes/index.ts
- apps/app/src/lib/themes/nord.ts
- apps/app/src/lib/themes/dracula.ts
- apps/app/src/lib/themes/solarized.ts
- apps/app/src/lib/themes/gruvbox.ts
- apps/app/src/lib/themes/catppuccin.ts
- apps/app/src/lib/code-theme.ts
- apps/app/index.html
- packages/domain/src/app-theme.ts
- packages/domain/src/code-theme.ts
- packages/server-contract/src/api/system.ts
- packages/server-contract/src/public-api.ts
- packages/sdk/src/areas/theme.ts
- apps/server/src/routes/system.ts
- apps/server/src/services/system/custom-themes.ts
- packages/shared-ui/package.json
- packages/shared-ui/src/components/ui/button.tsx
- packages/shared-ui/src/components/ui/icon.tsx
- packages/shared-ui/src/components/ui/coarse-pointer-sizing.ts
- packages/shared-ui/src/components/ui/motion.ts
- packages/shared-ui/src/components/ui/chrome-style-tokens.ts
- packages/shared-ui/src/components/ui/activity-row-styles.ts
- packages/shared-ui/src/components/ui/responsive-overlay.tsx
- packages/shared-ui/src/components/ui/dropdown-menu.tsx
- packages/shared-ui/src/components/ui/dialog.tsx
- packages/shared-ui/src/components/ui/tooltip.tsx
- packages/shared-ui/src/components/ui/pill.tsx
- packages/shared-ui/src/components/ui/input.tsx
- packages/shared-ui/src/components/ui/switch.tsx
- packages/shared-ui/src/components/ui/hooks/use-media-query.ts
- packages/shared-ui/src/components/ui/hooks/use-compact-viewport.tsx
- packages/shared-ui/src/lib/utils.ts
- packages/core-ui/src/index.ts
- apps/app/src/components/ui/README.md
- apps/app/src/components/ui/sidebar.tsx
- apps/app/src/components/ui/tab-pill.tsx
- apps/app/src/components/ui/detail-card.tsx
- apps/app/src/components/ui/context-selection.ts
- apps/app/src/views/SettingsView.tsx
- apps/app/package.json

## Reuse verdicts
- packages/core-ui (@bb/core-ui): **reusable-as-is** — Pure TS + @bb/domain only (packages/core-ui/package.json; src/index.ts). No React, DOM, or node builtins in src. Reusable in Hermes.
- packages/thread-view (@bb/thread-view): **reusable-as-is** — Pure TS projection/formatting; deps only @bb/domain, @bb/server-contract, zod; grep found no document/window/react-dom usage.
- packages/domain app-theme.ts / code-theme.ts: **reusable-as-is** — Zod schemas + builtInThemes metadata + isBuiltInThemeId; no DOM. Native app can import BuiltInThemeId, builtInThemes, appThemeSchema.
- packages/sdk theme area (sdk.theme.get/catalog/set): **reusable-as-is** — HTTP transport via typed client; theme.ts itself is DOM-free. Whole SDK reuse depends on fetch/WebSocket transport choice (out of this area).
- packages/shared-ui/src/lib/utils.ts (cn = clsx + tailwind-merge): **reusable-as-is** — clsx and tailwind-merge are pure JS; works with NativeWind className strings.
- packages/shared-ui/src/components/ui/{motion,coarse-pointer-sizing,chrome-style-tokens,activity-row-styles,resource-edit-prompt}.ts: **headless-logic-only** — String constants of Tailwind classes; several use `max-md:pointer-coarse:` and `[&_svg]:` selectors that NativeWind cannot express (no pointer media query, no descendant selectors). Values (heights, sizes) are portable; class strings need rewriting.
- packages/shared-ui/src/components/ui/icon.tsx (ICON_MAP + Icon): **reusable-with-small-changes** — Uses @hugeicons/react (renders <svg>). ICON_MAP data (@hugeicons/core-free-icons IconSvgElement arrays incl. 2 inline custom glyphs) is renderer-agnostic; swap HugeiconsIcon for @hugeicons/react-native (react-native-svg) and drop className/data-icon.
- packages/shared-ui/src/components/ui/{button,badge,pill,card,input,textarea,switch,skeleton,alert,empty-state,table,option-display}.tsx: **headless-logic-only** — cva variant maps and class strings are portable to NativeWind, but components render <button>/<span>/<input>/<div>, use forwardRef to HTML elements, `hover:`, `focus-visible:`, `disabled:` and `[&_svg]:` selectors, and Radix Slot (button). Must be re-authored on Pressable/View/TextInput.
- packages/shared-ui Radix-backed primitives (dialog, dropdown-menu, popover, select, tooltip, tabs, checkbox, radio-group, slider, scroll-area, accordion, collapsible, context-menu, hover-card, menubar, navigation-menu, toggle, toggle-group, separator, progress, avatar, alert-dialog, aspect-ratio, label): **not-reusable** — Import @radix-ui/react-* which require DOM (portals, focus management, pointer events). Replace with @rn-primitives / react-native-reusables equivalents.
- packages/shared-ui responsive-overlay.tsx (PersistentResponsiveDrawerShell) + overlay-trigger.ts: **not-reusable** — react-dom createPortal, document.body, HTMLElement focus trapping, pointer capture, CSS transitions, `inert`. Behavior spec (bottom drawer, 220ms cubic-bezier(0.32,0.72,0,1), close at 25% or 450px/s fling, 92dvh max, deferred content realization) should be re-implemented on @gorhom/bottom-sheet or Reanimated.
- packages/shared-ui hooks (use-media-query, use-compact-viewport, use-pointer-coarse): **not-reusable** — window.matchMedia. Native: useWindowDimensions/useColorScheme; pointer is always coarse on mobile.
- packages/shared-ui drawer(vaul)/command(cmdk)/calendar(react-day-picker)/carousel(embla)/chart(recharts)/input-otp/resizable(react-resizable-panels)/form(react-hook-form): **not-reusable** — All DOM-only libraries (except react-hook-form which is RN-compatible but form.tsx wraps Radix Label/Slot).
- apps/app/src/components/ui/theme.css + app.css: **headless-logic-only** — CSS with color-mix()/oklch, @theme, @custom-variant, container queries, ::-webkit-scrollbar, mask-image animations. Token values must be pre-resolved to hex/rgba in a generated TS theme object; NativeWind supports neither color-mix nor oklch at runtime.
- apps/app/src/lib/themes/*.ts (built-in palette CSS strings): **headless-logic-only** — CSS strings; anchor hexes are extractable but the color-mix derivations (muted-foreground etc. in Nord/Dracula/Solarized/Gruvbox light) need offline computation. Custom/plugin themes (arbitrary CSS via customCss) cannot be honored natively without a CSS parser.
- apps/app/src/hooks/useTheme.ts / useAppTheme.ts / lib/code-theme.ts: **not-reusable** — localStorage via jotai atomWithStorage, document.documentElement.classList, <meta theme-color>, <style> injection, window.matchMedia. Native: Appearance/useColorScheme + AsyncStorage/MMKV keyed 'bb.theme' and query /system/config for appearance.themeId.
- apps/app/src/components/ui/{sidebar,tab-pill,page-shell,disclosure,height-transition,markdown-preview,sonner,image-lightbox}.tsx: **not-reusable** — sidebar: 2282 lines of DOM pointer/touch/wheel handling, flushSync, CSS translate; markdown-preview: react-markdown + rehype-raw/katex/mermaid (DOM); sonner and vaul are DOM. Only the pure-TS token files (context-selection.ts, detail-scroll-size.ts, chromeStyleTokens.ts, sidebar-hover-actions.ts) carry portable values.

## Risks
- No native color-mix/oklch: every derived token (≈40 per mode per palette) must be precomputed offline; drift risk if theme.css changes and the generator is not re-run — recommend a test that regenerates from theme.css and diffs (mirror theme.test.ts guards).
- Custom themes and plugin themes ship as arbitrary CSS (AppTheme.customCss, up to 256KB) — a native app can only honor built-in themeIds; users on custom palettes will see the default palette unless a subset CSS-variable parser (extract `--canvas`, `--ink`, `--primary`, etc. from `:root`/`.dark` blocks) is written.
- Light/dark preference is per-client localStorage (`bb.theme`), not server state; native app must own its own preference and there is no cross-device sync — palette (server) and mode (local) semantics differ.
- Typography relies on Inter Variable (@fontsource) and Fira Code (assumed installed; not bundled). Native must bundle both; variable-font weight axes on Android via Expo need static weight files.
- Web coarse-pointer sizing is a media-query bump (13→15px text, 28→36px buttons); on native everything is coarse, so the native theme should adopt the coarse values as base, not the desktop values.
- @hugeicons/react-native availability/version parity with @hugeicons/core-free-icons ^4.1.3 unverified in this repo (not a dependency here); the two inline custom IconSvgElement glyphs (Palette, SectionAdd) must render identically through react-native-svg.
- Motion semantics (hover-in 0ms/out 150ms; menu instant; drawer 220ms cubic-bezier(0.32,0.72,0,1)) and flat 2px hard shadows are part of the look; RN shadows differ per platform (iOS shadow* vs Android elevation) — hard-offset no-blur shadow may need a border-bottom hack.
- Radix-driven a11y (roles, aria-*, focus rings with `--ring`) is implicit on web; native needs explicit accessibilityRole/State on every rebuilt primitive.
- Tailwind v4 custom variants and `[&_svg]:size-4` descendant selectors used pervasively in shared-ui class strings are unsupported in NativeWind; naive copy-paste of cva strings will silently drop styles.

## Open questions
- Should the native app honor custom/plugin themes by parsing the anchor variables out of customCss, or only support the six built-ins?
- Should light/dark mode remain device-local (Appearance + local storage) or should a native-app preference be added server-side (would require new AppSettings field + HOST/server contract change)?
- Is @hugeicons/react-native licensed/available for the free icon set used here (core-free-icons), and does it accept the same IconSvgElement arrays so ICON_MAP can be shared from @bb/shared-ui without importing @hugeicons/react?
- Which typography values are canonical for native: the desktop overrides (13/15px) or the coarse-pointer bumps (14/15/16px) — the current mobile PWA on a phone renders the coarse values.
- Should shared-ui be refactored to split platform-agnostic variant tables (cva configs, size constants) into a headless subpath so web and native share them, or should native maintain its own copy?
- resolvedCodeTheme (Shiki/Pierre theme names + JSON files) is exposed in /system/config; will the native app render code with a Shiki-compatible highlighter (e.g., via WebView or a JS-only tokenizer) or ignore code themes?
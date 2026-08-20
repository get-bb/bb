## 1. What the mobile PWA is today (facts)

**Install shell.** No service worker, no vite-plugin-pwa, no workbox anywhere in the repo (grep of `apps/app`, `vite.config.ts:13-20` plugin list). "PWA" = `apps/app/index.html` + static manifest. `index.html:5-8` sets `viewport-fit=cover, interactive-widget=resizes-content`; `:13-18` `apple-mobile-web-app-capable` + `black-translucent` status bar (comment: iOS ignores manifest display mode); `:34-39` manifest link; `:55-74` swaps manifest/apple-touch-icon per `bb.faviconColor` localStorage; `:75-83` pre-paints `theme-color` from `bb.theme`. `public/manifest.webmanifest:5` `display: standalone`, icons any/maskable/monochrome. `scripts/generate-pwa-icons.mjs:11-34` tints 8 color variants + monochrome masks with sharp. Server serves `.webmanifest` MIME at `apps/server/src/server.ts:610`; SPA fallback, no offline cache. Toaster fixed `bottom-right` (`main.tsx:63`).

**Breakpoint model.** `useIsCompactViewport` = `(max-width: 767px)` via `window.matchMedia` (`packages/shared-ui/src/components/ui/hooks/use-compact-viewport.tsx:10`, `use-media-query.ts:14-46`), with a plain-React `CompactViewportOverrideProvider`. `usePointerCoarse` = `(pointer: coarse)` (`use-pointer-coarse.ts:3`). ~39 consumers of compact, ~36 of coarse; Tailwind `max-md:pointer-coarse:` size tokens in `coarse-pointer-sizing.ts` (53 users). Splits disabled on compact (`hooks/useSplitWorkspaceActive.ts:16-20`); thread-open forces `"replace"` pane (`AppLayout.tsx:472`).

**Viewport / keyboard workarounds.** `app.css:14-46`: shell height `--bb-shell-height: 100dvh`, `100lvh` under `@media (display-mode: standalone)` because iOS standalone subtracts top inset from svh/dvh; `overscroll-behavior-y: none` (`:49-56`). `components/layout/useMobileVisualViewportHeight.ts` listens to `visualViewport` resize/scroll, overrides shell top/height and `--bb-shell-height` when layout viewport ≠ visual viewport (Android in-app browsers, iOS keyboard); `:9-19` UA-sniffs iOS WebKit to restore immediately on `focusout` (`:116-131`) because Safari doesn't update visualViewport until keyboard animation ends. `FollowUpPromptBox.tsx:380-401` compact one-line composer; `:417-486` expansion waits for a ≥N px `visualViewport` shrink (or timeout) so composer and keyboard paint together; `:487-579` collapse waits for viewport growth after keyboard dismiss. `PromptBoxInternal.tsx:1179` `enterKeyHint` "enter" on coarse; `:1181` no autofocus on coarse (would open soft keyboard); `:2790-2791` Enter never submits on coarse pointer except iPad hardware Enter (`:1075-1085` iPadOS WebKit UA sniff, `:1683-1720` Magic Keyboard Enter/IME guard); `:2651-2657` prevent focus transfer to submit button on iOS (would dismiss keyboard and resize shell before submit); `:2558-2580` voice mic becomes primary action on coarse pointer when empty. `overlay-trigger.ts:44-62` blurs contenteditable before opening drawers (Safari restores keyboard otherwise). Safe-area: `AppLayout.tsx:264,851`, `sidebar.tsx:803,1428`, `popover.tsx:167`, `dialog.tsx:256`, `dropdown-menu.tsx:175`, `RootComposeSecondaryContent.tsx:31-41`.

**Persistent responsive drawer** (`packages/shared-ui/src/components/ui/responsive-overlay.tsx`). Popover/Dialog/DropdownMenu render `ResponsiveDrawerShell` on compact (`popover.tsx:152-172`, `dialog.tsx:236-262`). `:214-262` realizes body after two rAF or 120 ms fallback; `:306+` `PersistentResponsiveDrawerShell` portals to `document.body`, never sets `inert`/`aria-hidden` on app root ("WebKit resolve styles for full chat tree"), uses `inert={!open}` on itself, own Tab trap + Escape stack (`registerOpenDrawer`), pointer-event drag-to-close (25 % or 450 px/s). `shared-ui/drawer.tsx` (vaul) still exists but only used via `plugin-frontend.ts`; secondary panel uses the persistent shell (`SecondaryPanelLayout.tsx:19-20,105`; `ThreadDetailView.tsx:576-583`; `useThreadSecondaryPanelVisibility.ts:84-120`).

**Mobile sidebar** (`components/ui/sidebar.tsx`): custom always-mounted drawer (`:732-757`, #1261), no `inert` on siblings (`:988-995`), skips focus on touch-open (`:975-979`), swipe-open from inset with 24 px browser-edge guard (`:22,1754,1805`) and dual pointer+touch paths because browsers cancel pointer events on scroll pan (`:1065-1070`), defers layout-forcing scroll checks (`:232-238`, #1269), wheel-swipe support (`:35-36`).

**Terminal.** xterm.js + WebGL addon (`ThreadTerminalView.tsx:9-16,795-834`); touch tap-to-focus so iOS opens keyboard (`:719-757`); no extra-keys toolbar (Ctrl/Esc/arrows) — grep found none. Transport `terminal-websocket-transport.ts` is JSON/base64 with injectable socket, heartbeat 15/45 s, reconnect delays.

**Voice.** `hooks/useVoiceInput.ts`: `getUserMedia` (`:232`), `MediaRecorder` webm/mp4/ogg (`:87-96`), `navigator.wakeLock("screen")` while recording (`:139-197`), posts multipart to `/api/v1/system/voice-transcription` (`lib/api.ts:207-219`, server `routes/system.ts:365`, contract `public-api.ts:1442`). Mic device pref in localStorage (`audio-input-device-preference.ts:5`).

**Clipboard** `lib/clipboard.ts:16-92`: `navigator.clipboard.writeText` with `execCommand` fallback for plain-HTTP LAN origins. **Files**: hidden `<input type=file multiple>` (`PromptBoxInternal.tsx:3095-3101`), drag/drop (`:3073-3083`), paste files (`:1734-1746`); no share API, no downloads (`createObjectURL` absent).

**Background/lifecycle.** `lib/ws.ts:1,58-68` partysocket ReconnectingWebSocket to `window.location` `/ws`, infinite retries 1–30 s. `lib/query-client.ts:36-49` react-query focusManager on `visibilitychange`/`pageshow`; `:61-95` cancels fetches on hide, invalidates active-thread bundles on resume. `lib/document-visibility.ts:12-16`. Read tracking only when visible (`useThreadReadTracking.ts:41-55`); thread has `lastReadAt`/`latestAttentionAt` (`packages/domain/src/thread.ts:393-394`).

**Notifications/push: none.** No `Notification`, `PushManager`, `vibrate`, `setAppBadge`, `navigator.share`, `beforeinstallprompt`. Server/contract grep for webpush/vapid/apns/fcm/pushSubscription: zero. Server "notification" = DB change notifier (`services/lib/notification-buffer.ts`, `ws/hub.ts`). Desktop Electron has none either. `plugins/keep-awake` is host-side macOS `caffeinate` (`host.ts:9,79-83`), unrelated to device wake lock.

**Theme** `hooks/useTheme.ts:42-56` mirrors body bg into `theme-color` meta; `theme.css:866-883` `text-size-adjust`, `touch-action: manipulation`.

**Auth/remote.** Loopback API unauthenticated (`docs/multiple-devices.md:39-42`); bb connect gate accepts `x-bb-connect-machine` credential header or better-auth session cookie (`apps/connect/src/servers.ts:178-209`); desktop enrolls as a connect machine and mints a desktop session cookie (`apps/desktop/src/connect-machine-enrollment.ts`, `connect-desktop-session.ts:60-130`, gate `servers.ts:331-370`). App surface header only `desktop|web` (`packages/config/src/app-surface.ts:4`). No custom URL scheme; routes are http paths.

## 2. Limitations accepted / worked around → 3. Native replacement

| Limitation | Evidence | Expo replacement |
|---|---|---|
| Keyboard/viewport geometry guessing, UA sniffing | `useMobileVisualViewportHeight.ts`, `FollowUpPromptBox.tsx:417-579`, `app.css:14-46` | `react-native-keyboard-controller` / `KeyboardAvoidingView`, `react-native-safe-area-context`, `expo-status-bar` |
| iOS style-recalc stalls from `inert`/modal drawers | `responsive-overlay.tsx` comments, `sidebar.tsx:988-995` | `@gorhom/bottom-sheet` / `react-native-screens` modals, `react-native-gesture-handler` drawer |
| No push, no background, no badge | grep results; read tracking needs foreground | `expo-notifications` (APNs/FCM) + new server push-subscription table & sender keyed on `latestAttentionAt`/pending interactions; `expo-notifications` badge |
| Socket dies in background; resume invalidation | `ws.ts`, `query-client.ts:61-95` | `AppState` → reconnect + `focusManager`; `expo-background-task` for periodic sync; push for wake |
| Wake lock only during recording | `useVoiceInput.ts:139-197` | `expo-keep-awake` |
| Voice: MediaRecorder + wake lock + mic pref | `useVoiceInput.ts` | `expo-audio` (record m4a/wav) → same multipart route; `expo-av` fallback |
| Clipboard needs HTTPS or execCommand hack | `clipboard.ts` | `expo-clipboard` |
| No haptics | none | `expo-haptics` on send/long-press/drawer snap |
| File attach via `<input type=file>`; no camera/photos/share | `PromptBoxInternal.tsx:3095` | `expo-image-picker`, `expo-document-picker`, `expo-sharing`, `expo-file-system` |
| Terminal: xterm DOM/WebGL, no modifier keys | `ThreadTerminalView.tsx` | WebView-hosted xterm or native VT (e.g. `react-native-xtermjs`/custom) + accessory keyboard bar; reuse `terminal-websocket-transport.ts` |
| Auth = cookie via getbb.app browser session | `servers.ts:178-209` | Enroll as connect machine, store credential in `expo-secure-store`, send `x-bb-connect-machine` header on fetch + WebSocket |
| No deep links / custom scheme | routes only http | `expo-linking` scheme + universal links to `/projects/:id/threads/:id` |
| Storage = localStorage (theme, favicon color, mic id, prefs) | `browser-storage.ts` (17 files) | `@react-native-async-storage`/MMKV via jotai `atomWithStorage` |
| Theme = CSS vars/oklch, meta theme-color | `useTheme.ts`, `theme.css` | `Appearance`/`useColorScheme`, `expo-system-ui`, port tokens to JS |
| No offline/PWA cache | no SW | Bundled assets; react-query persist (`@tanstack/query-async-storage-persister`) |

## Key files
- apps/app/index.html
- apps/app/public/manifest.webmanifest
- apps/app/scripts/generate-pwa-icons.mjs
- apps/app/vite.config.ts
- apps/app/src/app.css
- apps/app/src/main.tsx
- packages/shared-ui/src/components/ui/hooks/use-media-query.ts
- packages/shared-ui/src/components/ui/hooks/use-compact-viewport.tsx
- packages/shared-ui/src/components/ui/hooks/use-pointer-coarse.ts
- packages/shared-ui/src/components/ui/responsive-overlay.tsx
- packages/shared-ui/src/components/ui/overlay-trigger.ts
- packages/shared-ui/src/components/ui/drawer.tsx
- packages/shared-ui/src/components/ui/popover.tsx
- packages/shared-ui/src/components/ui/dialog.tsx
- packages/shared-ui/src/components/ui/dropdown-menu.tsx
- packages/shared-ui/src/components/ui/coarse-pointer-sizing.ts
- apps/app/src/components/layout/useMobileVisualViewportHeight.ts
- apps/app/src/components/layout/AppLayout.tsx
- apps/app/src/components/ui/sidebar.tsx
- apps/app/src/components/promptbox/FollowUpPromptBox.tsx
- apps/app/src/components/promptbox/PromptBoxInternal.tsx
- apps/app/src/components/secondary-panel/SecondaryPanelLayout.tsx
- apps/app/src/views/thread-detail/useThreadSecondaryPanelVisibility.ts
- apps/app/src/hooks/useSplitWorkspaceActive.ts
- apps/app/src/components/thread/terminal/ThreadTerminalView.tsx
- apps/app/src/components/thread/terminal/terminal-websocket-transport.ts
- apps/app/src/hooks/useVoiceInput.ts
- apps/app/src/components/promptbox/usePromptVoice.ts
- apps/app/src/lib/api.ts
- apps/app/src/lib/clipboard.ts
- apps/app/src/lib/document-visibility.ts
- apps/app/src/lib/query-client.ts
- apps/app/src/lib/ws.ts
- apps/app/src/lib/browser-storage.ts
- apps/app/src/hooks/useTheme.ts
- apps/app/src/hooks/useThreadReadTracking.ts
- apps/app/src/lib/app-surface.ts
- packages/config/src/app-surface.ts
- packages/domain/src/thread.ts
- apps/server/src/services/lib/notification-buffer.ts
- apps/server/src/routes/system.ts
- apps/connect/src/servers.ts
- apps/desktop/src/connect-machine-enrollment.ts
- apps/desktop/src/connect-desktop-session.ts
- plugins/keep-awake/host.ts
- plugins/keep-awake/server.ts
- docs/multiple-devices.md

## Reuse verdicts
- packages/shared-ui hooks/use-media-query.ts + use-compact-viewport.tsx + use-pointer-coarse.ts: **reusable-with-small-changes** — window.matchMedia/MediaQueryList (use-media-query.ts:15-46). CompactViewportOverrideProvider is plain React context. Replace snapshot/subscribe with Dimensions/useWindowDimensions; coarse pointer is always true on phones.
- packages/shared-ui responsive-overlay.tsx (ResponsiveDrawerShell / PersistentResponsiveDrawerShell): **not-reusable** — react-dom createPortal to document.body, HTMLElement queries, keydown listeners on Document, inline CSS transforms, PointerEvent drag, inert attribute. Only the two-rAF+120ms realization idea and drag thresholds (25 %, 450 px/s) transfer.
- packages/shared-ui drawer.tsx (vaul): **not-reusable** — vaul is DOM-only; also Radix-based.
- apps/app components/layout/useMobileVisualViewportHeight.ts: **not-reusable** — window.visualViewport, document.body.clientHeight, focusin/focusout, navigator UA sniff. Not needed in RN (keyboard events are native).
- apps/app components/promptbox/FollowUpPromptBox.tsx + PromptBoxInternal.tsx: **not-reusable** — TipTap/ProseMirror contenteditable, visualViewport, HTMLInputElement file input, DragEvent/DataTransfer, ClipboardEvent, document.activeElement, container-query CSS in app.css. Mention/slash-command data model and value/serialization helpers (promptEditorValue*, PromptDraftAttachment) may be headless but live inside the same files.
- apps/app components/ui/sidebar.tsx (mobile drawer + swipe): **not-reusable** — DOM pointer/touch/wheel listeners, style mutation, inert, ownerDocument queries, Radix Tooltip. Gesture thresholds transferable to react-native-gesture-handler.
- apps/app hooks/useVoiceInput.ts + usePromptVoice.ts: **headless-logic-only** — MediaRecorder, navigator.mediaDevices.getUserMedia, navigator.wakeLock, File/Blob, DOMException names. State machine (idle/recording/transcribing/error), 1 s minimum, error message mapping, and multipart upload to /api/v1/system/voice-transcription are portable to expo-audio + expo-keep-awake + fetch/FormData with file URI.
- apps/app lib/clipboard.ts: **not-reusable** — navigator.clipboard + document.execCommand textarea hack. Replace with expo-clipboard; keep the toast wrapper shape.
- apps/app lib/document-visibility.ts: **not-reusable** — document.visibilityState, pageshow, window focus. Replace with AppState; keep useSyncExternalStore revision pattern.
- apps/app lib/query-client.ts: **reusable-with-small-changes** — focusManager listener uses window visibilitychange/pageshow (36-49) and suspend/resume uses document/pagehide (61-95). Query client construction, mutation-error toasts, retry policy, and invalidateActiveThreadBundleQueriesAfterBrowserResume are headless.
- apps/app lib/ws.ts (WebSocketManager): **reusable-with-small-changes** — partysocket/ws runs on the global WebSocket (available in RN/Hermes); URL derived from window.location (58-60) must be injected; no cookie/credential header path — needs headers option for x-bb-connect-machine or query-token. Message parsing via @bb/server-contract lenient schemas is pure.
- apps/app components/thread/terminal/terminal-websocket-transport.ts: **reusable-as-is** — Injectable createSocket, JSON+base64 text frames, URL/setTimeout only. RN global WebSocket satisfies TerminalBrowserSocket (bufferedAmount exists on RN WebSocket).
- apps/app components/thread/terminal/ThreadTerminalView.tsx: **not-reusable** — @xterm/xterm DOM renderer + WebGL addon + xterm.css, TouchEvent handlers, ResizeObserver. Needs WebView-hosted xterm or a native emulator.
- apps/app hooks/useTheme.ts: **not-reusable** — document.documentElement.classList, meta[name=theme-color], getComputedStyle, matchMedia; theme tokens are CSS custom properties in theme.css. Preference atom (bb.theme) semantics reusable with Appearance/useColorScheme.
- apps/app hooks/useThreadReadTracking.ts: **reusable-with-small-changes** — Depends only on document-visibility (swap for AppState) and a mutate fn; marker/dedupe logic is pure.
- apps/app lib/browser-storage.ts + atomWithStorage users (theme, favicon color, mic id, prefs): **not-reusable** — window.localStorage/sessionStorage, StorageEvent. Port to jotai atomWithStorage over AsyncStorage/MMKV (async getItem changes initial-render semantics).
- packages/config/src/app-surface.ts: **reusable-as-is** — Pure. But APP_SURFACE_VALUES is only desktop|web; server parseAppSurface rejects anything else, so adding a 'mobile' surface is a server change (telemetry.ts, request-context.ts).
- plugins/keep-awake: **headless-logic-only** — host.ts spawns /usr/bin/caffeinate on macOS hosts (irrelevant to phone screen); server.ts RPC contract usable from RN via plugin RPC; app.tsx uses @bb/shared-ui DOM/Radix components (Switch, Checkbox, RadioGroup).
- apps/app index.html + public manifest/icons + generate-pwa-icons.mjs: **not-reusable** — Web install shell. Source PNGs (icon-512.png, apple-touch-icon.png, monochrome masks) can seed expo app.json icon/adaptiveIcon/monochromeImage; the color-tint step could generate alternate app icons.
- apps/server voice transcription route + connect gate auth: **reusable-as-is** — HTTP contracts are client-agnostic; RN fetch supports multipart FormData with {uri,name,type}. Connect gate accepts x-bb-connect-machine header (servers.ts:178-209), which RN fetch and RN WebSocket (headers option) can send.

## Risks
- Push notifications require net-new server + connect infrastructure: there is no device-token table, no sender, no webpush/APNs/FCM code, and no per-user notification preferences anywhere in apps/server or packages/server-contract; only DB change-notifier plumbing exists (notification-buffer.ts, ws/hub.ts). Deciding what triggers a push (thread attention, pending interaction, run finished) is product policy the server must own per AGENTS.md.
- Auth: the loopback API is unauthenticated and the getbb.app gate relies on a browser session cookie or a machine credential; a native app must implement connect-machine enrollment (mirroring apps/desktop connect-machine-enrollment.ts) and send x-bb-connect-machine on both fetch and WebSocket. Machine enrollment counts against the account machine limit (EnrollDesktopMachineFailureCode 'machine_limit').
- Prompt editor is TipTap/ProseMirror with mention pills, slash commands, ultracode decorations, compact single-line CSS transforms; there is no headless editor model separated from the DOM component, so the composer must be re-implemented (RN TextInput or WebView) and mention/attachment serialization extracted.
- Terminal is xterm.js + WebGL; no RN-native equivalent in repo. A WebView-hosted xterm keeps parity but re-introduces the keyboard/viewport class of bugs inside the WebView; a native emulator is a large build.
- Markdown/diff rendering stack (react-markdown, rehype, katex, mermaid, @pierre/diffs, sugar-high) is DOM-based; parity of timeline rendering on RN is a separate large area (outside this report).
- The 767px compact breakpoint and pointer-coarse variants are woven into ~90 files via Tailwind classes; RN needs an explicit design-token/layout system rather than media queries.
- Background sockets: iOS suspends the app quickly; the current resume path (query-client.ts:61-95) re-invalidates active thread bundles, which on RN must be driven by AppState and could be chatty without server-side cursors/since-seq for thread events (terminal transport has sinceSeq; check main ws protocol).
- Preferences currently in localStorage (17 files) are device-local; a native app will not share them with the PWA on the same phone, and async storage changes first-render semantics for jotai atoms.
- Voice: server transcription accepts webm/mp4/ogg files from MediaRecorder; expo-audio produces m4a/caf/wav — verify apps/server/src/services/ai/voice-transcription.ts accepts these container/mime types.
- The app-surface header enum (desktop|web) is enforced server-side; introducing 'mobile' touches telemetry and request-context and any surface-conditional server behavior.

## Open questions
- Should the native app enroll as a bb connect 'machine' (like desktop) or should connect gain a first-class 'device' credential type with push-token registration? Where does the push-token → account/server mapping live (getbb.app connect worker vs each bb server)?
- Which server events should generate a push: thread latestAttentionAt changes, pending interactions (ask-user-question, permission prompts), run completion, automation failures? Does the server already have a single 'attention' emission point to hook (services/threads/thread-runtime-display.ts references latestAttentionAt)?
- Does the main /ws protocol support resume-from-sequence like the terminal transport (sinceSeq), or does every reconnect require full re-subscribe + refetch? This determines background/resume cost on mobile.
- Terminal strategy: WebView-hosted xterm (reuse xterm + transport) vs native emulator; and does the product want terminal on phones at all (currently available on compact via secondary-panel drawer)?
- Composer strategy: RN TextInput with a custom mention/slash model vs WebView-hosted TipTap; is there a plan to extract a headless prompt-value model from PromptBoxInternal.tsx?
- Voice transcription route: confirm accepted MIME/container list in apps/server/src/services/ai/voice-transcription.ts for expo-audio outputs (m4a/aac).
- Should 'mobile' become a third APP_SURFACE value (server change) or reuse 'web'?
- Deep links: which URL shape should universal links map to (current http routes /projects/:projectId/threads/:threadId etc.) and should getbb.app host the apple-app-site-association / assetlinks?
- Plugin app surfaces (@get-bb/plugin-sdk/app, definePluginApp) are React DOM; is plugin UI in scope for the native app (WebView) or excluded initially?
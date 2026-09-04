# Push notification verification

Tested on September 4, 2026 using an isolated, fresh dev store, Chrome 152 and Electron 41 on macOS. The managed dev launcher served this checkout on app port 17622 and server port 25622. No production store, mobile device, or Expo relay was used.

## Design

[Interactive settings mockup](../push-notifications.html) was created before implementation. The implementation uses bb’s existing settings switches and adds a per-client permission/test section. [Browser settings screenshot](browser-settings.png) · [Desktop settings screenshot](desktop-settings.jpg).

## Live checks

- Started `scripts/bb-dev-app current --desktop`; launcher status confirmed both processes running. App returned HTTP 200; server `/health` returned `{"ok":true}`.
- Used Doobie to open the real web app, exercise its Web notifications switch, test button, reload persistence, and two simultaneous tabs.
- Used Computer Use to navigate the real Electron app to Settings → Push notifications, send a test, and disable Desktop notifications. Its test button became disabled and the explanatory text appeared.
- Verified through the CLI that disabling web left mobile and desktop enabled, rejected `test web`, and allowed `test desktop`. Disabling desktop left web enabled, rejected `test desktop`, and allowed `test web`. Restored all switches to true.
- Ran an actual Codex turn titled “Open this notification thread”. Its completion text was “Browser and desktop notification check complete.” The server coalesced and broadcast that completion to both clients.
- Observed real `Notification` instances in Chrome and Electron. Both emitted `show`, with `error: false`, for the test messages and the actual thread completion. Instrumentation wrapped and delegated to the original native constructor; it did not substitute a fake notification implementation.
- Dispatched a click event on each received completion notification and verified both apps navigated to `/threads/thr_77jnujh7f4`, showing the completed turn. This verifies the live click handler and routing; it was not a physical click on an OS banner.
- With two Chrome tabs open, a single test broadcast produced exactly one native notification (`show: true`, `error: false`), confirming Web Locks and local storage deduplication.
- Set the isolated Chrome context’s notification permission to denied and reloaded. Settings showed the blocked-permission explanation without a prompt/test button. Restored permission afterward. Browser permission was controlled through the automation context; the app’s permission request was also exercised separately in the component test.

## Automated checks

`pnpm exec turbo run typecheck test --filter=bb-plugin-push-notifications` passed: 17 tests across four files. Coverage includes mobile delivery regression tests, channel independence, no-mobile-device delivery, read/archived/resumed suppression, RPC validation, denied permission, duplicate windows, click navigation, mobile WebView exclusion, unavailable storage, and disposal.

`pnpm exec turbo run test --filter=@bb/cli -- bb-cli-skill-coverage.test.ts` passed both CLI documentation checks after moving plugin-specific guidance out of the core skill.

`bb plugin build plugins/push-notifications` compiled server and frontend artifacts. The dev watcher also rebuilt and reloaded the final implementation successfully.

## Scope

Web notifications require a running tab, notification permission, a secure context (HTTPS or localhost), and a browser supporting the Notification constructor. Desktop notifications require an open app window. Mobile push continues to work when its app is closed. OS settings and Focus modes can suppress banners. Windows/Linux, Safari, and actual mobile relay delivery were not exercised in this change.

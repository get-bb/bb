# @bb/mobile

Native iOS/Android client for bb (Expo SDK 57, React Native 0.86, Expo
Router, NativeWind v5). Plan and decisions: `plans/bb-mobile-expo.md`.

Status: a native shell around the web interface (#2515). `app/webview.tsx`
loads the active server's web app in `react-native-webview` and talks to it
over `@bb/mobile-bridge` (handshake, haptics, app-icon badge, share, open
external links, open native screens). Threads, projects, plugins and server
settings run in the page. The native screens cover what the page cannot
own: first-run pairing (Direct URL and bb connect QR / code enrollment),
saved servers, This device settings (appearance, haptics, notifications,
reload the page, clear website data), push registration and notification
taps, deep links, quick actions, share intents and the connection banner.
The `Mobile E2E` GitHub workflow drives the shell flows.

## Structure

```
app/                     Expo Router routes (thin: each file re-exports a screen)
  _layout.tsx            providers: GestureHandlerRootView › SafeAreaProvider ›
                         KeyboardProvider › PaletteProvider › ThemeProvider ›
                         ProfilesProvider (QueryClientProvider per profile) ›
                         SheetProvider › RootNavigator + ThreadOpenSignalHandler,
                         ShareIntentHandler, QuickActionsHandler,
                         PushNotificationsHost, Toaster
  index.tsx              redirects to Add server (no profiles) or the shell
  webview.tsx            the WebView shell (`?profileId=&path=`)
  connect/index.tsx      bb connect enrollment (QR / code) — also the re-pair
                         target (`?profileId=`) and the `bb://connect?code=…` link
  settings/              device (This device), appearance, notifications,
                         servers/index (saved servers), servers/add (bb connect
                         entry + Direct URL form)
  dev/webview-spike.tsx  Phase 0 WebView diagnostics (dev / EXPO_PUBLIC_BB_E2E=1
                         only: release bundles redirect home)
  e2e/reset.tsx          bb://e2e/reset — wipes local state (dev / EXPO_PUBLIC_BB_E2E=1)
  +native-intent.tsx     redirectSystemPath: every incoming URL (bb:// scheme,
                         universal links, dev-client URLs) → src/lib/shell link
                         resolution → profile switch + shell route / add-server prompt
  +not-found.tsx         unknown native route fallback
src/
  app-shell/             RN glue: ProfilesProvider + hooks (useProfiles,
                         useProfileClient, useRealtimeConnectionState,
                         useConnectionBanner), useAppBoot, PaletteProvider +
                         ServerPaletteSync, client-registry (per-profile
                         clients), connector (waitForActiveConnection), e2e
                         reset wiring, ThreadOpenSignalHandler (realtime
                         `thread-open` → shell route), ShareIntentHandler,
                         QuickActionsHandler
  data/                  connect (pairing payload, enrollment, account servers),
                         notifications (push registration policy, push store,
                         plugin RPC wrapper, notification payload → profile),
                         shared (system realtime subscription), system (system
                         config query); see src/data/README.md
  lib/                   pure TypeScript, vitest-tested
    connection/          active-profile connector (socket + session lifecycle),
                         connection banner derivation
    e2e/                 launch/deep-link reset logic, flow boundary tests
    haptics/             haptic(kind) over expo-haptics + the preference store
    links/               incoming-link parsing, profile match, add-server path
    native/              RN adapters for the lib contracts (SecureStore,
                         cookies, AppState, the shared MMKV preferences) —
                         never imported by tested modules
    profiles/            ServerProfile model, SecureStore-backed store, URL
                         validation, /health + /system/config probe
    query/               per-profile QueryClient, AppState focus, realtime →
                         system config invalidation, session refetch
    realtime/            WebSocketManager-shaped realtime on RN WebSocket
    sdk/                 createMobileSdk (@bb/sdk/browser + app-surface header),
                         per-profile client registry
    session/             bb connect desktop-session cookie scheduler
    share/               inbound share intent → shell composer seed
    shell/               shell URL and navigation rules, screen state, last-path
                         preferences, share payloads, link resolution, shell
                         commands
  notifications/         push (RN glue): expo-notifications behind the data
                         layer's PushNotificationsModule, MMKV push store,
                         app-wide registration controller, PushNotificationsHost
                         (registration sync, taps → thread, foreground toast
                         with Open, app-icon badge, first-run prompt),
                         and usePushRegistration (Settings)
  screens/               connect/ (ConnectEnrollScreen, ConnectScanner —
                         expo-camera QR, AccountServersList), dev/
                         (WebViewSpikeScreen + probes), settings/ (This device,
                         Appearance, Notifications, Servers, Add server, the
                         grouped-list rows), shell/ (RootNavigator, connection
                         banner, header glass, route error boundary, hrefs.ts —
                         typed-route boundary), webview/ (ProfileWebViewScreen,
                         useShellBridge)
  theme/                 generated tokens, ThemeProvider, fonts (see src/ui/README.md)
  types/                 asset declarations
  ui/                    NativeWind primitives (Text, Button, GroupedSection,
                         ActionSheet, …; see src/ui/README.md)
e2e/flows/               Maestro shell flows: shell-launch, shell-deep-link,
                         shell-send, shell-unreachable-server, shell-connect
e2e/subflows/            shared steps (launch-app.yaml: cold start through the
                         dev client + Metro, or `launchApp` of the embedded
                         Release bundle with `-e BB_E2E_EMBEDDED_BUNDLE=1`;
                         pair-direct-server.yaml: add the harness server and
                         wait for the shell; open-bb-link.yaml /
                         clear-open-confirmation.yaml: accept or cancel the
                         native `bb://` confirmation), called with
                         `runFlow: ../subflows/<name>.yaml`
e2e/spike/               Phase 0 spike helpers (tap, tap-point, swipe, type,
                         pair-direct) for the WebView spike screen
e2e/scripts/             ci-run-flows.sh (the CI flow set against a Release
                         build; see "CI"), connect-stub-control.js (drives the
                         bb connect stub), pick-simulator.mjs (newest iPhone
                         17 Pro/17/16 Pro runtime)
eas.json                 EAS Build profiles (development / development-device /
                         preview / production); see "Release"
scripts/                 generate-native-theme.ts (theme tokens),
                         testflight-distribute.mjs (TestFlight distribution)
```

Rules: import `@bb/sdk/browser` (never `@bb/sdk`); no `@bb/shared-ui`; no DOM
APIs; keep RN-dependent code out of `src/lib/**` except `src/lib/native`.

## Prerequisites (macOS)

- Xcode 26.2 with an iOS 26 simulator runtime (`xcodebuild -downloadPlatform iOS`).
- CocoaPods (`brew install cocoapods`), `export LANG=en_US.UTF-8`.
- For Maestro e2e: `brew install --cask temurin@17` or `brew install openjdk@17`
  plus `brew install mobile-dev-inc/tap/maestro`; the `e2e:ios` script sets
  `JAVA_HOME=/opt/homebrew/opt/openjdk@17` unless already set.

## Develop

```bash
pnpm install                                   # applies patches/expo-modules-jsi@57.0.4.patch
cd apps/mobile
pnpm ios                                       # prebuild + build the dev-client, opens the simulator
EXPO_PUBLIC_BB_SERVER_URL=http://127.0.0.1:<port> pnpm dev   # Metro (dev-client)
```

The iOS Simulator shares the Mac loopback, so `pnpm dev` (repo root) or
`scripts/bb-dev-app current` gives a server URL that works as-is. Physical
phones need a Tailscale Serve URL, bb connect, or a temporary
`BB_SERVER_BIND_HOST=0.0.0.0`.

## E2E (Maestro)

```bash
# terminal 1: deterministic backend (fake provider, fixed port 41999) serving the built web app
pnpm exec turbo run build --filter=@bb/app
BB_MOBILE_E2E_SERVE_APP=1 pnpm --filter @bb/integration-tests e2e:mobile-backend
# terminal 2: Metro (EXPO_PUBLIC_BB_E2E=1 wipes profiles/preferences on every launch)
cd apps/mobile && EXPO_PUBLIC_BB_SERVER_URL=http://127.0.0.1:41999 EXPO_PUBLIC_BB_E2E=1 pnpm dev --port 8082
# terminal 3: flows
cd apps/mobile && pnpm e2e:ios
```

The flows drive the WebView shell. Maestro reads the page through the
WKWebView accessibility tree, so assertions on page content target its text,
not native test ids.
`shell-launch.yaml` pairs a Direct server from first run and lands in the
shell with the page rendered; the other shell flows assume it works.
`shell-deep-link.yaml` opens a `bb://` scheme link and a web link for the
saved server: both resolve to the shell route carrying a page path, and
`bb://settings/notifications` still opens the native screen.
`shell-send.yaml` sends a message through the page and reaches the native
device settings from it.
`shell-unreachable-server.yaml` checks that the add-server probe refuses a
server the phone cannot reach, so the shell never loads a dead origin; it
does not use the harness backend.
`shell-connect.yaml` drives bb connect end to end against the stub apex +
gate (`pnpm --filter @bb/integration-tests e2e:mobile-connect-stub`, see
"bb connect" below): manual code entry with the handle and the self-hosted
apex → enrolled screen (session signed in, account servers listed) → Done →
the shell through the gate (cookie on fetch and on `/ws`) → the stub expires
the session (the app re-mints and reconnects by itself) → the stub revokes
the machine ("needs to be paired again" banner) → "Sign in again" re-pairs
the same profile with a new code. The flow needs the stub started with
`BB_MOBILE_E2E_SIMULATOR=<udid>` once (it installs its root certificate in
that simulator) and drives the stub through `e2e/scripts/connect-stub-control.js`
(plain-HTTP control port 42997).
Flows open `bb://` links through `subflows/open-bb-link.yaml` and pair through
`subflows/pair-direct-server.yaml`; `src/lib/e2e/mobile-e2e-flows.test.ts`
enforces both.
Flows dismiss the keyboard by tapping a static label ("Server URL",
"Pairing code"): Maestro's `hideKeyboard` looks for a Return/Done key and the
Add server and connect fields use "next".
Flows cold-start the dev client (`stopApp`) because a warm reload keeps the
last deep link as the initial URL. Without `EXPO_PUBLIC_BB_E2E=1`, open `bb://e2e/reset`
(dev builds) to return the simulator to first run.

### Flows against a Release build (no Metro)

A Release build (`npx expo run:ios --configuration Release --no-bundler
--device <udid>`) embeds the JS bundle and never starts the dev launcher, so
the same flows run without Metro: build it with `EXPO_PUBLIC_BB_E2E=1` (and
`EXPO_PUBLIC_BB_SERVER_URL=http://127.0.0.1:41999`) in the environment — the
Xcode "Bundle React Native code and images" phase inlines `EXPO_PUBLIC_*` at
bundle time — and pass `-e BB_E2E_EMBEDDED_BUNDLE=1` to Maestro.
`e2e/subflows/launch-app.yaml` switches on that variable between the
dev-client deep link and a plain `launchApp`; it is a `-e` variable on
purpose because values in a flow's `env:` block beat `-e`, and `METRO_URL`
lives in every flow's header.
`e2e/scripts/ci-run-flows.sh <udid> <artifacts dir> [flow…]` is what CI runs:
`shell-launch`, `shell-deep-link`, `shell-send`, `shell-unreachable-server`,
one `maestro test` at a time with `--test-output-dir` per flow (screenshots,
logs, JUnit); after a failure it clears the native `bb://` confirmation
before the next flow, and it exits non-zero if any flow failed.
`shell-connect` needs the connect stub, so it runs on its own. `--dev-client`
as the first argument drives a dev client through Metro instead.

## CI

- Typecheck, lint, and unit tests run on Linux in the regular `CI` workflow
  (`pnpm exec turbo run build typecheck lint` in `Checks`, the `packages`
  test shard for `vitest`), like every workspace package.
- `.github/workflows/mobile-e2e.yml` (`Mobile E2E`) runs the flows above on
  the `blacksmith-6vcpu-macos-15` runner: label a pull request `mobile-e2e`,
  dispatch it by hand (optional `flows` input), or wait for the nightly run.
  It selects Xcode 26.2 (`DEVELOPER_DIR`, falling back to the newest 26.x),
  boots the simulator `pick-simulator.mjs` chooses, installs Maestro 2.8.0
  (Java 17 from `actions/setup-java` only when the image has no JDK 17+),
  restores `ios/Pods` + `Podfile.lock` and (behind the workflow's
  `CACHE_DERIVED_DATA` knob — DerivedData is ~7 GB raw and the Actions cache
  quota is shared with the Turbo caches) the Xcode DerivedData `Build/`
  directory from `actions/cache` keyed on `pnpm-lock.yaml` + `app.json` +
  `package.json` + `patches/**`, prebuilds, builds the Release app onto the
  simulator, starts the harness backend (`turbo run e2e:mobile-backend`,
  waits for `/health`), runs `ci-run-flows.sh`, and uploads
  `e2e-artifacts/` (per-flow Maestro output, backend log, simulator log).

## bb connect (Phase 5)

- The pairing surfaces on the bb side (Settings → Remote access → Add mobile
  device, `bb connect machine-code`) sit behind the `mobileApp` experiment
  while the app is in early access: turn it on in Settings → Experiments or
  with `bb settings experiment mobileApp true` before you mint a code.
- Enrollment (`src/screens/connect`, `src/data/connect`, route `/connect`):
  "Add server" offers "Connect with bb connect" above the Direct URL form.
  The screen scans the pairing QR (`expo-camera`; payload = the connect
  plugin's `MobilePairingPayload` JSON `{code, serverUrl, apex, expiresAt}`, a
  `bb://connect?code=…&serverUrl=…` link, or a bare code —
  `parseConnectPairingPayload`) or takes the code by hand with an optional
  server (handle like `bee` or `https://bee.getbb.app`) and an optional
  self-hosted apex; the apex defaults to `deriveConnectBaseUrl(serverUrl)`
  or `https://getbb.app` (`resolveEnrollmentTarget`). `redeemEnrollment`
  calls `redeemMachineCredential` (`POST <apex>/api/connect/redeem-machine`)
  and saves `{mode:"connect", serverUrl, handle, credential(bbcm_…), label}`
  in SecureStore, then activates it: the connector mints the desktop-session
  cookie and opens realtime (the enrolled screen shows that status live).
  Errors map to copy per wire code (`describeEnrollmentError`: invalid /
  expired / already used, the 409 `machine_limit` with the "revoke a device
  in the dashboard" way out, network, unauthorized).
- Account servers: the machine credential is account-scoped (the apex stores
  it against the user, `apps/web/src/server/api.ts` `redeemMachineCode`; the
  gate checks it against the label's owner), and the desktop-session cookie
  is a `.getbb.app` cookie carrying only the user id, so one enrollment
  covers every server the account owns — the same as the desktop app's
  Server menu. After pairing, "Servers on this account"
  (`GET <serverUrl>/api/connect/servers` with the credential,
  `listAccountServers`) adds any other server as a profile in one tap with
  the same credential; no second code is needed.
- Session: `src/lib/session` mints `POST <serverUrl>/api/connect/desktop-session`
  with the credential, installs the cookie in both native jars (`Secure`
  follows the server URL's scheme so a plain-http stub gate works), renews
  five minutes before expiry and on AppState active. The connector
  (`src/lib/connection`) re-checks the session on any 401/403 (an API call
  or the `/ws` upgrade — React Native reports the refused upgrade as the
  close reason "Received bad response code from server: 401.") and on
  repeated connection failures (throttled): a fresh cookie reconnects the
  socket at once; a refused re-mint flips the profile to `auth-required`.
  Queries that raced the first mint (or a re-mint) and hit the gate's 401
  page are fetched again once the cookie lands
  (`refetchQueriesRejectedBeforeSession`); a 401 within two seconds of a
  mint is attributed to a request that started with the old cookie and
  only triggers that refetch, not another mint.
- Re-auth UX: the `auth-required` banner ("<label> needs to be paired again.")
  is a button that opens `/connect?profileId=<id>`, which re-pairs the same
  profile (new credential, same label and place in the list); Settings →
  Servers offers "Sign in again" from the long-press menu for connect
  profiles and shows a mode pill (`bb connect` / `direct`) plus `@handle`.
  "Remove" only forgets the profile locally: the phone stays listed under
  Machines in the getbb.app dashboard until revoked there (the copy says so).
- Stub for e2e (`tests/integration/mobile-e2e/connect-stub.ts`,
  `pnpm --filter @bb/integration-tests e2e:mobile-connect-stub`): plays the
  apex and the gate on one TLS port (`https://localhost:42998` /
  `https://stub.localhost:42998`, so `@bb/connect-client`'s "server lives
  under the apex" rule and the `Secure` cookie hold; iOS ATS refuses plain
  http to a qualified name). It redeems `STUB-PAIR` (sentinels
  `EXPIRED-CODE` / `USED-CODE` / `LIMIT-CODE` reproduce the apex errors),
  mints sessions for its machines, lists two account servers, and reverse
  proxies everything else (HTTP + WebSocket upgrade) to the harness backend
  — only with a valid session cookie, otherwise the gate's HTML 401 —
  rewriting `Origin: https://<gate host>` to the loopback origin like the
  tunnel client does so the bb server's origin guard accepts RN's
  WebSocket. Control: `POST /__stub/{expire-session,revoke-machine,reset}`,
  `GET /__stub/state`, also on plain `http://127.0.0.1:42997`. It generates a
  local CA under `~/.bb-mobile-e2e/connect-stub-certs` and installs it in
  the simulator named by `BB_MOBILE_E2E_SIMULATOR` (`xcrun simctl keychain …
add-root-cert`). Env: `BB_MOBILE_E2E_GATE_PORT` (42998),
  `BB_MOBILE_E2E_STUB_CONTROL_PORT` (42997), `BB_MOBILE_E2E_UPSTREAM_URL`
  (`http://127.0.0.1:${BB_MOBILE_E2E_PORT ?? 41999}`),
  `BB_MOBILE_E2E_CONNECT_CODE`, `BB_MOBILE_E2E_STUB_HANDLE`,
  `BB_MOBILE_E2E_SESSION_TTL_MS`, `BB_MOBILE_E2E_STUB_LOG=1` (one line per
  gate request).

## Push notifications and deep links (Phase 5)

- Registration: `PushNotificationsHost` (mounted once in `app/_layout.tsx`)
  registers the phone's Expo push token with each enabled server through
  Settings → This device → Notifications. It calls the `push-notifications`
  plugin RPC methods `pushSubscriptions.add`, `pushSubscriptions.list`, and
  `pushSubscriptions.remove` through `sdk.plugins.callRpc`. It syncs on
  connect, on
  AppState active, when the OS rolls the token (re-register), and when the
  toggle flips; profiles removed from the app get their server row deleted
  by the stored server URL. A direct profile must use HTTPS, unless it uses
  `127.0.0.1`, `localhost`, or `::1`. Tailscale Serve and bb connect profiles
  work normally. Other HTTP profiles show "Push needs HTTPS or bb connect"
  and do not register. The server also needs outbound access to `exp.host`.
  The server must enable the `push-notifications` plugin.
  The one-time "Get notified…" sheet appears only after the first successful
  connection. The sheet never appears on launch. The OS prompt starts only
  after the user selects "Turn on notifications".
- Privacy: the registration request contains the full Expo token. The list
  RPC method and `bb push-notifications list` return only the last six token
  characters in `tokenSuffix`. A token can receive pushes but cannot read
  server data.
- Handling: a foreground arrival becomes a toast with "Open" (no system
  banner); a tap on a background / cold-start notification opens the thread
  in the shell on the profile that owns it. The phone first matches
  the optional `serverUrl` hint. It probes saved profiles for the thread only
  when no hint matches. The shell accepts a bridge `badge` message
  (`useShellBridge` → `updateAppBadgeCount`), and `AppBadgeSync` writes that
  count on background; the web app does not send it yet.
- Simulator check without APNs: `xcrun simctl push <udid> app.getbb.mobile
payload.apns` with `{"aps":{"alert":{…}},"body":{"kind":"turn-finished",
"threadId":"…","projectId":"…","serverUrl":"https://…"}}`
  (expo-notifications reads remote `data` from the `body` key) after the user
  grants permission.
- Deep links: `bb://<path>` (`bb://threads/<id>`, `bb://settings/servers`,
  `bb://projects/<p>/threads/<t>`, …) and universal / app links
  `https://<handle>.getbb.app/{threads,projects,settings}/*` (iOS
  `associatedDomains: applinks:getbb.app, applinks:*.getbb.app`; Android
  `intentFilters` with `autoVerify`). `app/+native-intent.tsx` resolves every
  URL with `src/lib/shell` (`resolveShellIncomingLink` over `src/lib/links`):
  a web link whose origin matches a saved profile switches to that profile
  (waiting for its connection) and opens the shell route carrying the page
  path; native-only paths (connect, servers, device and notification
  settings) stay native; an unknown server opens Add server prefilled with
  the origin and the follow-up path. Universal links only resolve once
  `https://<handle>.getbb.app/.well-known/apple-app-site-association` /
  `assetlinks.json` are served (the connect gate and the apex do, before the
  session gate — `packages/connect-db/src/app-links.ts`) and the app is
  signed with the team id in that file; until then only the `bb://` scheme
  works, and wildcard associated-domain behavior still needs a physical
  device check. The realtime `thread-open` signal (`POST /threads/:id/open`,
  `bb thread open`) navigates to the thread while the app is foregrounded.

## Share sheet and haptics

- Inbound "Send to bb" is wired for `expo-share-intent` but the native module
  is **not** in the current dev client: `src/lib/share/share-intent.ts` loads
  it optionally and `src/app-shell/ShareIntentHandler.tsx` renders nothing
  when it is absent. To enable it: `npx expo install expo-share-intent`, add
  `["expo-share-intent", { "iosActivationRules": { "NSExtensionActivationSupportsText": true, "NSExtensionActivationSupportsWebURLWithMaxCount": 1 } }]`
  to `app.json` plugins, rebuild the dev client (`pnpm ios`, ~10 min, also
  reinstall it on every simulator the flows use). Shared text / URLs open
  the shell at `/?initialPrompt=`; media / file shares are declined with a
  toast.
- Outbound: the shell handles the bridge `share` request (`useShellBridge` →
  RN `Share.share`); the web app does not send it yet.
- Haptics: `src/lib/haptics/` — `haptic(kind)` maps semantic kinds
  (`selection`, `impact-light|medium|heavy`, `success`, `warning`, `error`)
  onto expo-haptics and honors the Settings → This device → Haptics toggle
  (MMKV `bb.haptics.enabled`, default on). Call sites: bridge `haptic`
  messages handled in `useShellBridge` (the web app sends none yet), the
  segmented appearance picker (selection), destructive ActionSheet rows and
  confirmations (warning), the servers long-press menu (heavy), and the
  auth-required banner (warning). Screens never import expo-haptics directly.

## Release (EAS)

The app lives in the EAS project `@bb-team/bb-app` (id in
`app.json` → `extra.eas.projectId`; the Expo slug `bb-app` also names the
dev-client scheme `exp+bb-app://`). Apple team `9QCU24SXK5`, bundle id
`app.getbb.mobile`, App Store Connect app `6803559210`. EAS holds the iOS
credentials (distribution certificate, App Store provisioning profile, APNs
push key); nobody needs a local Xcode signing setup to ship.

- **Log in once**: `pnpm exec eas login` (or `EXPO_TOKEN`). `eas-cli` is a
  pinned devDependency, so use `pnpm exec eas …` from `apps/mobile`.
- **Build profiles** (`eas.json`): `development` (simulator dev client),
  `development-device` (dev client for a physical iPhone; needed for push
  acceptance), `preview` (internal ad-hoc), `production` (App Store /
  TestFlight; `autoIncrement` + `appVersionSource: remote` keep the build
  number on EAS, `version` in `app.json` is the marketing version).
- **Push release check**: confirm the APNs key with `pnpm exec eas credentials
-p ios`. Use `development-device` for a physical iPhone. Keep the server
  `push-notifications` plugin enabled, and use an HTTPS or bb connect profile.
  Run `bb push-notifications list`. Confirm that it shows a token suffix, not
  a full token.
- **TestFlight by hand**: `pnpm exec eas build -p ios --profile production`,
  then `pnpm exec eas submit -p ios --latest`. The submit profile reads the
  App Store Connect API key from the gitignored `apps/mobile/asc-api-key.p8`
  (key id and issuer id are in `eas.json`); get the `.p8` from a teammate or
  App Store Connect → Users and Access → Integrations → App Store Connect API
  (role App Manager, one-time download). Both commands also work with
  `--non-interactive`.
- **CI**: `.github/workflows/mobile-ios-eas.yml` writes the `.p8` from the
  `ASC_API_KEY_P8` secret, optionally sets `app.json` `version`, and runs
  `eas build -p ios --profile <profile> [--auto-submit]` with
  `EXPO_TOKEN`. EAS builds, then uploads to TestFlight; the job waits for
  both and fails when either fails. Logs are on expo.dev under the project's
  Builds and Submissions (the run summary links them). After a submit, the
  job runs `scripts/testflight-distribute.mjs`, which waits for App Store
  Connect to process the build, submits it for Beta App Review when it has
  none, and adds it to the external group named by the `external_group`
  input (default `External testers`; empty skips the step). Run the script
  by hand with `node scripts/testflight-distribute.mjs --version X.Y.Z
--build N` from `apps/mobile` with the `.p8` in place.
  Run it alone from the Actions tab ("Mobile iOS (EAS)") or
  `gh workflow run mobile-ios-eas.yml -f profile=production -f submit=true`.
  The nightly `publish-bb-app.yml` calls the same workflow after the npm
  nightly publish with an empty `version`, so every nightly keeps the
  marketing version committed in `app.json` and only the EAS build number
  moves. This is deliberate: TestFlight needs a Beta App Review for the
  first build of each new marketing version, and later builds of the same
  version skip it. Bump `app.json` `version` only when you want a new
  review, for example for a store release. Repo
  secrets: `EXPO_TOKEN` (a robot token from the `bb-team` Expo org) and
  `ASC_API_KEY_P8` (the `.p8` contents).
- The `expo-modules-jsi` pnpm patch and the `lightningcss` override ship
  with the repo and apply on EAS; the default build image provides
  Xcode 26.x.
- Universal links need the signed app's team id in the AASA the connect gate
  serves (`packages/connect-db/src/app-links.ts`) and a physical-device
  check against `https://<handle>.getbb.app/threads/…`. Android signing
  (`eas credentials -p android`, FCM V1, `ASSETLINKS_SHA256_FINGERPRINTS`)
  is still open.
- `eas update` (JS-only fixes over the air) is deferred: `expo-updates` is
  not installed, so the profiles define no update channels.

## TestFlight testers

**Internal testers** need no Apple review. A build reaches the group as soon as
App Store Connect finishes processing it, usually within 30 minutes. The group
`bb team` exists and the nightly feeds it.

**External testers** need a Beta App Review on the first build of each
marketing version, and Apple usually auto-approves later builds of that
version. The nightly keeps one marketing version for this reason (see "CI"
above). Apple offers "Automatically distribute builds" only for internal
groups, so the CI distribute step adds each submitted build to the external
group through the App Store Connect API. Before a build can go to an external
group, App Store Connect needs all of this:

- **Test Information** (`betaAppLocalizations`): a feedback email, a beta
  description, and the privacy policy URL <https://getbb.app/privacy>. Per
  build, a "What to test" note.
- **Beta App Review Details** (`betaAppReviewDetail`): contact first name, last
  name, phone, and email. Apple uses these, testers never see them.
- **A way for the reviewer to use the app.** This is the part that fails. bb
  opens on "Add server", and a reviewer has no bb server, so without help they
  cannot get past the first screen and will reject the build. Neither real
  path works for a reviewer: a bb server's API is unauthenticated and runs
  commands, so it cannot be on the internet, and connect pairing codes are
  single-use and expire in ten minutes. Give them the **demo server** instead:
  `apps/demo-server` is a Cloudflare Worker that answers the launch-path API
  from fixed data, runs nothing, and isolates each client address. Deploy it
  with `pnpm --filter @bb/demo-server deploy`, and rehearse the review notes
  below before every submission. Disclose it in the notes: a disclosed demo
  mode is sanctioned by guideline 2.1.

Review notes template — keep it literal, and assume the reviewer knows nothing
about coding agents:

```text
bb is a client for a bb server that a developer runs on their own computer.
The app has no accounts of its own, so we have prepared a demo server for
you. It serves sample conversations and scripted replies; it does not run a
real coding agent.

1. Open the app. It shows "Connect to a bb server".
2. Under "Direct URL", in "Server URL", enter: https://<DEMO-HOST>
3. Tap "Connect".
4. The app shows a list of conversations. Open any of them to read it.
5. Type a message and send it. The agent replies after a moment.

Write to <EMAIL> if the server does not respond.
```

Rehearse it before submitting: hand a colleague a phone that has never run bb,
give them only these notes, and check that they reach a thread.

The nightly keeps the marketing version in `app.json` and lets the EAS build
number tell nightlies apart, because a new version string triggers a fresh
Beta App Review and another build of the same version usually does not.

## Local state

- Server profiles: `expo-secure-store`, one key per profile
  (`bb.profile.<id>`) plus `bb.profiles.index`.
- Preferences (theme mode `bb.theme`, haptics `bb.haptics.enabled`, the
  shell's last page path `bb.webviewShell.lastPath.<profileId>`): MMKV store
  `bb.preferences`, one shared instance from
  `src/lib/native/preferences-storage.ts`. Push state shares it:
  `bb.push.enabled.<profileId>` (+ `bb.push.enabledProfiles` index),
  `bb.push.registration.<profileId>` (+ `bb.push.registrations` index: the
  token / server row the phone registered, so a removed profile can still be
  unregistered), `bb.push.prompted`.
- Each profile owns one SDK client, one realtime socket, and one TanStack
  QueryClient (`src/lib/sdk/client-registry.ts`, instantiated once by
  `src/app-shell/client-registry.ts`); the active profile's socket/session
  lifecycle lives in `src/lib/connection`.

## Theme tokens

`src/theme/theme.native.ts` is generated from the web app's
`apps/app/src/components/ui/theme.css` plus the built-in palettes in
`apps/app/src/lib/themes/*.ts`: every color token per palette × light/dark as a
plain RN color string, with `nativeRadii` and the touch (`pointer: coarse`)
`nativeTypography` scale. Do not edit it by hand. After changing theme.css or a
palette, run `pnpm --filter @bb/mobile theme:generate` and commit the result;
`src/theme/generate-native-theme.test.ts` fails when the file is stale.

## Notes

- Workspace packages resolve from TypeScript source through `metro.config.js`
  (`source` export condition for `@bb/*` only, `./x.js` → `./x.ts`).
- Import `@bb/sdk/browser`, never `@bb/sdk` (lint-enforced).
- Never spread a `Headers` instance into a fetch init on React Native.
- `lightningcss` is pinned to 1.30.1 for `@expo/metro-config` (NativeWind v5).
- Type-scale line heights in `global.css` are unitless ratios
  (`calc(22 / 15)`), not px: react-native-css drops the unit inside Tailwind's
  `var(--tw-leading, …)` fallback and treats the number as an em multiplier.
- On a `ScrollView`, do not combine `contentContainerClassName` with an inline
  `contentContainerStyle`; the class styles are dropped. Use one or the other.
- `Sheet` sets `accessible={false}` on the bottom-sheet container so rows are
  reachable by VoiceOver/Maestro.
- Maestro on iOS: `back` is not a thing; tap `id: BackButton`. The dev
  client's floating gear can sit over the header's right icons on larger
  simulators.

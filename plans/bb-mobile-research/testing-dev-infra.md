## 1. Starting a real bb server + host daemon locally

**Source dev (`pnpm dev`)** — `package.json:13` runs `packages/scripts/src/commands/run-dev.ts` under `dotenv -c development`. It computes a per-checkout `DevInstanceConfig` (`packages/config/src/runtime.ts:196-210`): ports = base + sha256(repoRoot)%8000 (`runtime.ts:85-90,137-146`: app 11000+, server 19000+, host-daemon 27000+, cloud 35000+/43000+), data dir `~/.bb-dev/<label>-<hash12>` (`runtime.ts:199`), `serverUrl = http://127.0.0.1:<serverPort>` (`runtime.ts:205`). `toDevProcessEnv` (`runtime.ts:296-317`) exports `BB_DATA_DIR, BB_DEV_APP_PORT, BB_DEV_CONNECT_BASE_URL, BB_HOST_DAEMON_PORT, BB_SERVER_PORT, BB_SERVER_URL, NODE_ENV=development` then runs `turbo run dev --filter=@bb/app --filter=@bb/server --filter=@bb/host-daemon --ui tui` (`run-dev.ts:29-47`). Filters are hardcoded — there is no server+daemon-only dev entry. Port pre-checks bind 127.0.0.1 (`run-dev.ts:23,70`). Server dev = `dev-supervisor.mjs` → `tsx src/index.ts` (`apps/server/scripts/dev-supervisor.mjs:11-18`); daemon dev = `run-host-daemon.ts --auto-join` (`apps/host-daemon/scripts/dev-supervisor.mjs:11-22`), which self-enrolls via `POST /internal/hosts/enroll-key` (`run-host-daemon.ts:180-200`).

**Bind/reachability.** Server listens on `BB_SERVER_BIND_HOST` (`apps/server/src/start-server.ts:39-45`), default `127.0.0.1`, only `127.0.0.1|0.0.0.0` accepted (`packages/config/src/env-vars.ts:105-113,371`); non-loopback logs a security warning (`start-server.ts:212-216`, unauthenticated API). Vite dev binds `BB_DEV_APP_HOST` default 127.0.0.1 (`packages/config/src/vite-dev.ts:23-29`) and proxies `/api`,`/ws` (`apps/app/vite.dev.config.ts:30-45`); host-daemon local API binds 127.0.0.1 (`packages/host-daemon-contract/src/local.ts:11`, `apps/host-daemon/src/local-api-config.ts:36`). Prod: server 38886, daemon 38887, `~/.bb` (`runtime.ts:79-82`); in production the server serves `apps/app/dist` itself (`start-server.ts:64-70`). Docs for LAN/phone: `BB_SERVER_BIND_HOST=0.0.0.0` (`docs/configuration.md:848-861`), Tailscale Serve (`README.md:121-129`, `docs/multiple-devices.md:19-24`), bb connect getbb.app tunnel (`docs/multiple-devices.md:15-18`, `docs/debugging-and-qa.md:34-40`).
- iOS Simulator shares Mac loopback → `http://127.0.0.1:<BB_SERVER_PORT>` works with defaults.
- Android emulator → `http://10.0.2.2:<port>` (host loopback) or `adb reverse tcp:<port> tcp:<port>`.
- Physical phone → needs `BB_SERVER_BIND_HOST=0.0.0.0` (LAN IP), Tailscale Serve, or bb connect URL; the daemon local API is never reachable off-box (docs/multiple-devices.md:76 "Phones and tablets need no helper").

**Origin guard.** `/api/v1/*` and `/ws` reject requests whose `Origin` is not a local app origin (`apps/server/src/server.ts:450-461,496-505`; `browser-request-guard.ts:145-166`); requests with no Origin pass; an Origin equal to the request target origin or same hostname + known BB port passes (`browser-request-guard.ts:122-131`). CORS list = 127.0.0.1/localhost × {serverPort, devAppPort} + `BB_APP_URL` (`packages/config/src/local-app-origins.ts:38-58`).

**How the PWA finds the server:** `window.location.origin` (`apps/app/src/lib/api-server.ts:4-8`), WS direct to server port in dev via `__BB_DEV_WS_BROWSER_HOST_PORT__` (`vite.dev.config.ts:19-22`, `apps/app/src/lib/dev-websocket-url.ts`); daemon client hardcodes `http://127.0.0.1:<hostDaemonPort>` (`apps/app/src/lib/api-host-daemon.ts:24-27`) with port from `/api/v1/system/config.hostDaemonPort` (`packages/server-contract/src/api/system.ts:215-217`, also `serverUrl`, `primaryHostId`). QA uses `GET /api/v1/system/config` as readiness probe (`tests/qa/src/shared.ts:501-508`).

**Launcher `scripts/bb-dev-app`**: derives same ports in bash (`:157-200`, note it prints `BB_SERVER_URL=http://localhost:<port>` at `:189` whereas config uses 127.0.0.1), runs `pnpm dev` in `screen` and waits for "Host daemon started" (`:360-369`), `env` prints `BB_SERVER_URL/BB_HOST_DAEMON_PORT/BB_PROJECT_ID=proj_personal` (`:427-437`), `stop` kills port listeners (`:238-265`). `ensure_dependencies` always installs Electron (`:330-338`) — heavy for CI.

**Prod-like:** `pnpm start` (`scripts/start-bb.mjs`), `npx bb-app --data-dir --server-port --host-daemon-port --server-bind-host` (`packages/bb-app/src/launcher.ts:737-758,2638`).

## 2. Existing e2e/test patterns and seeding

- No Playwright/Puppeteer/Maestro/Detox anywhere (grep of package.json/docs: none). No RN/Expo/Metro in `pnpm-lock.yaml` (0 matches). Ladle storybook only (`apps/app/package.json:14`).
- Unit tests: Vitest 4 (`package.json:60`), root `vitest.config.ts:14-25` auto-discovers any `apps/*|packages/*|tests/*|examples/plugins/*` dir with `vitest.config.ts`; `vitest.shared.ts:79-95` adds `source` resolve condition. `apps/app/vitest.config.ts` uses node env + jsdom polyfills (`apps/app/src/test/setup.ts`).
- **In-process integration harness** `tests/integration/helpers/harness.ts`: real Hono server (`createApp`) on `127.0.0.1:0` (`:371-383`), in-memory DB (`:249`), real `createHostDaemonApp` in-process with fake provider adapter default (`:149-156,425-470`), temp git repo (`helpers/seed.ts:56-88`), API via `createPublicApiClient` (`:517`). Fixtures: `createProjectFixture`, `createReadyHostThread` (`helpers/fixtures.ts:55-105`). Fake adapter echoes `Response to: …`, supports `delay:<ms>`, `call_tool:<n>`, `ask_user` (`packages/agent-runtime/src/test/fake-adapter.ts:471-483`). Fixed env in `tests/integration/vitest.config.ts:22-27` (`BB_DATA_DIR=/tmp/bb-integration-test`, ports 49161/49162). Real-provider suite `tests/integration/real/*` (`vitest.real-provider.config.ts`).
- **Standalone QA processes** `pnpm qa:standalone:start --format json|env` (`package.json:37`, `tests/qa/scripts/run-root-command.mjs:8-18` builds server/daemon/cli dist first): reserves random loopback ports (`tests/qa/src/standalone/start.ts:75-77`), spawns `apps/server/dist/index.js` with `BB_DATA_DIR/BB_SERVER_PORT` (`shared.ts:536-555`), enroll key + `apps/host-daemon/dist/index.js` with `BB_HOST_ENROLL_KEY/BB_HOST_ID/BB_SERVER_URL/BB_HOST_DAEMON_PORT` (`start.ts:103-120`), creates a project via `POST /api/v1/projects` (`start.ts:122-126`, `shared.ts:341-358`), writes state JSON. Manual runbook `qa/manual-runbook.md`.
- Seeding data: `pnpm seed:perf` (`packages/scripts/src/commands/seed-perf-db.ts:32-52`, direct DB write, refuses `~/.bb`), CLI `pnpm bb:dev project create / thread spawn` (`apps/cli/src/commands/project.ts:487-514`, `docs/debugging-and-qa.md:46-49`), SDK `@bb/sdk/browser` (`packages/sdk/src/browser.ts`), `@bb/server-contract` `createPublicApiClient`.

## 3. Wiring `apps/mobile`

- Workspace: `pnpm-workspace.yaml` includes `apps/*` — auto-member. Root `.nvmrc` 22.12.0 vs `engines >=22.19.0` (`package.json:7`); pnpm 9.15.0 (`:57`); `supportedArchitectures.os: current`, `overrides zod 4.3.6` (`:58-68`); lock `autoInstallPeers: true`.
- Turbo (`turbo.json`): generic `build` (outputs `dist/**`, dependsOn `topo`), `typecheck` (dependsOn `topo`), `lint`, `test` (dependsOn `//#ensure-native-modules`, `topo`), `dev` tasks are per-package (`@bb/app#dev` etc.) — add `@bb/mobile#dev` (`cache:false, persistent:true, passThroughEnv:["*"]`) and, if needed, `@bb/mobile#build` inputs. Any `build/typecheck/lint/test` script is picked up by CI `checks` (`.github/workflows/ci.yml:41`: `turbo run build typecheck lint`, all packages) and the `packages` test shard (`ci.yml:120-122`, ubuntu). macOS runners exist: `blacksmith-6vcpu-macos-15` (`ci.yml:155`, PR package-smoke; `build-desktop.yml:34`), no Turbo cache on macOS (`ci.yml:133-139`).
- ESLint: single root flat config applies to `apps/**/*.{ts,tsx}` (`eslint.config.mjs:91-129`), but only `apps/app` defines a `lint` script and holds eslint devDeps (`apps/app/package.json:15,151-153`) — mobile needs its own `lint` script + `eslint`, `@typescript-eslint/parser`, `eslint-plugin-react-hooks` devDeps. Prettier: root `format:check` not in CI; `.prettierignore` ignores generated files.
- tsconfig: extend `@bb/tsconfig/base.json` (NodeNext, composite) + `typecheck-overrides.json` (noEmit, `customConditions:["source"]`) and override `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, pinned `types` (pattern: `apps/app/tsconfig.json`).
- Metro/pnpm: no `.npmrc` → isolated node-linker. Expo docs (fetched): SDK 52+ `expo/metro-config` auto-configures monorepo `watchFolders/nodeModulesPaths`; `nodeLinker: hoisted` only as troubleshooting fallback (would change plugin isolation model, see `pnpm-workspace.yaml` comment). Workspace packages have no `main`, only `exports` with `source/types/default → src/*.ts` (`packages/server-contract/package.json:5-11`, `@bb/config`) and use `.js` relative specifiers (`packages/server-contract/src/index.ts:1-6`, `packages/domain/src/index.ts` 53×) → Metro needs `unstable_enablePackageExports` (+ `unstable_conditionNames` incl. `source`) and a `resolveRequest` that maps `./x.js`→`./x.ts(x)`.

## 4. E2E recommendation

Maestro (YAML flows via `maestro test`, works against Expo dev-client/release builds on iOS Simulator + Android emulator, no native test target like Detox; Expo has no first-party e2e). Backend: a Node script under `apps/mobile/e2e/` reusing `tests/integration/helpers/harness.ts` (server + in-process daemon + fake adapter, fixed port, `BB_SERVER_BIND_HOST=0.0.0.0` only for physical devices) or `pnpm qa:standalone:start --format json` for real providers; seed with `createPublicApiClient`/`@bb/sdk`/`pnpm bb:dev`; pass server URL via `EXPO_PUBLIC_*`/Maestro `--env` + deep link; iOS uses 127.0.0.1, Android `adb reverse`. Run unit tests on Linux shard; simulator e2e on `blacksmith-6vcpu-macos-15`, nightly/label-gated.

## Key files
- packages/scripts/src/commands/run-dev.ts
- packages/config/src/runtime.ts
- packages/config/src/env-vars.ts
- packages/config/src/vite-dev.ts
- packages/config/src/local-app-origins.ts
- apps/app/vite.dev.config.ts
- apps/server/src/start-server.ts
- apps/server/src/server.ts
- apps/server/src/browser-request-guard.ts
- apps/app/src/lib/api-server.ts
- apps/app/src/lib/dev-websocket-url.ts
- apps/app/src/lib/api-host-daemon.ts
- packages/server-contract/src/api/system.ts
- scripts/bb-dev-app
- docs/debugging-and-qa.md
- docs/configuration.md
- docs/multiple-devices.md
- tests/integration/helpers/harness.ts
- tests/integration/helpers/fixtures.ts
- tests/integration/helpers/seed.ts
- tests/integration/vitest.config.ts
- packages/agent-runtime/src/test/fake-adapter.ts
- tests/qa/src/standalone/start.ts
- tests/qa/src/shared.ts
- tests/qa/scripts/run-root-command.mjs
- packages/scripts/src/commands/seed-perf-db.ts
- packages/scripts/src/commands/run-host-daemon.ts
- turbo.json
- pnpm-workspace.yaml
- package.json
- vitest.config.ts
- vitest.shared.ts
- eslint.config.mjs
- packages/tsconfig/base.json
- packages/tsconfig/typecheck-overrides.json
- apps/app/tsconfig.json
- apps/app/vitest.config.ts
- apps/app/src/test/setup.ts
- .github/workflows/ci.yml
- .github/actions/setup-workspace/action.yml
- .github/workflows/build-desktop.yml
- packages/test-helpers/src/index.ts
- packages/sdk/src/browser.ts
- packages/server-contract/package.json
- apps/cli/src/commands/project.ts

## Reuse verdicts
- @bb/config (packages/config): **not-reusable** — Node builtins throughout: node:crypto/node:os/node:path in runtime.ts:1-3, node:os in env.ts:1, node:path in client-config.ts:1; reads process.env. Only pure helpers (local-app-origins.ts, defaults.ts) could be copied into the RN app.
- @bb/server-contract, @bb/host-daemon-contract, @bb/domain: **reusable-with-small-changes** — No node:/DOM imports found (grep of src/, non-test); depend on hono/client (`hc`) + zod. Metro needs package-exports resolution (no `main`, exports point to .ts via source/default) and a `.js`→`.ts` specifier rewrite (packages/server-contract/src/index.ts:1-6).
- @bb/sdk (packages/sdk/src/browser.ts, core.ts, transport-http.ts): **reusable-with-small-changes** — No node: imports except node-websocket.ts; must pass explicit baseUrl/realtimeUrl (default is same-origin, transport-http.ts:17); realtime uses global WebSocket (RN provides one). Same Metro exports/.js caveats.
- @bb/test-helpers: **not-reusable** — node:fs/promises in setup-markers.ts:1; it is a Node test utility, fine for Node-side e2e seeding scripts only.
- tests/integration harness (tests/integration/helpers/harness.ts): **headless-logic-only** — Node-only (Hono node-server, in-process daemon, fs/tmpdir). Reusable as the backend launcher for mobile e2e, not inside the app; binds 127.0.0.1:0 (harness.ts:371-383) so a fixed port/bind host must be parameterized.
- tests/qa standalone scripts (tests/qa/src/standalone/*): **headless-logic-only** — Node child_process/ps/lsof based; spawns built dist of server/daemon; usable as an e2e backend with real providers, requires `pnpm build` first.
- scripts/bb-dev-app: **headless-logic-only** — Bash + GNU screen + lsof; macOS/Linux dev only; ensure_dependencies installs Electron unconditionally (bb-dev-app:330-338).
- apps/app vitest setup (apps/app/src/test/setup.ts, vitest.config.ts): **not-reusable** — jsdom/window/document polyfills; irrelevant to RN test runner (jest-expo or vitest with react-native preset would be separate).

## Risks
- Metro cannot resolve workspace packages as-is: they have no `main`, only `exports` (source/types/default→.ts) and use `.js` relative specifiers; requires unstable_enablePackageExports + custom resolveRequest, otherwise every @bb/* import fails at bundle time.
- pnpm isolated node_modules (no .npmrc) may trip RN native module/peer resolution; Expo suggests `nodeLinker: hoisted` as fallback, but that changes the whole-monorepo plugin isolation model (pnpm-workspace.yaml comment).
- Server API is unauthenticated; reaching it from a physical phone requires BB_SERVER_BIND_HOST=0.0.0.0 (security warning at start-server.ts:212-216) or Tailscale/bb connect; e2e scripts must not leave a 0.0.0.0 listener running.
- Origin guard on /api/v1 and /ws (server.ts:450-461,496-505): RN fetch sends no Origin (passes), RN WebSocket sends an Origin derived from the URL — passes only because same-target-origin/same-hostname+known-port is allowed; verify empirically on iOS and Android emulator (10.0.2.2) before relying on it.
- No existing server+daemon-only dev command: run-dev.ts hardcodes --filter=@bb/app; e2e must either accept Vite starting or add a new script/flag.
- Dev ports are hash-derived per checkout path (runtime.ts:137-146); any e2e config that hardcodes ports will break across worktrees; derive via `scripts/bb-dev-app env` or resolveCurrentDevInstanceConfig.
- CI: only ubuntu Blacksmith runners run tests; iOS simulator e2e needs blacksmith-6vcpu-macos-15 (no Turbo cache there); Android emulator on Linux needs KVM support (unverified for Blacksmith).
- Root `.nvmrc` (22.12.0) disagrees with `engines` (>=22.19.0); Expo CLI/EAS Node requirement should be checked against 22.x.
- React version skew: apps/app uses react ^19.0.0 while Expo SDK pins exact react/react-native; @bb/shared-ui peer-deps react ^19 — isolated linking allows separate copies but shared UI packages consumed by both apps could double-install React.
- Only apps/app has a lint script and eslint devDeps; forgetting to add them to apps/mobile means CI lint silently skips it.
- bb-dev-app installs Electron even for non-desktop launches (bb-dev-app:330-338) — slow/fragile in CI; prefer `pnpm dev` or the QA standalone scripts.
- Fake provider adapter is only wired in-process (tests/integration harness); the standalone daemon (apps/host-daemon/dist) has no env switch for fake providers, so a deterministic e2e backend requires writing a harness-based launcher.

## Open questions
- Should apps/mobile use jest-expo (Expo default) or vitest with a react-native preset? Root vitest.config.ts auto-discovers only dirs with vitest.config.ts; turbo `test` runs whatever `test` script exists.
- Does the RN WebSocket Origin header (`http://127.0.0.1:<port>` / `http://10.0.2.2:<port>`) actually pass browserRequestProblem on both platforms? Needs an empirical check.
- Which Expo SDK / RN version, and does its Metro default (unstable_enablePackageExports) suffice, or must apps/mobile ship a metro.config.js with a `.js`→`.ts` resolveRequest and `source` condition?
- Should a `pnpm dev:backend` (server+daemon only, optionally 0.0.0.0) script be added to packages/scripts for simulator/device e2e, and should `bb-dev-app env` print 127.0.0.1 instead of localhost?
- Where should the deterministic e2e backend live (apps/mobile/e2e vs tests/mobile-e2e workspace package) and should it reuse tests/integration/helpers/harness.ts directly (it imports apps/server/src via relative paths) or a copied/parameterized variant with fixed port + bind host?
- CI budget: run Maestro iOS e2e on blacksmith-6vcpu-macos-15 per PR, or nightly/label-gated? Is Android emulator (KVM) available on Blacksmith Linux runners?
- How does the mobile app receive its server URL for e2e (EXPO_PUBLIC_BB_SERVER_URL at build time vs deep link/QR at runtime), and should the server URL entry screen accept bb connect getbb.app URLs and Tailscale HTTPS origins?
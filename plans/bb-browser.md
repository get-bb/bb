# Lean BB Agent Browser

## Outcome

Agents can reliably test web applications through BB's visible in-app Browser
using reproducible `bb browser` commands. Users can watch and stop automation.
Page interaction uses native Chromium input and accessibility data. Exact-value
native `<select>` is the sole bounded exception: stock Electron/Chromium has no
exact-value select primitive on macOS, so the driver may use one fixed internal
DOM operation after exact CDP ownership and semantic validation, followed by an
exact accessibility postcondition. Arbitrary or caller-provided JavaScript
remains prohibited.

Status (2026-08-30): implementation approved as one cohesive external PR,
developed through three bounded internal implementation phases. Internal Phase 1
is implemented on this branch (see "Internal Phase 1 status" below), Internal
Phase 2 owns native desktop control, and Internal Phase 3 owns CLI, skill, and
the internal experiment. PR #1869 is an implementation reference only and must
not merge as-is.

## Resolved Decisions

1. **Trust boundary.** BB's existing boundary applies unchanged: local
   processes and Connect-authenticated owner clients are trusted. The server
   does not attempt cryptographic desktop attestation, and it does not try to
   exclude ordinary trusted local WebSocket clients by proving they are the
   desktop app. What the server does enforce: target and request IDs are
   generated server-side and unguessable, thread and host ownership are derived
   server-side from the database (payloads never carry them), acknowledgements
   must match the exact connection, renderer window identity, request ID, and
   target ID that the server chose, and a client can only advertise the Browser
   automation capability. It can never register, list, or adopt pre-existing
   user tabs.
2. **Vertical lifecycle first.** Internal Phase 1 implements only `open`,
   `list`, and `close`. It defines no accepted-but-unconsumed `navigate`, `wait`,
   `snapshot`, `click`, `type`, `press`, `select`, or `screenshot` fields;
   Internal Phase 2 adds those contracts alongside their native CDP consumption
   so nothing ships as dead schema.
3. **Internal until the CLI lands.** This is one evolving feature branch, so
   the Internal Phase 1 service methods stay internal (no HTTP route, CLI, or
   SDK surface) until Internal Phase 3. Every production path added in Internal
   Phase 1 is still reachable through the renderer lifecycle and is proved by
   integration tests rather than scaffolding.

Related plans:

- `plans/in-app-browser-open-behavior-improvements.md` covers ordinary link
  opening and default-browser bypass rules.
- `plans/bb-settings.md` covers scriptable settings.

## V1 Non-Goals

- Plugin Browser SDK or custom Browser toolbar actions
- Browser Context selection/comment UI
- Arbitrary control of user-created tabs
- Main-world or arbitrary JavaScript evaluation; the fixed isolated-world exact
  native-select operation described in Phase 2 is the only exception
- Downloads, extensions, profiles, or general browser replacement features
- Persistent targets across BB restarts
- Provider-specific Browser implementations

## Public Interface

The CLI is the canonical, reproducible surface:

```bash
bb browser open <url> --json
bb browser list --json
bb browser snapshot <target-id> --json
bb browser click <target-id> --ref <ref>
bb browser type <target-id> --ref <ref> --text "..."
bb browser press <target-id> --key Enter
bb browser select <target-id> --ref <ref> --value <value>
bb browser navigate <target-id> <url> --json
bb browser wait <target-id> --text "Saved"
bb browser screenshot <target-id> --json
bb browser close <target-id>
```

A built-in skill teaches agents these commands. Native agent tools may be added
later as thin wrappers only if model evaluations demonstrate a material benefit.
Every command supports `--json`; `BB_THREAD_ID` supplies the default owner.

## Ownership And Execution

Every automation target belongs to one host and thread. Agents can control only
targets created through `bb browser open`. Existing user-created Browser tabs
cannot be silently adopted. The target registry is in memory for v1.

```text
Agent / CLI
  -> authenticated server Browser API
  -> authenticated desktop renderer connection
  -> renderer opens/focuses the visible BB Browser tab
  -> desktop main controls its WebContentsView through scoped CDP
  -> result returns through server
```

The renderer owns BB panel layout. Desktop main owns native page interaction.
The server owns authorization, defaults, limits, cancellation, request
coordination, and target ownership.

## Internal Phase 1: Secure Target Lifecycle Foundation

### Scope

Build the `open`, `list`, `close` target lifecycle end to end without exposing
unfinished Browser commands publicly. The public target shape is:

```ts
interface BrowserAutomationTarget {
  targetId: string;
  threadId: string;
  hostId: string;
  status: "opening" | "ready" | "closed";
  url: string;
  createdAt: number;
  updatedAt: number;
}
```

The server keeps the correlation fields (connection, renderer `windowId`,
`tabId`, and the per-open `requestId`) internal. `navigationEpoch`, `visible`,
and `navigating` arrive with Internal Phase 2, where they are consumed.

One server-owned `BrowserAutomationService` owns target registration and
ownership, desktop connection selection, open dispatch and correlation,
timeouts, disconnect cleanup, and closed-target errors. `NotificationHub` stays
a thin transport seam: it only answers which sockets hold a `thread-detail`
subscription.

Transport: the existing generic app realtime channel (`/ws`). A desktop
renderer advertises `browser-automation.capability` with the window identity it
obtained from desktop main and withdraws it when the renderer lifecycle stops.
The server sends `browser-automation.open`
(`requestId`, `targetId`, `threadId`, `url`) to one compatible connection that
is subscribed to the thread; the renderer creates a fresh Browser tab through
the ordinary tab path, activates and reveals it, waits for matching native
Browser state after attach, then replies `browser-automation.open-ready` with
the exact `requestId`, `targetId`, `windowId`, and `tabId`. The server sends
`browser-automation.close` to remove that automation tab, which triggers the
normal native detach. Renderers report `browser-automation.target-closed` when
the user closes an automation tab. Reconnects never resurrect targets.

Limits and defaults:

- four live targets per thread; the fifth open is rejected immediately
- 30-second default and 120-second hard open timeout
- bounded URLs (http/https only, 4096 characters), IDs, and error details
- no request queue; excess work is rejected

Security requirements:

- derive host and thread ownership server-side from the thread's environment;
  payloads never carry ownership
- accept an acknowledgement only from the exact connection, window, request,
  and target the server chose; anything else is ignored
- prevent one thread from listing or closing another thread's targets
- never list or adopt pre-existing user tabs; the only registrable thing is the
  capability itself

Stable error codes: `browser_client_unavailable` (`no_client`, `incompatible`,
`disconnected`), `browser_target_limit`, `browser_target_not_found`,
`browser_target_closed`, `browser_open_timeout`, `browser_open_failed`
(`thread_not_open`, `tab_unavailable`), plus the existing
`thread_environment_unavailable` and `thread_not_found`. The in-memory service
keeps a bounded recent closed-target history so immediate retries return
`browser_target_closed`; after eviction or server restart, an old target ID is
indistinguishable from an unknown ID and returns `browser_target_not_found`.

### Internal Phase 1 status

Implemented on this branch:

- `packages/domain/src/browser-automation.ts`: capability, open/close, and
  reply message schemas, the target shape, limits, and error reasons
  (re-exported from `@bb/server-contract`, error schemas in
  `packages/server-contract/src/errors.ts`)
- `apps/server/src/services/browser/browser-automation.ts`: the service, wired
  through `apps/server/src/ws/client-protocol.ts` and `AppDeps`
- `packages/desktop-contract` + `apps/desktop/src/desktop-window-identity.ts`,
  `preload.ts`, `main.ts`: `getWindowIdentity()` issued by desktop main
- `apps/app/src/lib/browser-automation-client.ts`,
  `apps/app/src/lib/ws.ts`, and
  `apps/app/src/components/secondary-panel/useBrowserAutomationThreadHost.ts`:
  capability advertisement and the renderer open/close lifecycle mounted from
  `ThreadDetailView`

Tests: `apps/server/test/services/browser/browser-automation.test.ts`,
`apps/server/test/app/browser-automation-websocket.test.ts` (real WebSocket
through the production client protocol), `packages/domain/test/browser-automation.test.ts`,
`apps/desktop/test/desktop-window-identity.test.ts`,
`apps/desktop/test/preload-window-identity.test.ts`,
`apps/app/src/lib/browser-automation-client.test.ts`,
`apps/app/src/lib/ws.browser-automation.test.ts`, and
`apps/app/src/components/secondary-panel/useBrowserAutomationThreadHost.test.tsx`.

Still open for the cohesive PR: cross-host enforcement at the daemon/CLI
boundary (the caller's host identity only exists once Internal Phase 3 adds the
API surface; targets already record their derived host), and user Stop, which
needs an in-flight command to stop (Internal Phase 2).

Acceptance:

- cross-thread access is rejected; host ownership is server-derived
- recently closed targets are rejected with `browser_target_closed` without
  unbounded retention of attacker-driven target IDs
- disconnect or capability withdrawal closes targets and settles pending opens
  once
- timeout and close races settle once and tell the renderer to drop the tab
- the fifth live target per thread is rejected
- old desktop clients receive an actionable compatibility error
- only a server-requested fresh tab can acknowledge; forged or late
  acknowledgements are ignored

## Internal Phase 2: Native Desktop Browser Driver

### Scope

Add the `navigate`, `wait`, `snapshot`, `click`, `type`, `press`, `select`, and
`screenshot` contracts together with their consumption: one in-flight command
per target, cancellation and user Stop that settle once, navigation epochs,
bounded typed text, keys, snapshots, and JSON depth, and `busy` errors for
concurrent commands.

Extend `DesktopBrowserViewManager` with automation-target lookup and scoped CDP
control. Register automation-owned tabs only, map each `targetId` to one
`WebContentsView`, maintain loading and navigation epoch, and clean up CDP on
close, renderer loss, disconnect, or shutdown.

Snapshots use `Accessibility.getFullAXTree`, with supporting DOM resolution only
where required. Return a compact tree containing temporary `ref`, role,
accessible name, current value, checked/selected/disabled/expanded state,
relevant href, bounds, visibility, and snapshot generation. References expire
on navigation and may refresh after meaningful DOM changes. Do not synchronously
walk the page DOM.

Native actions use CDP:

- click: `Input.dispatchMouseEvent`
- type: focus the target and use `Input.insertText`
- press: `Input.dispatchKeyEvent`
- screenshot: `Page.captureScreenshot`
- navigate: `Page.navigate`
- wait: lifecycle events plus bounded text/ref predicates

Exact-value select is the only non-native-input action. CDP resolves the exact
automation-owned ref to a native enabled single-value popup `SELECT`, resolves
a unique enabled exact-value `OPTION`, and verifies navigation and snapshot
generation. The driver then resolves only that select into an isolated world and
calls one constant function with only the separately resolved validated option
object. The function can only set that select to its already-validated option
and emit bubbling `input` and `change`; it contains no caller text, selectors,
unrelated DOM walk,
global, network, or storage access and returns no page data. CDP accessibility
must then report the exact option backend node selected before the action can
settle. No generic evaluation surface is exposed.

An action that starts navigation within the bounded 500 ms post-input causality
window returns success only after the commit and readiness settle under the
command deadline, with the resulting URL and epoch. Later timer-driven
navigation is not attributed to the completed action; callers can use `wait` or
`snapshot` afterward. An action must not be cancelled merely because it
initiated navigation.

The Browser tab shows the owning thread, an "Agent using this tab" indicator,
and Stop. Stop promptly cancels the server request and native operation.

Likely owners:

- `apps/desktop/src/desktop-browser-view.ts`
- `apps/desktop/src/desktop-browser-main-ipc.ts`
- `apps/desktop/src/desktop-browser-ipc.ts`
- `apps/desktop/src/preload.ts`
- `apps/app/src/components/secondary-panel/BrowserTabContent.tsx`

Acceptance uses real Electron fixtures and proves pointer-driven menus, React
controlled inputs, rich-text editors, native selects, normal keyboard behavior,
SPA and document navigation, inactive-target screenshots, bounded large-page
snapshots, and prompt Stop without page damage.

### Internal Phase 2 status

Milestones 2A and 2B plus the first independent-review repair pass are
implemented on this branch. The server owns a bounded, one-command-per-target
coordinator for `navigate`, `wait`, `snapshot`, `click`, `type`, `press`,
`select`, and `screenshot`; exact socket, window, tab, target, command,
navigation-epoch, and snapshot-generation correlation is enforced at every
realtime and desktop IPC boundary. Disconnect, reconnect, close, timeout,
cancel, stale-result, and late-result paths settle once. Cancellation recovery
carries authoritative page state before admitting another command, so a commit
that races Stop or timeout cannot strand the target on a stale epoch.

Desktop main remains the only target-to-`WebContentsView` registry. A bounded
one-time reservation must precede and be consumed by the exact fresh tab attach;
pre-existing tabs cannot be registered. Its scoped CDP driver uses Chromium
accessibility and DOM description data plus native input, with only the fixed
isolated-world exact-select operation defined above. Snapshot replies are
validated iteratively, snapshot refs publish atomically, native operations race
cancellation/deadlines, hung debugger work is retired, exact select values are
validated and postcondition-checked without trusting function output, pointer
targets are scrolled and clipped to the viewport, and text waits avoid rebuilding
bounds and refs on each poll. Socket loss immediately unregisters and closes
exact renderer-owned tabs. Only an explicit in-flight `navigate` is stopped at
the page-loading layer.

Focused Turbo evidence after the repair pass:

- domain Browser contracts: 5 tests passed
- desktop-contract Browser/window contracts: 14 tests passed
- server service, production WebSocket, and client protocol: 30 tests passed
- renderer client, WebSocket routing, thread host, and Stop chrome: 21 tests
  passed
- desktop driver, production view manager, IPC/preload, and window identity: 57
  tests passed
- affected package typechecks for domain, server-contract, desktop-contract,
  server, app, and desktop passed together

Final exact-select gate evidence on 2026-08-30, run through
`npm exec -- pnpm exec turbo`:

- desktop driver unit suite, including exact-select boundaries: 15 tests passed
- domain Browser contracts: 5 tests passed
- desktop-contract Browser/window contracts: 14 tests passed
- server Browser service, real WebSocket, and client protocol: 30 tests passed
- renderer Browser client, routing, thread host, and Stop chrome: 21 tests passed
- desktop driver, view manager, IPC/preload, and window identity: 57 tests passed
- real Electron 41 loopback fixture: all 10 separately reported plan scenarios passed (pointer-driven menu, React controlled form, rich-text editor, native select, SPA routing, full navigation, delayed loading, large DOM, error and timeout states, screenshot verification); fresh reservation/user-tab rejection and normal keyboard output passed as extra gates
- six affected package typechecks: all 9 Turbo tasks passed

Bounded PNG base64 is permitted only on the private desktop → renderer → server
Phase 2 transport. No public route, SDK, CLI, or agent-facing result exposes it.
Before Phase 3 makes screenshots agent-facing, Phase 3 must persist the bytes
through the closest canonical bounded thread/project file or artifact service
and return metadata/path only.

The Phase 2B implementation is ready for fresh independent code and security
review. A real Electron loopback fixture exercises the production view manager
and CDP driver through ten separately reported plan scenarios: pointer-driven
menu, React controlled form, rich-text editor, native select, SPA routing, full
navigation, delayed loading, large DOM, error and timeout states, and screenshot
verification. Fresh-tab provenance and normal keyboard output remain extra gates
rather than substitutions for those ten. AX snapshots assert the visible
controlled-input value, keyboard output, and navigation outcomes. The fixture
also proves the fixed exact-select exception with label/value mismatch, React
`input` and `change`, visible controlled state, inert injection-shaped caller
data, exact AX postcondition, and rejection of missing, duplicate, disabled,
non-select, multiple, and listbox-sized targets. Phase 2 implementation and its
real-Electron gate are complete for fresh final review.

## Internal Phase 3: CLI, Skill, And Internal Experiment

Status (2026-08-30): the typed public contract, server routes, SDK area, CLI
commands, experiment gate, trusted caller-host consistency check, bounded
thread-confined screenshot storage/retrieval/materialization, privacy-safe
metrics, built-in skill, guide/index synchronization, and focused tests are
implemented. The Darwin CLI boundary integration fixture invokes the built
`apps/cli/bin/bb` executable through the real server, canonical daemon local-host
discovery, production renderer client, preload/IPC, and native Browser view
manager. It builds a dedicated Electron main and renderer fixture rather than a
packaged desktop artifact. Run it with
`npm exec -- pnpm exec turbo run test:browser-cli-electron --filter=@bb/integration-tests --force`.
Its grouped gates cover experiment-off, ownership isolation, screenshot
materialization, and leak-free cleanup. Both dedicated Electron tasks run in an
explicit macOS CI job. Linux native Electron coverage remains a follow-up; the
dedicated tasks fail with an actionable Darwin-only message there. A model run
additionally requires provider credentials and remains separate from
deterministic CLI proof.

Add `apps/cli/src/commands/browser.ts` and register it in the CLI. Human output
stays concise and machine output stable. Screenshots are stored as bounded
thread artifacts/files rather than emitted as data URLs in stdout.

Add `apps/server/src/services/skills/builtin-skills/bb-browser/SKILL.md`. Teach
agents to open an owned target, wait, snapshot, act by reference, re-snapshot
after meaningful changes, capture screenshots only when visual evidence matters,
and close targets when finished.

Ship behind a server-backed internal experiment. Collect only non-sensitive
operational metrics: command outcome, latency/size, navigation timeouts,
cancellation latency, target leaks, and whether a target was closed after at
least one successful command. This close heuristic is not workflow completion,
and retries are not reported until retries exist. Never collect page contents,
screenshots, form values, or secret-bearing URLs.

## Validation

A loopback Electron fixture covers:

1. pointer-driven menu
2. React controlled form
3. rich-text editor
4. native select
5. SPA routing
6. full navigation
7. delayed loading
8. large DOM
9. error and timeout states
10. screenshot verification

Security coverage owns thread/host isolation, uncorrelated acknowledgements,
stale revisions, closed targets, concurrent request rejection, oversized/deep
payloads, and desktop disconnect during action.

Model graduation uses representative fixture and public-site journeys with
visible-result verification. Graduation requires at least 8/10 clean Claude runs,
no manual intervention, no cross-thread access, no stuck targets, and no action
that reports success without the expected visible effect. Ten sequential
provider-backed Claude Fable 5 runs passed cleanly (10/10): controlled and rich
form interaction, exact select, Enter form submission, PageUp/PageDown scrolling,
offscreen click, deliberate overlay rejection, SPA and full-document navigation,
stale-ref rejection/recovery, screenshots, Wikipedia search/article navigation,
Hacker News list/discussion navigation, and empty-target cleanup. Each run began
and ended with an empty target list and used wait/snapshot evidence rather than
command exit status alone.

Final repair validation:

- Browser routes reject both declared and chunked bodies over 256 KiB with 413
  before service dispatch; artifact tests cover injected metadata-commit failure,
  restart reconciliation, confinement, modes, and deterministic retention.
- The production manager activates its owning app window and target before native
  pointer/keyboard actions. The native fixture attaches expected Stop rejections
  immediately so intentional cancellation cannot become an unhandled rejection.
- Three consecutive native Electron runs passed all ten scenarios, including SPA
  and document action settlement, inactive screenshot, Stop, and cleanup. Three
  consecutive Browser CLI Electron boundary runs passed all eight grouped gates,
  including final screenshot, close/list, and debugger/view cleanup.
- All nine affected package typechecks and focused Browser tests passed. The full
  server and desktop suites each had one unrelated five-second resource timeout
  (`update-resolver.test.ts` and `preload-window-identity.test.ts` respectively);
  their Browser-focused tests and Electron gates passed.
- Provider-backed Claude Fable 5 graduation passed 10/10 sequential runs through
  the built CLI and real Electron boundary. Linux native Electron behavior remains
  an explicitly unvalidated follow-up.

### Deep-review robustness pass

Accepted Fable follow-ups are implemented before live-agent trials. Command
cancellation recovery is bounded to five seconds and retires the target
fail-closed with renderer cleanup when the exact desktop never returns
correlated authoritative state. Renderer/native transport rejection no longer
fabricates an empty authoritative URL. Older server epochs may resynchronize
only for ref-free `wait`, `snapshot`, and `screenshot`; ref actions and future
epochs remain stale-revision failures.

Snapshot-ref grammar and key validation now live in the shared domain contract.
Click verifies a bounded set of in-viewport points with
`DOM.getNodeForLocation`, accepting only the exact backend node or a bounded
ancestor/descendant relationship and rejecting overlays with a stable actionable
error. Native key dispatch supplies bounded Chromium `key`, `code`, virtual-key,
and text semantics for common navigation/form keys and printable ASCII. The
built-in Browser skill is omitted from the injected catalog while the
`browserAutomation` experiment is disabled, and the skill documents
page-initiated resynchronization, caret-preserving `type`, and PageUp/PageDown
snapshot workflow. Desktop stale-revision classification uses private typed
errors rather than message substrings.

Focused regressions cover lost cancel/result recovery, close/disconnect timer
cleanup, non-authoritative IPC failure and later recovery, spontaneous
navigation, shared ref parsing, overlay rejection, nested pointer content,
bounded key descriptors/default form action, and experiment-gated skill
injection. The native Electron fixture retains all ten plan scenarios and adds
explicit nested-hit, overlay-interception, and default Enter form-action gates.

For non-CI provider trials, the packaged boundary script accepts
`--agent-trial-server <absolute-state-file>`. It performs the same real
server/renderer/preload/Electron setup, atomically publishes a private `0600`
state file containing the harness URL/port, owning thread/storage, built CLI path,
and fixture URL, then remains alive until SIGINT/SIGTERM and removes the state
file and temporary runtime during cleanup. Agents use the built CLI with those
environment values; the normal no-argument CI journey remains unchanged. Trial
results are evaluation evidence, not checked-in fixtures or a replacement for the
deterministic gates.

## Migration From PR #1869

Reuse navigation epoch concepts, desktop IPC validation patterns, request
correlation, cancellation/disconnect handling, screenshot revision checks,
compatibility feature detection, and focused lifecycle tests.

Do not carry forward DOM action scripts, synthetic keyboard input, custom DOM
snapshots, the plugin Browser SDK, Browser action toolbar/overflow, hidden
mounted plugin components, main-world scripts, or arbitrary cross-tab discovery.

Once the cohesive PR is ready, mark #1869 superseded and link it to the
replacement implementation.

## Internal Delivery Order

All three phases remain one reviewable external PR; no phase is a merge
dependency.

```text
Internal Phase 1: secure foundation
  -> Internal Phase 2: native CDP driver
  -> Internal Phase 3: CLI + skill + internal experiment
  -> independent review and internal evaluation
  -> one cohesive external PR
  -> only then consider native provider tools or plugin extensibility
```

## Deferred Decisions

After demonstrated internal adoption, separately consider native provider tools,
explicit sharing of a user-created tab, read-only plugin access, plugin toolbar
contributions, isolated evaluation behind explicit permission, and persisted
target recovery.

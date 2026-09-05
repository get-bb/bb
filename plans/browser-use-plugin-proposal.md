# Browser use in BB: proposal

Milestones 1–3 implemented locally; release validation outstanding · September 5, 2026.

The DevBrowser iframe changes were merged in [PR 140](https://github.com/SawyerHood/dev-browser/pull/140) at `7159e8b459fb8c8b496f53e3314175e73e17a332`, with Ubuntu and macOS CI passing. DevBrowser RC.3 is now published from `a25e7672e199153b2f5b52a841a62436a28d925f`, including those fixes. The plugin pins `dev-browser@1.0.0-rc.3` and the four published platform digests. BB now has the production desktop/daemon broker, thread-scoped control leases, the experimental SDK and `bb browser` CLI, native Stop/Take over controls, and a first-party Browser Automation plugin for desktop attachment and headless Chrome on enrolled hosts. These BB changes are local and have not been released.

The established Electron compatibility tests pass with both DevBrowser and agent-browser, including trusted iframe clicks and stale-ref rejection with the modified DevBrowser binary. The additional end-to-end test for tabs created directly through the service now passes after enabling Chromium focus emulation for hidden rendering. It exercises real SDK/CLI HTTP, authenticated daemon-broker WebSockets, the desktop client, and Electron native views. Only server-to-daemon RPC delivery uses the test responder. The full compatibility rerun also passes hidden personal-profile capture after adding bounded native frame requests while a CDP screenshot is pending. Screenshot options are passed through unchanged; neither synthetic DOM input nor foreground reveal is used. The headless runtime smoke passes with actual Chrome, including isolated sessions, cancellation, timeout, and attached-browser preservation. The public app, SDK, CLI, daemon, and contract checks are green. The full app suite passed 3,888 tests (four skipped), CLI 533, SDK 102, and the plugin 34. The isolated broker tests use migrated in-memory SQLite. The Plugin Guide entry was built and inspected in the running app.

A full dev instance on the MacBook Pro also verified automatic RC.3 installation, desktop navigation, snapshots, and screenshots through the actual server, daemon, and native browser. Acquiring control opens and focuses the first selected tab; new pages created through its CDP connection are revealed automatically. Both automatic reveal flows were checked on that Mac without a manual reveal call.

Current scope is milestones **1–3** below. Screenshot cards and the sidebar viewer remain milestone 4. Cloud browsers are deferred entirely. Automatic installation now uses npm in private storage on the selected browser host, with pinned release-binary checksums. Clean installs and real Chrome workflows have passed on Linux x64 and macOS ARM64; Linux ARM64 and macOS x64 artifacts are published and pinned but have not been executed in this integration. Windows remains unsupported.

## The recommendation

Build **one first-party Browser Automation plugin, backed by a small public BB API for controlling the desktop browser**. The plugin provides the complete experience: browser scripts, persistent pages, desktop and headless sessions, screenshots in chat, and a sidebar viewer.

Keep three responsibilities separate:

| Piece                                         | Owns                                                                                                   | Why it belongs here                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **BB browser API**                            | Access to embedded desktop tabs, their lifetime, control ownership, and a scoped automation connection | Every browser integration needs the same access to BB-owned tabs.        |
| **Browser Automation plugin**                 | Agent tools, CLI, scripts, snapshots, session management, browser selection, previews                  | Users can replace or modify how agents use browsers without changing BB. |
| **Browser execution modes inside the plugin** | Built-in desktop attachment and headless Chrome on an enrolled host                                    | Launch and attachment belong inside the first-party plugin.              |

The first-party plugin must use the same public desktop API as third-party plugins. Disabling it leaves the ordinary built-in browser working.

Use **one scoped CDP-over-WebSocket transport** for both DevBrowser and agent-browser. BB exposes the browser connection; each automation tool owns its commands and page interaction behavior. Sawyer owns DevBrowser, so its API can change directly to support this integration.

Scope clarification: extensibility means letting another automation tool, such as agent-browser, control BB's built-in browser. Cloud browsers are deferred entirely: no provisioning, cloud credentials, provider adapters, or provider live viewers in this release. Headless Chrome on an enrolled host remains in scope, including when that host is remote from the user.

## What the experience looks like

An agent opens a browser session, gets a stable session ID, and runs short DevBrowser scripts against named pages. The same workflow works across these modes:

| Mode                 | Where the browser runs         | What the person sees                                                              |
| -------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| **Built-in browser** | A selected BB desktop instance | The actual tab in BB, with an agent-control indicator and Stop/Take over controls |
| **Headless browser** | A selected enrolled host       | An updating screenshot in chat; a larger screenshot viewer in the sidebar         |

An enrolled host may be remote from the user; it is not a provisioned cloud-browser service. Opening a preview must show the existing session rather than opening its URL in a fresh browser that lacks its cookies and page state.

Suggested defaults: use the built-in browser when the request asks to use it; otherwise use the configured backend. If that backend is unavailable, return an actionable error or an explicit choice. Do not silently switch execution modes or login profiles.

## What exists already

This proposal is grounded in BB commit `cc9e3515ac7af804383f08cb4e2051cce4959f26` and DevBrowser RC2 commit `ff952c7299991b3d5d01f26bdc33cb32c636a15b`.

**DevBrowser:** the initial inspection used `v1.0.0-rc.2`; the plugin now installs published `v1.0.0-rc.3`. It uses Puppeteer/Bun, supports persistent named pages, accessibility snapshots with element references, screenshots, headless launch, and attachment to CDP endpoints. The npm package distributes a CLI binary rather than a supported importable engine API. Start with a pinned binary and its structured output. [Release](https://github.com/SawyerHood/dev-browser/releases/tag/v1.0.0-rc.2), [package manifest](https://github.com/SawyerHood/dev-browser/blob/ff952c7299991b3d5d01f26bdc33cb32c636a15b/package.json), [README](https://github.com/SawyerHood/dev-browser/blob/ff952c7299991b3d5d01f26bdc33cb32c636a15b/README.md).

RC2 already accepts CDP WebSocket URLs through `--connect`; agent-browser accepts them through `--cdp`. Use that shared transport for BB. RC2 also has a raw-CDP Unix socket adapter, but BB does not need to implement that additional transport. Existing Chrome connection support does not establish compatibility with Electron’s individual web contents; that compatibility is the first thing to prove. [DevBrowser CDP adapter](https://github.com/SawyerHood/dev-browser/blob/ff952c7299991b3d5d01f26bdc33cb32c636a15b/src/daemon/sources/cdp.ts), [agent-browser CDP usage](https://github.com/vercel-labs/agent-browser/blob/4a98df79bd232fcde5ca3a4a48e1337b8108b160/README.md#cdp-mode).

**BB:** desktop tabs already use isolated `WebContentsView` instances. The native contract supports navigation, visibility, find, and screenshot events used during resizing. It has no general automation connection. Tabs currently use a shared persistent browser partition, and detaching a view destroys it. [Desktop manager](../apps/desktop/src/desktop-browser-view.ts), [native contract](../packages/desktop-contract/src/browser.ts).

Plugins already have agent tools, CLI commands, typed host workers, host signals, HTTP/RPC, realtime events, inline message directives, and sidebar panels. Use these existing surfaces for most of the plugin. [Backend contracts](../packages/plugin-sdk/src/backend-contract.ts), [host contracts](../packages/plugin-sdk/src/host-contract.ts), [frontend contracts](../packages/plugin-sdk/src/app-contract.ts).

This proposal replaces the core-owned automation direction in the older [BB browser plan](bb-browser.md). Its description of DevBrowser as Playwright-based is outdated for RC2.

## Iframe compatibility: implementation findings

The original failure was an input-readiness race: DevBrowser found the correct element and coordinates, but Chromium accepted the input command before the embedded view was ready to deliver the event. Waiting before the click or capturing the viewport first made the same click succeed. Changing focus or waiting two animation frames did not.

The Electron adapter enables Chromium focus emulation and temporarily disables background throttling while it owns the attachment, restoring the original throttling setting on release. This affects browser rendering without focusing the native window. CDP screenshots request native hidden captures while pending, with one outstanding native capture, a 16 ms interval, and a five-second deadline; the extra images are discarded locally. This keeps Chromium producing frames for otherwise idle hidden views and preserves viewport, crop, and full-page CDP parameters.

The Electron adapter now completes a viewport capture before the first pointer input for an attachment or navigation. The image stays inside the desktop process and is discarded. Concurrent pointer commands share the same pending capture so mouse-down and mouse-up keep their order; navigation or controller replacement invalidates waiting input. A one-pixel crop fixed the simple case but failed with a separate cross-origin renderer, so the barrier covers the viewport. This adds one local capture per navigation, rather than a sleep or a capture per click.

The smoke test runs with site isolation enabled and requires a native iframe CDP attachment. It checks trusted clicks and resulting DOM changes in same-origin, nested, cross-origin, and hidden-thread cases. It never substitutes `element.click()` for mouse input.

DevBrowser commit `2a5c1552492e19e5a1a82901c762c70c2b21b764` on `bb/iframe-snapshot-refs` implements cross-origin snapshot traversal through each child frame’s isolated realm. Frame prefixes now belong to document execution contexts, so a reload or origin swap cannot reuse an old prefix for a replacement document. The full document prefix is retained through asynchronous selectors and locator retries, so a lookup started before navigation cannot resolve the same local element number in a replacement document. Snapshot evaluation also stays bound to the captured execution context; a destroyed context rejects instead of installing an old prefix in the replacement document. Same-document hash/history navigation retains valid refs; unavailable children are labeled `[unavailable]`. Nesting limits and frame-qualified selectors remain supported.

BB’s local-build smoke mode requires trusted cross-origin ref clicks and rejects stale refs after same-URL reloads, origin swaps, frame removal, and parent navigation. It takes fresh snapshots before checking old refs and verifies no click side effect, preventing false passes from ref aliasing or unrelated errors. The native adapter also retries failed readiness captures and cancels input at virtual-session detach even when another session keeps the native child attached.

Validation: BB’s 307 desktop/contract tests and desktop typecheck pass. Both the unmodified-release smoke and the modified-client iframe smoke pass; the final local binary’s SHA256 is `7bf6db777eaba104d8da9b2bd47efb4921f5289b2140be8ce77289b12094a144`. DevBrowser’s frozen install, typecheck, build, and four new iframe tests (33 assertions) pass. Its final full suite passed 342 of 343 tests with an existing page-closure race failure; that test’s owning file passed separately, 21 of 21. The complete DevBrowser suite is therefore not recorded as green.

Those original results used a source integration. The fixes are now published in [DevBrowser RC.3](https://github.com/SawyerHood/dev-browser/releases/tag/v1.0.0-rc.3), which the plugin installs automatically. The default CDP smoke retains unmodified RC2 as its compatibility baseline; pass the installed RC.3 binary through the [local-build smoke option](../docs/debugging-and-qa.md#desktop-browser-cdp-prototype) to exercise iframe-reference acceptance. Linux testing has exercised the real BB server-to-daemon-to-host-worker path. The macOS run executed the installer and Chrome on the Mac directly, so cross-machine BB RPC to macOS remains to be verified.

Puppeteer’s `Frame.goto()` can report a closed target during an out-of-process-to-in-process frame swap; this was reproduced in ordinary Chrome as well as BB. The lifecycle regression navigates via the parent iframe’s `src` and waits for its load event. This existing navigation limitation is separate from snapshot-ref support and does not require weakening web security or changing BB’s transport.

## 1. New public BB APIs

### A desktop browser service

The implemented `experimental_desktopBrowsers` SDK area is available to plugins through `bb.sdk`, with matching `bb browser` core CLI commands. See `bb guide browser` and the Plugin Guide for the shipped contract.

| Operation        | Contract                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listInstances`  | List connected desktop instances on an explicitly selected host, with instance IDs and connection generations.                                          |
| `listTabs`       | List tabs available to the caller in the selected instance and thread.                                                                                  |
| `createTab`      | Create an embedded tab in a server-generated automation profile; select its instance, thread, URL, and presentation.                                    |
| `acquireControl` | Acquire an expiring control lease over specified tabs; return opaque identifiers and capabilities.                                                      |
| `openConnection` | Give an authorized integration a scoped CDP WebSocket endpoint on the browser’s host, with connection credentials and expiry tied to its control lease. |
| `revealTab`      | Ask the owning renderer to show the native tab without recreating it.                                                                                   |
| `captureTab`     | Capture a bounded JPEG with pixel dimensions, usable by integrations that do not use DevBrowser.                                                        |
| `releaseControl` | Cancel outstanding control work and detach automation while leaving user-owned tabs open.                                                               |
| `closeTab`       | Explicitly close a tab the caller is authorized to close.                                                                                               |
| `subscribe`      | Poll changed tab/control snapshots every two seconds; report failures through onError. This is not a lossless event stream.                             |

Use explicit desktop-instance IDs; the host running an agent may be a Linux machine while its browser is on a Mac. Multiple windows or desktop connections cannot be resolved by “whichever is active.”

Track stable `tabId`, owning instance, thread, creator, profile, and current lease. Include a connection generation so commands queued before a reconnect cannot run against a replacement tab. Leases expire, are revoked on Stop, and are invalidated when the owning desktop exits.

Keep CDP-specific freeform JSON at the protocol boundary. Parse envelopes, bound messages, and pass typed IDs and lifecycle state internally. Defaults are resolved once by the server.

### A scoped CDP bridge

CDP is Chrome’s browser-control protocol. Plugins should be able to connect an automation library to BB without reimplementing selectors, accessibility traversal, and clicking in BB core.

Electron exposes CDP commands and events through `webContents.debugger`. BB must bridge those to standard CDP WebSocket messages, including browser-level target management. DevBrowser and agent-browser connect through their existing WebSocket clients. [Electron debugger](https://www.electronjs.org/docs/latest/api/debugger), [Puppeteer connection options](https://pptr.dev/api/puppeteer.connectoptions).

The bridge must:

- Present only the granted tabs and their permitted child targets. Exclude BB’s trusted app renderer and unrelated tabs.
- Implement the browser/target discovery and attach operations both Puppeteer and agent-browser need; map page sessions to the correct native web contents.
- Route target creation, activation, and closing through BB’s tab lifecycle. Define popup and cross-origin iframe handling explicitly.
- Reject unsupported browser-wide operations. An attached client must never close the Electron application through `Browser.close`.
- Handle debugger detach, navigation, tab closure, and instance loss with bounded failures. Opening DevTools can detach Electron’s debugger connection.

Do not expose Electron’s global remote-debugging port. A WebSocket endpoint alone is not a scoping mechanism: the bridge must enforce target and operation scope itself.

Expose a lease-scoped CDP WebSocket endpoint bound to loopback on the desktop host. This is the single public automation transport for both tools; there is no separate DevBrowser transport to implement or maintain. Require a short-lived connection credential, reject unauthorized WebSocket upgrades, and revoke existing connections when the lease ends. Do not publish this endpoint through public port sharing. Publish the tested CDP subset and compatibility matrix; do not promise universal automation-library compatibility before testing it.

Both workers consume the same connection format. Illustrative invocations, using an endpoint supplied privately by the owning plugin:

```sh
dev-browser --connect "$BB_SCOPED_CDP_URL" -e 'await browser.listPages()'
agent-browser --cdp "$BB_SCOPED_CDP_URL" snapshot
```

Each controller receives its own lease and credential; the common transport does not imply concurrent control of the same tab. Sharing the transport also does not unify the tools' command APIs or snapshot references.

### Process responsibilities

```text
Agent on any host → BB CLI/tool → server plugin
                                  ↓ authorized request
                            plugin host worker
                                  ↓ automation tool + CDP WebSocket
                            desktop main → native tab

Desktop renderer ← BB tab presentation and state updates
```

The **server** chooses policy, checks ownership, and issues control grants. The **host daemon** routes host-local work and manages the plugin worker. **Desktop main** owns native tabs and their CDP bridge. The **renderer** owns panel placement and user controls.

For desktop sessions, run the automation tool on the desktop host even when the agent works elsewhere. This avoids sending every CDP protocol round trip across the network. Introduce a generic core desktop broker between the host daemon and desktop main; third-party plugins use that same broker. Do not depend on a foreground renderer to carry automation traffic.

A remote CDP relay for integrations that must execute elsewhere can follow later. The first release still supports remote agents through the server and CLI. Workspace files remain on their actual host: upload/download transfer must be explicit, not inferred from matching path strings.

### Control and profile semantics

New automation sessions should use a dedicated profile by default. Using an existing logged-in personal tab is an explicit handoff, with the control state visible and revocable. Attaching and releasing must preserve its login and leave it open.

Tab scoping does not isolate cookies in a shared profile. The current shared `persist:bb-browser` partition means a grant to a personal tab carries that profile’s authenticated browsing authority. Do not describe it as isolated access to one website. Separate automation profiles require a desktop manager change.

Allow one controlling integration per tab at a time; observers can share preview frames. Stop/Take over revokes automation immediately. Changing sidebar tabs or hiding a preview must not destroy the browser. Closing a native tab does end that target.

## 2. The first-party Browser Automation plugin

Ship it as an ordinary plugin with server, host, frontend, and skill entries:

| Part        | Responsibilities                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Server      | Session records, configured defaults, tools and CLI, desktop/headless selection, cleanup policy           |
| Host worker | Pinned DevBrowser runtime, structured script execution, local launch or desktop attachment, image capture |
| Frontend    | Inline screenshot card, sidebar session viewer, mode/status labels, Stop/Take over actions                |
| Skill       | Teach agents to inspect, act, and verify using persistent pages and the session ID                        |

Use RC2 as the inspected starting point and make needed integration changes directly in DevBrowser. Sawyer owns its API, so connection authentication, cancellation, session lifecycle, structured output, and an embedding API can evolve where implementation shows a need. Keep the BB-facing transport standard CDP over WebSocket so agent-browser can continue to use it independently.

Pin the resulting DevBrowser version and artifact checksum, preserve the license, and isolate its state under plugin-owned storage using `DEV_BROWSER_HOME`. Use a per-session runtime boundary so a stuck script or a stop request cannot terminate another thread’s browser work. RC2 explicitly treats script execution as trusted code rather than a security sandbox. [Runtime state paths](https://github.com/SawyerHood/dev-browser/blob/ff952c7299991b3d5d01f26bdc33cb32c636a15b/src/shared/paths.ts), [runtime implementation](https://github.com/SawyerHood/dev-browser/blob/ff952c7299991b3d5d01f26bdc33cb32c636a15b/src/daemon/run.ts).

A fork or vendored copy is not required by this design. Keep reusable integration changes in DevBrowser and consume a pinned release from the BB plugin. The inspected release binary supports macOS and glibc Linux; Windows support remains a separate packaging/runtime task. [Supported platforms](https://github.com/SawyerHood/dev-browser/blob/ff952c7299991b3d5d01f26bdc33cb32c636a15b/README.md).

Expose `open`, `list`, `run`, `pages`, `screenshot`, `stop`, and `close` through plugin RPC, CLI, and agent tools. Use the same handlers and validated results for all three. Keep the core desktop primitives discoverable separately from the DevBrowser-specific script commands.

Implemented CLI usage:

```sh
bb browser-automation open --backend desktop --machine <desktop-host-id> --desktop <instance-id> --json
bb browser-automation open --backend local --headless --machine <host-id> --json
bb browser-automation run <session-id> --script-file ./check.js --script-host <source-host-id> --json
bb browser-automation screenshot <session-id> --page main --json
bb browser-automation stop <session-id>
bb browser-automation close <session-id>
```

`stop` cancels current work; `close` releases the session and disposes browsers it owns. Neither should close a user-owned browser merely because DevBrowser attached to it. Serialize script runs per session in the initial release to avoid interleaved actions.

### Two initial execution modes

1. **Desktop:** acquire the public BB control connection and attach DevBrowser to its CDP WebSocket endpoint.
2. **Headless Chrome:** launch Chrome on a selected enrolled host, with a persistent session profile and idle cleanup.

Record session ownership and expiry. If launch succeeds but connection fails, clean up the newly created browser. Reconcile owned sessions after crashes and enforce idle/absolute expiry. Closing a session disposes its owned browser; releasing a user-owned desktop tab leaves it open.

The browser’s network is the one that loads the website. `localhost` refers to the browser’s host, which may differ from the agent’s host. Transfer files or share preview URLs explicitly. Profiles remain mode-specific; changing modes creates a different session and does not migrate login state.

Cloud provisioning, cloud credentials, provider live viewers, and arbitrary external CDP attachment are deferred. The scoped desktop CDP connection remains the public integration transport.

## 3. Screenshots in chat and the sidebar

Reuse `app.slots.messageDirective`, `app.slots.threadPanelAction`, and `useBbNavigate().openThreadPanel`. A directive such as `::dev-browser{session="…"}` contains only an opaque session ID. The plugin validates it against the containing thread before returning session information or images.

The inline card shows the latest image, page title, backend, active/stopped state, and “updated 3 seconds ago.” Clicking opens the same session in the sidebar with a larger image and a page picker. Desktop sessions also offer **Show native tab**.

Screenshot delivery should be inexpensive by default:

- Capture after meaningful script completion and on explicit screenshot requests. While work is active and someone is watching, target one preview frame every 2 seconds; tune this after measurement.
- Start around a 960-pixel longest edge and moderate JPEG quality. Capture a larger frame on demand in the sidebar. Preview capture must not activate a different page or steal keyboard focus.
- Keep one capture and one pending frame per watched page. Slow consumers receive the latest frame; discard superseded frames instead of building a queue.
- Reduce cadence/quality under backpressure, deduplicate identical images, and stop periodic capture when nobody is watching. A final requested verification image can still be saved.
- Publish small realtime metadata with sequence number, capture time, dimensions, and an opaque image reference. Fetch image bytes through an authenticated route; do not stream base64 image data through chat history.
- Keep the last image during disconnects and label it stale. On reconnect, fetch current state rather than replaying missed frames.

RC2’s structured image events refer to local files, so the plugin must validate that those files are inside its capture directory and serve or transfer the bytes from the owning host. Existing `bb.sdk.files.createPreview` is useful for bounded host-backed assets; the session route still needs thread authorization and URL renewal. Never put absolute host paths or CDP credentials in message directives. [Image output contract](https://github.com/SawyerHood/dev-browser/blob/ff952c7299991b3d5d01f26bdc33cb32c636a15b/src/shared/protocol.ts).

Periodic preview capture is plugin work; RC2’s `page.shot()` event does not itself provide continuous observation. For desktop sessions, use the public `captureTab` operation without taking a second debugger attachment. For headless sessions, use a passive capture connection managed by the worker where supported. Do not inject screenshot scripts into a running user script or its command queue.

Keep live frames ephemeral, with a bounded rolling cache. Store selected final screenshots as durable thread artifacts. On a finished session, its card should show the saved final frame and completion state. A preview image is not automatically model input; agent-requested verification screenshots should also return an image/tool artifact the model can inspect.

A 60 KB frame every 2 seconds would use about 30 KB/s per viewer before overhead; actual image sizes and throughput need measurement. This is a design budget, not a benchmark.

**Live video is deferred.** Screenshot viewers are observational. Desktop takeover uses the actual native tab; interactive control through a headless preview would require a separately scoped input implementation.

## How others extend it

The extension point is the desktop browser connection. Another plugin can replace DevBrowser’s commands, scripting, prompting, or computer-use behavior while controlling the same BB-owned tabs. Cloud provisioning and external backend registration are outside this release.

### Concrete example: an agent-browser plugin

agent-browser already accepts a browser CDP WebSocket URL through `--cdp`. Its normal connection path discovers targets and attaches to them; therefore the BB bridge must support its browser-level protocol requirements as well as Puppeteer's. Inspection here used commit `4a98df79bd232fcde5ca3a4a48e1337b8108b160`. Both pinned clients have now passed real Electron bridge tests; the independently packaged agent-browser example plugin still needs to be built. [Connection implementation](https://github.com/vercel-labs/agent-browser/blob/4a98df79bd232fcde5ca3a4a48e1337b8108b160/cli/src/native/browser.rs), [CDP usage](https://github.com/vercel-labs/agent-browser/blob/4a98df79bd232fcde5ca3a4a48e1337b8108b160/README.md#cdp-mode).

The plugin would:

1. Ask BB to create a tab or acquire control of a selected existing tab.
2. Obtain the scoped WebSocket connection through `experimental_desktopBrowsers.openConnection`.
3. Start agent-browser on that desktop host, with a separate agent-browser session for each BB control session and strict tab pinning enabled.
4. Expose its own BB CLI commands, agent tools, and skill, forwarding actions to agent-browser.
5. Use BB's native tab presentation and `captureTab` for previews, with existing plugin message/sidebar slots for its UI.
6. Disconnect and release the BB lease on Stop, disable, or session completion. Preserve a user-owned tab.

For example, these are illustrative worker commands after BB has supplied the scoped endpoint. The endpoint and its credential are supplied privately by the plugin, not pasted into the agent transcript:

```sh
agent-browser --session bb-example --cdp "$BB_SCOPED_CDP_URL" --pin-tab snapshot -i
agent-browser --session bb-example click @e2
agent-browser --session bb-example fill @e3 "example text"
agent-browser --session bb-example screenshot
```

Element references come from the latest agent-browser snapshot. DevBrowser's reference map and agent-browser's reference map are separate. Switching tools releases one controller, acquires the other, and takes a fresh snapshot; the actual tab and its login remain in place. Start with one granted page per connection so the tool cannot select an unrelated tab. Tab pinning improves failure behavior but does not replace BB's target restrictions.

```text
Browser Automation plugin ─────┐
                      ├── BB CDP WebSocket bridge ── built-in tab
agent-browser plugin ─┘
```

Both plugins may be installed. Only the selected integration should contribute browser instructions/tools for a given thread, and only one integration controls a particular tab at a time. The agent-browser plugin must work with Browser Automation disabled.

The first-party plugin also supplies headless Chrome on enrolled hosts. An agent-browser plugin's initial supported scope is the built-in browser.

Make this agent-browser example part of desktop API validation: connect, inspect, click, fill, screenshot, and disconnect against the real embedded tab. Test denied targets and tab closure too. This replaces the vague future requirement for an independent example integration.

## Delivery plan

| Milestone                                                  | Deliverable                                                                                       | Completion evidence                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Prove the Electron connection**                       | One scoped CDP WebSocket bridge driven by pinned DevBrowser and agent-browser builds              | Both tools connect through the same transport; real Electron navigation, snapshot/ref click, typing, screenshots, two tabs, popup/iframe handling, close and reconnect work; trusted BB renderer remains inaccessible |
| **2. Ship the public desktop API**                         | Instance discovery, tabs, control leases, capture, transport, native control UI, SDK and core CLI | A remote agent controls a selected desktop; Stop revokes control; the agent-browser example plugin works without Browser Automation installed                                                                         |
| **3. Ship Browser Automation with local headless support** | Plugin packaging, tools/CLI/RPC, session runtime isolation, desktop and headless backends         | The same script workflow works in both modes; timeout and plugin reload do not damage another session                                                                                                                 |
| **4. Ship previews**                                       | Screenshot cards, sidebar viewer, authenticated image delivery, bounded capture and storage       | Desktop and headless previews work in BB’s web client; slow/disconnected viewers stay bounded; session completion preserves a final image                                                                             |
| **5. Expand after the first release**                      | Broader automation-tool compatibility; separately scoped cloud/live-view work only if requested   | Additional tools use the same desktop API; capabilities accurately describe support                                                                                                                                   |

The current implementation request covers milestones 1–3. Milestone 4 remains a follow-up. Broader popup compatibility, real multi-host desktop validation, and multi-platform runtime packaging remain release acceptance work. Implement reusable DevBrowser API changes directly in its repository, pin the resulting build, and rerun the shared bridge compatibility checks.

Tests should focus on cross-thread/tab access, shared-profile semantics, stale connection generations, DevTools detach, window/host loss, hidden-view persistence, cancellation, session cleanup, and slow preview consumers. Use actual Electron/Chrome for compatibility checks with both tools; existing Chrome connection tests alone are insufficient. Use in-memory SQLite for persistence tests, and Turbo for repository builds, typechecks, and tests.

Every new public API starts with `experimental_`, receives an entry in `docs/api_to_audit.md`, and gets a Plugin Guide card in `packages/plugin-api-map/src/surfaces.ts`. Ship SDK and CLI access alongside UI behavior, updating CLI help, guide templates, skills, and configuration documentation. Changes to the host-daemon wire contract require a `HOST_DAEMON_PROTOCOL_VERSION` bump.

## Suggested decisions to adopt

- One first-party Browser Automation plugin; public desktop control primitives in BB core.
- One scoped CDP-over-WebSocket transport shared by DevBrowser and agent-browser, validated with both from the first milestone.
- Make needed API changes directly in DevBrowser and consume a pinned release from the BB plugin.
- Built-in desktop and headless Chrome on enrolled hosts in the first release. Cloud browsers are deferred.
- Separate automation profiles by default; explicit handoff for existing personal tabs.
- Screenshot previews for desktop and headless sessions. Live video is deferred.
- Publish desktop integration APIs with agent-browser as the independent example. Omit cloud provisioning and external backend registration.

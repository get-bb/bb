---
kind: instruction
title: bb Browser Guide
summary: Inspecting and controlling explicitly selected visible Browser tabs.
intent: Help agents control the native BB Browser without silently choosing a user tab or starting another browser.
editingNotes: Keep target flags and action JSON aligned with apps/cli/src/commands/browser.ts and packages/domain/src/browser-control.ts.
---
Browser commands

Use `bb browser list --json` before every Browser action. The result contains
foreground and background thread owners plus every persisted Browser tab. A
tab with `connected: true` supplies an actionable `clientId`, `windowId`,
`tabId`, and `navigationEpoch`; an inactive tab has `connected: false` and must
first be activated through its owner. `open --thread` creates a thread-owned
Browser in the background when its panel is unmounted, without changing the
visible app layout, and waits for the committed native page revision. It never
falls back to a different thread.

  bb browser list [--thread <thread-id>] [--project <project-id>] [--active] --json
  bb browser open --thread <thread-id> --url <url> [--client <client-id>] [--window <window-id>] [--owner <owner-id>] --json
  bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> --action <json> [--timeout <seconds>] --json
  bb browser wait --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> (--locator <json> | --text <text> | --url <url> | --navigation <start|commit> | --load-state <state> | --popup | --request <url> | --response <url> | --download-blocked) [--match <exact|glob>] [--timeout <seconds>] --json
  bb browser batch --items <json> [--concurrency <1-4>] [--timeout <seconds>] --json

Actions cover snapshots; CSS, accessibility, shadow-root, and nested or
cross-origin frame locators; left/right/middle click, hover, double-click, and
drag; type, upload, select and multiple-select, check, focus, keyboard input,
scrolling, and wait; navigation, history, reload, tab lifecycle, and viewport
profiles; viewport, full-page, and element screenshots; dialog and permission
policy; page storage; native/page/network/download diagnostics;
and bounded scripts. Plugin-owned workflows (such as page annotations) are
invoked through the `bb browser plugin` contribution command and exported
through the plugin's own commands rather than core actions.

`bb browser capture` captures an exact tab revision. Choose `--out <path>` to
stream validated chunks to a local file and release the resource, or `--json`
to print a live canonical descriptor without downloading. These options are
mutually exclusive. Use the target flags from `bb browser list`.
The descriptor is `{ captureId, mimeType, pixelSize, byteLength, target,
expiresAt }`; its bytes are immutable and can be read after navigation.
Creation rejects a stale navigation epoch.
Save the `--json` output and download it with `bb browser capture-download
--descriptor <json-file> --out <path>`. The destination is on the machine
running the CLI, not the server or Browser host. Download releases the resource,
so the descriptor cannot be reused afterward. Valid reads refresh its two-minute
idle lease, subject to an absolute ten-minute lifetime.

Plugin-owned Browser workflows use
`app.slots.experimental_browserController` and
`bb.experimental_browser.experimental_requestContribution`; `bb browser plugin`
sends its JSON input to that controller's
`experimental_registerRequestHandler` for the exact target. Controller lifecycle
members are `experimental_browserControlAvailable`,
`experimental_lifecycleSignal`, and `experimental_onLifecycle`.
`experimental_capturePage` returns `{ url, navigationEpoch, pixelSize,
dispose() }`, where `url` is a Blob URL that the controller explicitly
disposes. `experimental_createImageResource({ blob, pixelSize? }, { signal? })`
registers a plugin-generated image for the controller's current exact target
and returns the same bounded descriptor shape. Public
schema exports from `@get-bb/plugin-sdk/browser` are
`experimental_browserCaptureDescriptorSchema`,
`experimental_browserFrameTargetSchema`, `experimental_browserPageLocatorSchema`,
and `experimental_browserTabTargetSchema`.

  bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> --action '{"kind":"snapshot","mode":"interactive"}' --json
  bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> --action '{"kind":"click","target":{"target":"locator","locator":{"role":"button","name":"Save"}}}' --json
  bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> --action '{"kind":"screenshot-full-page"}' --json
  bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> --action '{"kind":"set-dialog-handler","behavior":"accept","promptText":"approved"}' --json
  bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> --action '{"kind":"diagnostics"}' --json
  bb browser capture --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> --out <path> [--mode viewport|full-page|element] [--format png|jpeg] [--quality <1-100>] [--locator <json>] --json
  bb browser capture-download --descriptor <json-file> --out <path> --json
  bb browser plugin --plugin <plugin-id> --controller <controller-id> --client <client-id> --window <window-id> --tab <tab-id> --epoch <epoch> --input <json> [--timeout <seconds>] --json

Use interactive snapshots to derive locators. CSS locators use
`{"selectors":["button"]}`; shadow roots use multiple selectors. Discover
cross-origin or nested frames with `list-frames`, then put the returned
`{"frameId":"...","documentEpoch":...}` on the locator. Accessibility locators
use `{"role":"button","name":"Save"}`. Prefer locators over coordinates.

`type` with `{ "text": "", "clear": true }` is the canonical clear operation.
`upload` carries bounded base64 file content rather than a machine-local path.
`set-dialog-handler` applies once to the next JavaScript dialog. Permission
changes remain scoped to the requesting origin of the selected native tab and
reset on navigation. Downloads stay blocked and are reported by `diagnostics`. Native browser-profile cookie import is explicit:
run `list-cookie-import-sources`, then `import-cookies-from-browser` with the
returned family and profile ID. Clearing imported cookies requires
`{"kind":"clear-imported-cookies","confirm":true}` and affects the shared
managed Browser partition.

`open-tab` creates a foreground visible tab in the source tab's panel owner.
`close-tab` closes only the selected revision. Navigation rejects unsupported
schemes before dispatch. All actions reject stale revisions rather than
retargeting another client, window, tab, or page.

---
name: browser-automation
description: Use the Browser Automation BB plugin to inspect and automate persistent browser pages in an explicit desktop or local headless session. Use for browser navigation, snapshots, clicking, forms, and verification screenshots.
---

Use the `browser_automation_*` tools or `bb browser-automation`. Open one session, retain its
session ID, then inspect, act, and verify in short scripts. Native screenshot
tools return images the model can inspect.

Choose `selection: {backend:"local",hostId}` for headless Chrome on an enrolled
host. Choose `{backend:"desktop",hostId,instanceId}` for a new dedicated desktop
automation tab. Starting desktop control opens and focuses the browser panel;
new pages created through that controller are selected automatically. Headless
sessions remain headless. Resolve the explicit instance with the public desktop-browser
SDK/CLI first. Never silently choose a different host, mode, or login profile.
Adding `tabId` hands off an existing tab and its profile's logged-in authority;
do so only when the user asked to use that tab. All tool inputs use the current
thread ID. Each session belongs to that thread.

CLI opening:

```sh
bb browser-automation open --backend local --headless --machine <host-id> --json
bb browser-automation open --backend desktop --machine <host-id> --desktop <instance-id> --json
```

Run scripts with `browser_automation_run` or:

```sh
bb browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.goto("https://example.com"); await p.snapshot()' --json
bb browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.click("ref/e6"); await p.snapshot()' --json
bb browser-automation screenshot <session-id> --page main --json
```

Take a fresh snapshot before using refs after navigation or document changes.
Use refs from that session's DevBrowser snapshot. Do not mix agent-browser refs
or invent selectors. Prefer a cheap URL/text/snapshot check after each action;
request a screenshot when visual verification matters. Use
`await p.shot({type:"jpeg",maxEdge:960,quality:70}); undefined` inside scripts to
return a bounded image without printing its host path.

`pages` lists persistent pages. Runs serialize within a session. Scripts are
trusted JavaScript with Puppeteer-style DevBrowser APIs, not a sandbox.
`--script-file` requires `--script-host <host-id>` naming the source host explicitly. Browser file
operations and `localhost` refer to the browser host. Transfer files explicitly.

Stop cancels running and queued work and releases desktop control. Cancellation
and timeout stop the session too; open a new session to resume. Close disposes
owned Chrome and plugin-created desktop tabs while preserving handed-off tabs.
Close sessions after use. Five-minute idle and thirty-minute absolute expiry
apply. Timeouts default to 30 seconds, maximum 120 seconds.

An unavailable backend or a failed runtime install is an actionable setup
error, not permission to attach to a random browser. The first open on a host
installs the pinned `dev-browser` npm release into plugin-owned host storage
there and verifies its provenance and digest; it needs npm, network access, and
Chrome on that host, and can take a minute. Later opens reuse the verified
install offline. The exact pin and Chrome setup are documented in the plugin
README. Cloud browsers and arbitrary CDP endpoints are unsupported.

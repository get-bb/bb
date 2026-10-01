# Reviewer demo server

This Worker serves the current bb web app and fixed sample conversations for
Google Play and App Store review. The native mobile app opens the server root
in a WebView, so an API-only deployment cannot load it.

The demo contains no credentials, production data, inference, host daemon, or
agent runtime. API and WebSocket requests retain their per-client Durable
Object, keyed by Cloudflare's `cf-connecting-ip`. Unsupported actions return
JSON errors. Keep the Worker on its own workers.dev origin; a proxy that replaces
client addresses would collapse the isolated fixture worlds.

The build copies the web app and only the Navigation and Thread list plugins'
browser JavaScript and CSS. The existing plugin preparation tasks compile their
artifacts; no plugin server or host code is shipped or executed by this Worker.
The generated plugin catalog advertises those frontends, and fixture RPC supplies
the thread list's default preferences. Automatic web sidebar preference writes
are validated and kept inside each client's fixture world. Precompressed `.br` and `.gz` copies are
excluded because Workers Assets handles compression.

## Build and verify

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build typecheck test --filter=@bb/demo-server
pnpm --filter @bb/demo-server exec wrangler dev --local --port 41998
```

The Worker tests start an isolated local Wrangler instance and check real shell
and plugin assets, deep-link navigation, current fixture contracts, and rejection
of unsupported API/mutation requests. They never call inference or a real server.

For Android, run `adb reverse tcp:41998 tcp:41998`, then connect the app using
Direct URL `http://127.0.0.1:41998`. iOS Simulator can use that URL directly.
Start with no saved servers, open a sample conversation, and verify its content.

## Deploy and reviewer instructions

The `Deploy Demo Server` workflow deploys main when the demo, web app, workspace
packages, plugins, or shared build inputs change. It also supports manual dispatch.
For a manual deployment, build and verify first, then run:

```sh
pnpm --filter @bb/demo-server exec wrangler deploy
```

After deployment, check `/health`, `/`, and a sample thread deep link, then repeat
a fresh Android Direct URL connection against the public URL. Use the actual
Play testing build for the final submission rehearsal.

Copy this into Google Play app access instructions or App Store review notes:

```text
bb is a client for a bb server that a developer runs on their own computer.
For review, use our demo server. It serves sample conversations and scripted
replies and does not run a real coding agent. No sign-in, credentials, pairing
code, or subscription is needed.

1. Open the app. It shows "Connect to a bb server".
2. In "Server URL", enter https://bb-demo-server.sawyer-7bb.workers.dev
   Leave the optional label empty.
3. Tap "Connect". The web app loads and shows sample conversations.
4. Open "Add a dark mode toggle" to read the sample messages and code.
   You can also browse "Fix the flaky checkout test" and
   "Speed up the search index".
```

# bb-plugin-slack-bot

The headless "Slack bot" hero plugin — no frontend entry, no dependencies.
Mention the bot in Slack and it spawns a BB thread in your configured project;
when the thread goes idle, the agent's last message is posted back into the
Slack thread.

What it demonstrates:

- **Settings** — `botToken` and `signingSecret` as `secret: true` (stored in
  0600 files, never sent to the frontend), a plain string `channelId`, and a
  `project` picker (stores the BB project id).
- **`bb.http.route("POST", "/events", ..., { auth: "none" })`** — a Slack
  Events API webhook. `auth: "none"` is safe here because the handler
  verifies Slack's `x-slack-signature` (HMAC-SHA256 of
  `v0:<timestamp>:<raw body>` with the signing secret, with a 5-minute replay
  window) before touching any event.
- **`bb.sdk.threads.spawn`** — project-default environment; BB fills in
  `origin: "plugin"` and `originPluginId: "slack-bot"` automatically, so
  spawned threads are attributed in the thread list.
- **`bb.storage.kv`** — maps Slack `thread_ts` → BB thread id (and back), so
  follow-up mentions land in the same BB thread.
- **`bb.on("thread.idle")`** — posts `lastAssistantText` to Slack via
  `chat.postMessage`.
- **`bb.status.needsConfiguration`** — the plugin loads without tokens and
  reports "needs configuration" instead of crash-looping.

Socket Mode is intentionally out of scope: it needs a WebSocket client
dependency (e.g. `@slack/socket-mode`). The commented stub in `server.ts`
shows where it would go; webhook mode covers the same flow.

## Setup

1. Install the plugin (requires the "Plugins" experiment):

   ```
   bb plugin install ./examples/plugins/slack-bot
   ```

2. Create a Slack app (https://api.slack.com/apps → "From scratch"):
   - **OAuth & Permissions**: add the `app_mentions:read` and `chat:write`
     bot scopes, install to your workspace, copy the **Bot User OAuth Token**
     (`xoxb-...`).
   - **Basic Information**: copy the **Signing Secret**.
   - **Event Subscriptions**: enable, subscribe to the `app_mention` bot
     event, and set the request URL to

     ```
     https://<your-bb-server>/api/v1/plugins/slack-bot/http/events
     ```

     Slack must be able to reach your BB server (use a tunnel such as
     `cloudflared` or `ngrok` for a local server). Slack sends a
     `url_verification` challenge when you save the URL; the plugin answers
     it automatically once configured.

3. Configure and reload:

   ```
   bb plugin config slack-bot set botToken xoxb-...
   bb plugin config slack-bot set signingSecret ...
   bb plugin config slack-bot set project proj_...
   bb plugin reload slack-bot
   bb plugin list        # slack-bot should show "running"
   ```

4. Mention the bot in a channel it has been invited to. `bb plugin logs
   slack-bot` shows what it is doing.

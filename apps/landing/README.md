# @bb/landing

The bb marketing landing page (bb.dev-style static site). A TanStack Start app
where every route is prerendered at build time — the output is plain static
HTML/assets, deployable to any static host.

## Develop

```bash
pnpm --filter @bb/landing dev
```

## Build

```bash
pnpm exec turbo run build --filter=@bb/landing
```

The deployable static site lands in `apps/landing/dist/client/`.

## Deploy

The site is prerendered to static assets, but a thin Worker (`src/worker.ts`)
runs first for two first-party paths: the `/download/macos` redirect and the
`/api/subscribe` email-signup endpoint (see `run_worker_first` in
`wrangler.jsonc`). Everything else is served straight from `dist/client`. Live
at <https://getbb.app> (and <https://bb-landing.sawyer-7bb.workers.dev>). Pushes
to `main` touching `apps/landing/**` auto-deploy via
`.github/workflows/deploy-landing.yml`.

```bash
pnpm exec turbo run build --filter=@bb/landing
pnpm --filter @bb/landing run deploy
```

Requires a wrangler login with workers write access (`wrangler login`).

## Email signup

The footer signup field POSTs `{ email }` to `/api/subscribe`. The Worker adds
the address to a Resend audience (`POST /audiences/{id}/contacts`) so Resend
owns unsubscribe and preference state. Configuration:

- `RESEND_AUDIENCE_ID` — the target audience ("bb users"), a plain `var` in
  `wrangler.jsonc` (not secret).
- `RESEND_API_KEY` — Worker secret. The deploy workflow syncs it from the
  `RESEND_API_KEY` GitHub Actions secret; set that once with workers write
  access. Without both set, `/api/subscribe` returns `503 not configured`
  (forks and local dev ship signup disabled).

## Analytics

PostHog, explicit events only (autocapture off). Client analytics are disabled
entirely unless `VITE_POSTHOG_KEY` is set at build time; `VITE_POSTHOG_HOST`
overrides the ingestion host (default `https://us.i.posthog.com`).

Download CTAs point at the first-party `/download/macos` Worker redirect. The
Worker sends the download click event server-side with the runtime
`LANDING_POSTHOG_KEY` secret, resolves the current `.dmg` asset from the
`desktop-version.json` release feed, then returns a non-cacheable 302 to that
installer. If the feed cannot be resolved, the Worker falls back to the GitHub
release page. This keeps download click counting working when client-side
analytics is blocked, while the download still succeeds if server-side tracking
is unavailable.

| Event | Trigger | Properties |
| --- | --- | --- |
| `$pageview` / `$pageleave` | page load / unload | UTM params + referrer, captured automatically |
| `landing_download_macos_clicked` | `/download/macos` redirect Worker | `placement`: nav / hero / closer / footer / direct, `download_target`, UTM params when available |
| `landing_github_clicked` | GitHub links | `placement` |
| `landing_cli_command_copied` | Copy button on the install command | `placement`, `command` |
| `landing_email_subscribed` | Email signup submitted successfully | `placement` |

These pair with the app-side `app_started` / `thread_created` /
`user_message_sent` telemetry events (see
`apps/server/src/services/system/telemetry.ts`) to form the ad → page view →
download/CLI copy → app start → first thread/message funnel. Web→app identity
does not join across the download; funnel analysis is aggregate, broken down by
`utm_campaign`.

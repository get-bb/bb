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

The site ships as a Cloudflare Workers assets-only deploy (no server runtime —
see `wrangler.jsonc`), live at <https://getbb.app> (and
<https://bb-landing.sawyer-7bb.workers.dev>). Pushes to `main` touching
`apps/landing/**` auto-deploy via `.github/workflows/deploy-landing.yml`.

```bash
pnpm exec turbo run build --filter=@bb/landing
pnpm --filter @bb/landing deploy
```

Requires a wrangler login with workers write access (`wrangler login`).

## Analytics

PostHog, explicit events only (autocapture off). Disabled entirely unless
`VITE_POSTHOG_KEY` is set at build time; `VITE_POSTHOG_HOST` overrides the
ingestion host (default `https://us.i.posthog.com`).

| Event | Trigger | Properties |
| --- | --- | --- |
| `$pageview` / `$pageleave` | page load / unload | UTM params + referrer, captured automatically |
| `landing_download_macos_clicked` | Download buttons | `placement`: nav / hero / closer / footer |
| `landing_github_clicked` | GitHub links | `placement` |
| `landing_cli_command_copied` | Copy button on the install command | `placement`, `command` |

These pair with the app-side `app_started` / `thread_created` telemetry events
(see `apps/server/src/services/system/telemetry.ts`) to form the ad → page view
→ download/CLI copy → app start → first thread funnel. Web→app identity does
not join across the download; funnel analysis is aggregate, broken down by
`utm_campaign`.

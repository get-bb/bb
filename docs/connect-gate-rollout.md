# Rolling out the bb connect gate

The gate (`apps/connect`, worker `bb-connect` on `*.getbb.app`) carries every
remote session. Merging a gate change only uploads a version; someone deploys
it by hand, following this procedure.

## Every deployment disconnects every tunnel

On 2026-09-24 a gate deployment stopped tunnels for many servers for 36
minutes: dials succeeded, heartbeats went unanswered, visitors got 503, and
each server redialed every 60–80 seconds until the gate was rolled back. The
new version's code was not the cause. On staging, redeploying the unchanged
previous version while tunnels were connected did the same thing, every time:

- Every `wrangler deploy` and `wrangler versions deploy`, including a `0%`
  split and a redeploy of the same version, orphans the hibernated tunnel
  WebSockets. The bb keeps an open socket that nothing answers, and the
  Durable Object answers visitors with 503 because it has no tunnel.
- While the object keeps receiving requests (the bb redialing, visitors
  retrying), every new tunnel dial into it is orphaned the same way. Some
  objects instead fail every request with `Network connection lost.`
- An object that receives no requests for about 45 seconds recovers. Busy
  servers never go quiet, which is why production stayed down until the
  rollback.
- `wrangler rollback` behaved differently in every case we saw. It closed
  connected tunnels at once and they redialed cleanly. That held for the
  production rollback on 2026-09-24 and three staging rollbacks, one to a
  gate without the restart below and one to a version that had never been
  deployed. We don't know why.

Since #4268 (in production from 2026-09-24 16:53 UTC), `TunnelDO` records
when its tunnel opens and closes. When a visitor
request, a tunnel dial, or the 50-second presence alarm finds no live tunnel
socket although the last one never closed, it saves a close and calls
`ctx.abort()`. The restarted object closes the orphaned socket, the bb redials
at once, and the tunnel is back within seconds. On staging a redeploy under
load cost each tunnel about 5–10 seconds with this change, where it had cost
them indefinitely without it. Objects from before this change, which only
record `serverId` or `machineId`, are restarted once the same way.

Since #4313 the gate also holds visitor requests and WebSocket upgrades for up
to 15 seconds after an unclean tunnel loss, and replays GET dials that hit the
restart, so a deployment shows up as a short delay for visitors instead of
503s and 500s.

Attaching or detaching `wrangler tail`, or the dashboard's live logs, resets
the gate the same way: every attach and every detach drops every tunnel. Never
tail `bb-connect`, in production or on staging; use the GraphQL analytics below.

This is a Cloudflare platform problem worth a support ticket. The staging
reproduction, with timestamps and object IDs, is in #4251 and #4268.

## How Cloudflare splits a Worker with Durable Objects

A gradual deployment serves two versions at once. The gate worker and its
`TunnelDO` class live in one script, and the two halves split differently:

- **Requests to the worker entrypoint are assigned per request.** Each request
  is routed to a version at random according to the percentages, unless it
  carries a `Cloudflare-Workers-Version-Key` header (version affinity).
  Consecutive dials from the same bb can hit different versions.
- **Each Durable Object is pinned to one version per deployment.** Cloudflare
  assigns every object a version from the percentages; all requests to that
  object use it until the next deployment. Raising the new version's share
  with the versions listed in the same order never moves an object back, and
  an object is reset only when its version changes, so each tunnel reconnects
  once per step it moves in.
- **`Cloudflare-Workers-Version-Overrides: bb-connect="<version-id>"`** sends a
  request to a specific version in the current deployment, including one at
  0%. It applies to the entrypoint; the Durable Object still runs its assigned
  version.
- Versions that change a Durable Object class lifecycle (the `migrations`
  array) can't be uploaded. Ship those with `wrangler deploy`, alone.
- Rollback (`wrangler rollback <version-id>`) replaces a split deployment with
  one version at 100% immediately. Only the 100 most recent versions can be
  deployed or rolled back to.

Sources: Cloudflare's [gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/),
[with Durable Objects](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/),
[version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/),
and [rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Steps

Never deploy a gate version from before #4268 with `wrangler deploy` or
`wrangler versions deploy`: its objects can't restart orphaned tunnels, and
busy servers would stay down.

1. **Merge.** `Deploy Connect (upload only)` applies pending connect-db
   migrations and runs `wrangler versions upload`. The new version serves no
   traffic. Its ID is in the run summary and in
   `pnpm --filter @bb/connect exec wrangler versions list`.
2. **Deploy.** From `apps/connect`:

   ```sh
   pnpm exec wrangler deployments status                  # <old>, the version serving traffic now
   pnpm exec wrangler versions deploy <new>@100% --yes --message "<what changed>"
   ```

   Every deployment disconnects every tunnel once and #4268 brings each back
   within seconds, so each step costs every connected server a reconnect. Go
   to 100% in one step. To try a change that could break dials on part of the
   servers first, deploy `<new>@5% <old>@95%`, hold 15 to 30 minutes, then
   deploy `<new>@100%`, with the versions listed in the same order.
3. **Watch for 15 minutes** (below), and roll back if tunnels don't come back.

Add `--env staging` to the same commands to rehearse on `bb-connect-staging`.

## What to watch after a deployment

Don't tail the worker to watch a deployment; that is a second reset.

- **A real server.** `grep 'plugin:connect\] tunnel' ~/.bb/logs/server-stdio.log`
  shows each dial and how it authenticated. Expect one reconnect within
  seconds of the deployment and no `tunnel heartbeat missed` afterwards.
- **503s per host** (zone `getbb.app`, `d1d0008731a858c96e3cd4013d720ce6`).
  Compare the same window before the deployment. A normal deployment shows one
  reconnect burst that settles within 5 minutes, and a steady 7–10% 503 share
  across `*.getbb.app`.

  ```graphql
  query ($zone: String!, $since: Time!, $until: Time!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      httpRequestsAdaptiveGroups(limit: 50, orderBy: [count_DESC], filter: {
        datetime_geq: $since, datetime_leq: $until,
        clientRequestHTTPHost_like: "%.getbb.app", edgeResponseStatus: 503
      }) { count dimensions { clientRequestHTTPHost } }
    } }
  }
  ```

  For the share over time, drop the status filter and group by
  `datetimeFiveMinutes` and `edgeResponseStatus`.
- **Durable Object outcomes** (account `7bb84c630057dafa53e2aacbe6bd094f`).
  `clientDisconnected` ran about 200 per 5 minutes before the incident and
  about 1,250 during it. `internalError` spikes once as objects restart after
  a deployment, then returns to 0.

  ```graphql
  query ($account: String!, $since: Time!, $until: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: {
        scriptName: "bb-connect", datetime_geq: $since, datetime_leq: $until
      }) { sum { requests } dimensions { datetimeFiveMinutes status } }
    } }
  }
  ```

  Add `objectId` to the dimensions to see whether one object dominates.

Send the queries to `https://api.cloudflare.com/client/v4/graphql` with a
token that can read analytics, for example the wrangler OAuth token in
`~/.config/.wrangler/config/default.toml`.

## Rollback

```sh
cd apps/connect
pnpm exec wrangler rollback <previous-version-id> -m "<reason>"              # production
pnpm exec wrangler rollback <previous-version-id> --env staging -m "<reason>"
```

`<previous-version-id>` is the `<old>` that `wrangler deployments status`
showed before the deployment. `wrangler rollback` closed connected tunnels cleanly in every case we saw,
including a rollback to a gate without the tunnel restart, so it's the tool to
reach for in an emergency. Never "roll back" with
`wrangler versions deploy <old>@100%`: that orphans tunnels like any other
deployment.

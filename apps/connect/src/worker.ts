import { drizzle } from "drizzle-orm/d1";
import {
  RESERVED_HANDLES,
  handleAppLinkAssociationRequest,
  parseVisitorHost,
  schema,
} from "@bb/connect-db";
import { refreshAccountSessionCookies } from "./account-session.js";
import { TUNNEL_OFFLINE_HEADER, TunnelDO, type Env } from "./tunnel-do.js";
import {
  invalidateSessionCookie,
  parseCookie,
  markMachineSeen,
  resolveLabel,
  verifyMachineCredentialDetails,
  verifySessionCookieDetails,
} from "./session.js";
import {
  handleCreateDesktopSession,
  handleDisconnectServer,
  handleListAccountServers,
  verifyDesktopSessionCookie,
} from "./servers.js";
import { serveWithCache } from "./cache.js";
import { BB_ICON_DATA_URI } from "./bb-icon.js";
import { handleAssignMachineLabel } from "./machine-label.js";
import {
  publicConnectOrigin,
  resolveConnectRequestHost,
  resolveConnectRequestUrl,
  resolveConnectRuntime,
  stripCloudDevHeader,
} from "./cloud-dev.js";
import {
  GATE_AUTH_HEADER,
  GATE_MACHINE_ID_HEADER,
  MACHINE_CREDENTIAL_HEADER,
  TUNNEL_TARGET_HEADER,
} from "./protocol-headers.js";

export { TunnelDO };

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function withSetCookies(
  response: Response,
  setCookies: readonly string[],
): Response {
  const headers = new Headers(response.headers);
  for (const setCookie of setCookies) headers.append("set-cookie", setCookie);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

// Matches the bb dashboard's visual language (Inter, --canvas/--ink tokens,
// dark primary button, bb logo) since this plain worker can't bundle React.
export function dashboardSignInUrl(appUrl: string, returnTo: string): string {
  const url = new URL("/dashboard", appUrl);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

// Shared gate-page shell. The 401 sign-in and 503 offline pages render through
// one template so they can never drift apart the way the dashboard and gate
// once did. Matches the bb dashboard's visual language (Inter, --canvas/--ink
// tokens derived from two anchors, dark-mode media query, inlined bb icon,
// centered card) since this plain worker can't bundle React.
const GATE_STYLE = `
  :root{--canvas:oklch(1 0 0);--ink:oklch(0.3211 0 0);
    --muted:color-mix(in oklch,var(--ink) 55%,var(--canvas));
    --subtle:color-mix(in oklch,var(--ink) 40%,var(--canvas));
    --border:color-mix(in oklch,var(--ink) 14%,var(--canvas));
    --card:color-mix(in oklch,var(--ink) 2%,var(--canvas));
    --warn:oklch(0.72 0.15 66);
    --warn-bg:color-mix(in oklch,var(--warn) 14%,var(--canvas));
    --warn-border:color-mix(in oklch,var(--warn) 38%,var(--canvas));}
  @media (prefers-color-scheme:dark){:root{--canvas:oklch(0.195 0 0);--ink:oklch(0.81 0 0)}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
    background:var(--canvas);color:var(--ink);
    font:15px/1.6 "Inter",-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{width:100%;max-width:420px;padding:24px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .brand img{width:28px;height:28px}
  .brand b{font-weight:600;font-size:15px;letter-spacing:-.01em}
  .brand span{color:var(--muted);font-size:13px}
  .card{border:1px solid var(--border);background:var(--card);border-radius:12px;padding:22px 24px}
  h1{margin:0 0 4px;font-size:18px;font-weight:600;letter-spacing:-.01em}
  p{margin:0 0 16px;color:var(--muted);font-size:14px}
  p.note{color:var(--subtle);font-size:13px}
  code{font-family:"Fira Code",ui-monospace,monospace;font-size:.92em}
  .btn{display:flex;align-items:center;justify-content:center;width:100%;padding:11px 16px;
    border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--ink);
    font:500 14px/1 "Inter",-apple-system,system-ui,sans-serif;text-decoration:none;cursor:pointer}
  .btn.primary{background:var(--ink);border-color:var(--ink);color:var(--canvas)}
  .glyph{width:34px;height:34px;border-radius:999px;background:var(--warn-bg);
    border:1px solid var(--warn-border);color:var(--warn);
    display:flex;align-items:center;justify-content:center;margin-bottom:12px}
  .glyph svg{width:16px;height:16px;stroke:currentColor}
`;

/** Render a gate page: brand row + centered card, one status, optional refresh. */
function gatePage(
  cardBody: string,
  status: number,
  metaRefreshSeconds?: number,
): Response {
  const refresh =
    metaRefreshSeconds !== undefined
      ? `<meta http-equiv="refresh" content="${metaRefreshSeconds}">`
      : "";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     ${refresh}<title>bb connect</title>
     <link rel="preconnect" href="https://fonts.googleapis.com">
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
     <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
     <style>${GATE_STYLE}</style></head>
     <body><div class="wrap">
       <div class="brand"><img src="${BB_ICON_DATA_URI}" alt="bb"><div><b>bb connect</b><br><span>Your bb, reachable anywhere</span></div></div>
       <div class="card">${cardBody}</div>
     </div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** Escape a label before interpolation. Labels are LDH-validated, but defensive. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Relative "last seen" phrasing for the offline page: "just now" under a
 * minute, "N minutes ago" / "N hours ago" within a day, then the calendar date.
 */
export function relativeTime(date: Date, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * A browser navigation (not an API/asset/fetch call). Only navigations get the
 * styled offline page; everything else keeps the plain 503 the origin expects.
 */
export function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** 401: visitor isn't signed in as the account that owns this label's server. */
function signInPage(label: string, appUrl: string, returnTo: string): Response {
  const host = new URL(appUrl).host;
  const signInUrl = dashboardSignInUrl(appUrl, returnTo);
  return gatePage(
    `<h1>This is <code>${escapeHtml(label)}</code>'s bb</h1>
     <p>Sign in with the account that owns this server to open it.</p>
     <a class="btn primary" href="${signInUrl}">Sign in at ${escapeHtml(host)}</a>`,
    401,
  );
}

/**
 * 503: the owner is signed in but the tunnel is down. Rendered only for browser
 * navigations; the last-seen timestamp comes from the row the gate already
 * resolved (fresh enough to be truthful) and the page self-retries.
 */
export function offlinePage(
  lastSeenAt: Date | null,
  kind: "server" | "machine",
): Response {
  // A machine label fronts a daemon's port shares, not a bb app — the copy
  // names the machine so "your bb" never claims a laptop that only shares.
  const heading =
    kind === "machine" ? "This machine is offline" : "Your bb is offline";
  const lastSeen = lastSeenAt
    ? kind === "machine"
      ? `This machine was last seen ${relativeTime(lastSeenAt)}. `
      : `Last seen ${relativeTime(lastSeenAt)}. `
    : "";
  const note =
    kind === "machine"
      ? "Usually this means the machine is asleep or bb isn't running on it."
      : "Usually this means the machine is asleep or bb isn't running.";
  return gatePage(
    `<div class="glyph"><svg viewBox="0 0 16 16" fill="none" stroke-width="1.5"><path d="M1.5 6.2a9.5 9.5 0 0 1 13 0M3.8 8.7a6 6 0 0 1 8.4 0M6.1 11.2a2.6 2.6 0 0 1 3.8 0" stroke-linecap="round"/><path d="M2 2l12 12" stroke-linecap="round"/><circle cx="8" cy="13.6" r="0.9" fill="currentColor" stroke="none"/></svg></div>
     <h1>${heading}</h1>
     <p>${lastSeen}This page retries automatically when it comes back.</p>
     <p class="note">${note}</p>
     <button class="btn" onclick="location.reload()">Retry now</button>`,
    503,
    10,
  );
}

/** A machine label has no bb app of its own; only nested port shares proxy. */
function machinePage(
  label: string,
  accountHandle: string,
  runtime: ReturnType<typeof resolveConnectRuntime>,
): Response {
  const appOrigin = publicConnectOrigin(accountHandle, runtime);
  const appHost = new URL(appOrigin).host;
  const baseHost = new URL(runtime.accountAppUrl).host;
  return gatePage(
    `<h1><code>${escapeHtml(label)}</code> is a machine</h1>
     <p>This machine is on <code>${escapeHtml(accountHandle)}</code>'s account. Its shares appear at <code>${escapeHtml(label)}--&lt;port&gt;.${escapeHtml(baseHost)}</code>.</p>
     <a class="btn primary" href="${escapeHtml(appOrigin)}">Open the bb app at ${escapeHtml(appHost)}</a>`,
    200,
  );
}

/**
 * Build the request forwarded to the TunnelDO. Always strips a visitor-supplied
 * target header; sets it only when the host label is a share (`handle--port`).
 */
export function requestForTunnelDo(
  request: Request,
  target: string | null,
  authKind?: "machine" | "session",
): Request {
  const headers = new Headers(request.headers);
  headers.delete(TUNNEL_TARGET_HEADER);
  headers.delete(MACHINE_CREDENTIAL_HEADER);
  headers.delete(GATE_AUTH_HEADER);
  headers.delete(GATE_MACHINE_ID_HEADER);
  stripCloudDevHeader(headers);
  if (target !== null) {
    headers.set(TUNNEL_TARGET_HEADER, target);
  }
  if (authKind !== undefined) {
    headers.set(GATE_AUTH_HEADER, authKind);
  }
  return new Request(request, { headers });
}

function isHostManagementMutation(request: Request, pathname: string): boolean {
  if (request.method === "POST" && pathname === "/internal/hosts/enroll-key") {
    return true;
  }
  if (request.method === "POST" && pathname === "/api/v1/hosts/join-codes") {
    return true;
  }
  if (
    request.method === "PATCH" &&
    /^\/api\/v1\/hosts\/[^/]+\/permission-ceiling$/u.test(pathname)
  ) {
    return true;
  }
  return (
    (request.method === "PATCH" || request.method === "DELETE") &&
    /^\/api\/v1\/hosts\/[^/]+$/u.test(pathname)
  );
}

/** Cache namespace for a resolved routing key plus optional share target. */
export function cacheNamespace(
  routingKey: string,
  target: string | null,
): string {
  return target !== null ? `${routingKey}--${target}` : routingKey;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const runtime = resolveConnectRuntime(env);
    const url = resolveConnectRequestUrl(request.url, request.headers, runtime);
    // Account-scoped APIs are handled on the gate before host/label routing so
    // they never proxy through a tunnel to a local bb origin. Auth is
    // machine/server credential or owner session — see servers.ts.
    if (url.pathname === "/api/connect/servers") {
      return handleListAccountServers(request, env);
    }
    if (url.pathname === "/api/connect/disconnect") {
      return handleDisconnectServer(request, env);
    }
    if (url.pathname === "/api/connect/desktop-session") {
      return handleCreateDesktopSession(request, env);
    }
    if (url.pathname === "/api/connect/machine-label") {
      return handleAssignMachineLabel(request, env);
    }
    const host = resolveConnectRequestHost(request.headers, runtime);
    const parsed = parseVisitorHost(host, env.BASE_DOMAIN);
    if (!parsed) return text("bb connect: unknown host\n", 404);
    // bb mobile universal / app links: Apple's CDN and Android fetch the
    // association files anonymously from `https://<label>.getbb.app`, so
    // bare labels answer here — before label resolution (Apple may fetch
    // before the label is claimed) and the session gate, never proxied to
    // the tunnel, never redirected. Share hosts (`<label>--<port>`) front
    // arbitrary local apps, not a bb server, so they must not claim
    // `/threads/*` & co for the app: they fall through to the normal gate
    // like any other path (401 for Apple's anonymous fetch → no association).
    if (parsed.target === null) {
      const appLinks = handleAppLinkAssociationRequest(
        { method: request.method, url: url.toString() },
        env,
      );
      if (appLinks) return appLinks;
    }
    // The base label is now ANY server's subdomain (the account handle names the
    // primary bb; additional bbs claim their own labels), not just a profile
    // handle. `target` (a port) rides along for share hosts, nested per-bb.
    const { handle: label, target } = parsed;
    // Reserved labels (www, api, …) are never claimable. The wildcard route can
    // receive them if a more specific binding is missing — send them home
    // rather than answering with a confusing "no server" page.
    if (RESERVED_HANDLES.has(label)) {
      return Response.redirect(
        `${runtime.accountAppUrl}${url.pathname}${url.search}`,
        301,
      );
    }

    // Bind the schema so the db satisfies the shared ConnectDb type (also what
    // the session helpers accept, and what in-memory tests exercise directly).
    const db = drizzle(env.DB, { schema });
    // Tunnel dials bypass the label cache from their very first lookup. This
    // avoids both stale credentials and a cached negative immediately after a
    // machine label is assigned.
    const isTunnelDial = url.pathname === "/__tunnel";
    const resolved = await resolveLabel(
      label,
      db,
      isTunnelDial ? { fresh: true } : undefined,
    );
    if (!resolved) return text(`bb connect: no server for "${label}"\n`, 404);

    // Server routing stays exactly as on main (the bare label). Machine labels
    // are new and use ownership-generation identity from their first dial.
    const routingKey =
      resolved.kind === "machine" ? resolved.routingKey : label;
    const stub = env.TUNNEL_DO.get(env.TUNNEL_DO.idFromName(routingKey));

    // Tunnel client connection — bare label only (share hosts are visitor-facing).
    if (url.pathname === "/__tunnel") {
      if (target !== null) return text("bb connect: not found\n", 404);
      const auth = request.headers.get("authorization") ?? "";
      const credential = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const owner =
        resolved.kind === "server" ? resolved.server : resolved.machine;
      if (owner.revokedAt != null || owner.credentialHash == null) {
        return text(
          resolved.kind === "server"
            ? "bb connect: server not paired\n"
            : "bb connect: machine not paired\n",
          403,
        );
      }
      if ((await sha256Hex(credential)) !== owner.credentialHash) {
        return text("bb connect: invalid credential\n", 401);
      }
      const forward = new URL(request.url);
      forward.searchParams.delete("serverId");
      forward.searchParams.delete("machineId");
      if (resolved.kind === "server") {
        forward.searchParams.set("serverId", owner.id);
      } else {
        forward.searchParams.set("machineId", owner.id);
      }
      const headers = new Headers(request.headers);
      stripCloudDevHeader(headers);
      return stub.fetch(
        new Request(new Request(forward, request), { headers }),
      );
    }

    // Reserve the /__ namespace: never proxy internal paths from outside.
    if (url.pathname.startsWith("/__"))
      return text("bb connect: not found\n", 404);

    // Machine labels route only explicit `<label>--<port>` shares. The bare
    // label is an informational gate page and never reaches the machine DO.
    if (resolved.kind === "machine" && target === null) {
      return machinePage(label, resolved.accountHandle, runtime);
    }

    // The bootstrap script and its server-matched package must be reachable
    // before the new machine has a browser session or credential.
    const isPublicInstallPath =
      url.pathname === "/install.sh" ||
      url.pathname === "/install/version" ||
      url.pathname === "/install/bb-app.tgz";
    if (request.method === "GET" && isPublicInstallPath) {
      if (target !== null) return text("bb connect: not found\n", 404);
      const headers = new Headers(request.headers);
      headers.delete(MACHINE_CREDENTIAL_HEADER);
      headers.delete(TUNNEL_TARGET_HEADER);
      headers.delete(GATE_AUTH_HEADER);
      headers.delete(GATE_MACHINE_ID_HEADER);
      stripCloudDevHeader(headers);
      return stub.fetch(new Request(request, { headers }));
    }

    // Daemon + machine CLI traffic. Share hosts are visitor-only. The bb
    // server still verifies the daemon host key underneath this gate check.
    const isMachinePath =
      url.pathname.startsWith("/internal") ||
      url.pathname === "/api/v1" ||
      url.pathname.startsWith("/api/v1/");
    if (target !== null && url.pathname.startsWith("/internal")) {
      return text("bb connect: not found\n", 404);
    }
    const presentedMachineCredential = request.headers.get(
      MACHINE_CREDENTIAL_HEADER,
    );
    if (isMachinePath && presentedMachineCredential !== null) {
      if (target !== null) return text("bb connect: not found\n", 404);
      const verified = await verifyMachineCredentialDetails(
        presentedMachineCredential,
        db,
      );
      if (verified == null || verified.userId !== resolved.userId) {
        return text("bb connect: machine not authorized\n", 403);
      }
      if (isHostManagementMutation(request, url.pathname)) {
        return text("bb connect: machine cannot manage hosts\n", 403);
      }
      ctx.waitUntil(markMachineSeen(verified.machineId, db));
      const headers = new Headers(request.headers);
      headers.delete(MACHINE_CREDENTIAL_HEADER);
      headers.delete(TUNNEL_TARGET_HEADER);
      headers.delete(GATE_AUTH_HEADER);
      headers.delete(GATE_MACHINE_ID_HEADER);
      stripCloudDevHeader(headers);
      headers.set(GATE_AUTH_HEADER, "machine");
      headers.set(GATE_MACHINE_ID_HEADER, verified.machineId);
      return stub.fetch(new Request(request, { headers }));
    }
    if (url.pathname.startsWith("/internal")) {
      return text("bb connect: machine not authorized\n", 403);
    }

    // Visitor request — require a session owned by this label's account.
    // Identical auth for bare-label and share hosts. Because this check passed,
    // only the owner ever reaches the DO below (and thus its offline 503).
    const cookieHeader = request.headers.get("cookie");
    const cookie = parseCookie(cookieHeader, runtime.sessionCookieName);
    const desktopCookie = parseCookie(
      cookieHeader,
      runtime.desktopSessionCookieName,
    );
    const appUrl = runtime.accountAppUrl;
    if (!cookie && !desktopCookie)
      return signInPage(label, appUrl, url.toString());
    const verifiedSession = cookie
      ? await verifySessionCookieDetails(cookie, env.BETTER_AUTH_SECRET, db)
      : null;
    const sessionUserId = verifiedSession?.userId ?? null;
    const desktopUserId = desktopCookie
      ? await verifyDesktopSessionCookie(desktopCookie, env.BETTER_AUTH_SECRET)
      : null;
    if (!sessionUserId && !desktopUserId) {
      return signInPage(label, appUrl, url.toString());
    }
    if (
      sessionUserId !== resolved.userId &&
      desktopUserId !== resolved.userId
    ) {
      return text("bb connect: not your server\n", 403);
    }

    const doRequest = requestForTunnelDo(request, target, "session");
    // WebSocket upgrades (bb's /ws, terminals) can't be cached — proxy directly.
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return stub.fetch(doRequest);
    }
    // Everything else: serve from the edge cache when the origin allows it,
    // otherwise proxy through the tunnel. Namespace by full host label so a
    // share response never collides with bare-label app assets.
    const cached = await serveWithCache(
      request,
      cacheNamespace(routingKey, target),
      ctx,
      (init) => {
        if (init === undefined) return stub.fetch(doRequest);
        // Shell revalidation: the edge holds the last confirmed document, so
        // ask the origin to confirm its ETag instead of resending the body.
        const headers = new Headers(doRequest.headers);
        headers.set("if-none-match", init.ifNoneMatch);
        return stub.fetch(new Request(doRequest, { headers }));
      },
    );
    let response = cached.response;
    // Tunnel down + a browser navigation → the styled offline page, using the
    // last_seen_at already resolved for this server. API/asset/fetch requests
    // (no text/html Accept) keep the DO's plain 503 so clients handle it.
    if (
      response.status === 503 &&
      response.headers.get(TUNNEL_OFFLINE_HEADER) === "1" &&
      wantsHtml(request)
    ) {
      response = offlinePage(
        resolved.kind === "server"
          ? resolved.server.lastSeenAt
          : resolved.machine.lastSeenAt,
        resolved.kind,
      );
    }

    // Edge-cacheable responses do not count as session activity. Once Better
    // Auth's update-age boundary arrives, refresh both the D1 row and browser
    // cookie on a non-cacheable HTTP response. This keeps their expiry in sync
    // without rebuilding a pre-encoded cache hit or calling the account worker
    // on every dynamic request.
    if (
      !cached.cacheable &&
      cookie !== null &&
      sessionUserId === resolved.userId &&
      verifiedSession?.needsRefresh === true
    ) {
      // The account worker will re-read D1. Drop this isolate's old expiration
      // hint so the next request observes the renewed row instead of repeating
      // the cross-worker check for the rest of the short verification TTL.
      invalidateSessionCookie(cookie);
      const setCookies = await refreshAccountSessionCookies(
        `${runtime.sessionCookieName}=${cookie}`,
        runtime.accountAppUrl,
        (authRequest) => fetch(authRequest),
      );
      if (setCookies !== null) return withSetCookies(response, setCookies);
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

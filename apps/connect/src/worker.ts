import { drizzle } from "drizzle-orm/d1";
import { RESERVED_HANDLES, handleFromHost } from "@bb/connect-db";
import { TunnelDO, type Env } from "./tunnel-do.js";
import {
  parseCookie,
  resolveHandle,
  verifyMachineCredential,
  verifySessionCookie,
} from "./session.js";
import { serveWithCache } from "./cache.js";
import { BB_ICON_DATA_URI } from "./bb-icon.js";

export { TunnelDO };

const SESSION_COOKIE = "__Secure-better-auth.session_token";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// Matches the bb dashboard's visual language (Inter, --canvas/--ink tokens,
// dark primary button, bb logo) since this plain worker can't bundle React.
function signInPage(handle: string, appUrl: string): Response {
  const host = new URL(appUrl).host;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <title>bb connect</title>
     <link rel="preconnect" href="https://fonts.googleapis.com">
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
     <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
     <style>
       :root{--canvas:oklch(1 0 0);--ink:oklch(0.3211 0 0);
         --muted:color-mix(in oklch,var(--ink) 55%,var(--canvas));
         --border:color-mix(in oklch,var(--ink) 14%,var(--canvas));
         --card:color-mix(in oklch,var(--ink) 2%,var(--canvas));}
       @media (prefers-color-scheme:dark){:root{--canvas:oklch(0.195 0 0);--ink:oklch(0.81 0 0)}}
       *{box-sizing:border-box}
       body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
         background:var(--canvas);color:var(--ink);
         font:15px/1.6 "Inter",-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
       .wrap{width:100%;max-width:440px;padding:24px}
       .brand{display:flex;align-items:center;gap:10px;margin-bottom:20px}
       .brand img{width:28px;height:28px}
       .brand b{font-weight:600;font-size:15px;letter-spacing:-.01em}
       .brand span{color:var(--muted);font-size:13px}
       .card{border:1px solid var(--border);background:var(--card);border-radius:12px;padding:24px}
       h1{margin:0 0 6px;font-size:20px;font-weight:600;letter-spacing:-.02em}
       p{margin:0 0 18px;color:var(--muted);font-size:14px}
       code{font-family:"Fira Code",ui-monospace,monospace;font-size:.9em}
       a.btn{display:inline-flex;align-items:center;height:36px;padding:0 16px;border-radius:8px;
         background:var(--ink);color:var(--canvas);font-size:14px;font-weight:500;text-decoration:none}
     </style></head>
     <body><div class="wrap">
       <div class="brand"><img src="${BB_ICON_DATA_URI}" alt="bb"><div><b>bb connect</b><br><span>Your bb, reachable anywhere</span></div></div>
       <div class="card">
         <h1>This is <code>${handle}</code>'s bb</h1>
         <p>Sign in with the account that owns this server to reach it.</p>
         <a class="btn" href="${appUrl}">Sign in at ${host}</a>
       </div>
     </div></body></html>`,
    { status: 401, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const handle = handleFromHost(host, env.BASE_DOMAIN);
    if (!handle) return text("bb connect: unknown host\n", 404);
    // Reserved labels (www, api, …) are never handles. The wildcard route can
    // receive them if a more specific binding is missing — send them home
    // rather than answering with a confusing "no server" page.
    if (RESERVED_HANDLES.has(handle)) {
      return Response.redirect(`https://${env.BASE_DOMAIN}${url.pathname}${url.search}`, 301);
    }

    const db = drizzle(env.DB);
    const resolved = await resolveHandle(handle, db);
    if (!resolved) return text(`bb connect: no server for "${handle}"\n`, 404);

    const stub = env.TUNNEL_DO.get(env.TUNNEL_DO.idFromName(handle));

    // Tunnel client connection — authenticate with the durable credential.
    if (url.pathname === "/__tunnel") {
      const auth = request.headers.get("authorization") ?? "";
      const credential = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      // Re-resolve fresh (bypass the isolate cache): a warm isolate would
      // otherwise honor a just-revoked credential for up to the cache TTL,
      // letting a leaked credential re-establish a tunnel after disconnect.
      const freshResolved = await resolveHandle(handle, db, { fresh: true });
      const srv = freshResolved?.server;
      if (!srv || srv.revokedAt != null || srv.credentialHash == null) {
        return text("bb connect: server not paired\n", 403);
      }
      if ((await sha256Hex(credential)) !== srv.credentialHash) {
        return text("bb connect: invalid credential\n", 401);
      }
      const forward = new URL(request.url);
      forward.searchParams.set("serverId", srv.id);
      return stub.fetch(new Request(forward, request));
    }

    // Reserve the /__ namespace: never proxy internal paths from outside.
    if (url.pathname.startsWith("/__")) return text("bb connect: not found\n", 404);

    // Daemon → server traffic (bb's host-daemon protocol). Authenticated by a
    // bb-connect machine credential so the internet can't reach /internal/*
    // (which the server would otherwise treat as loopback via the tunnel). The
    // server still host-key-auths underneath — defense in depth. The machine
    // credential header is stripped before forwarding.
    const MACHINE_HEADER = "x-bb-connect-machine";
    if (url.pathname.startsWith("/internal")) {
      const machineCred = request.headers.get(MACHINE_HEADER) ?? "";
      const machineUserId = await verifyMachineCredential(machineCred, db);
      if (machineUserId == null || machineUserId !== resolved.userId) {
        return text("bb connect: machine not authorized\n", 403);
      }
      const headers = new Headers(request.headers);
      headers.delete(MACHINE_HEADER);
      return stub.fetch(new Request(request, { headers }));
    }

    // Visitor request — require a session owned by this handle's account.
    const cookie = parseCookie(request.headers.get("cookie"), SESSION_COOKIE);
    const appUrl = `https://${env.BASE_DOMAIN}`;
    if (!cookie) return signInPage(handle, appUrl);
    const userId = await verifySessionCookie(cookie, env.BETTER_AUTH_SECRET, db);
    if (!userId) return signInPage(handle, appUrl);
    if (userId !== resolved.userId) return text("bb connect: not your server\n", 403);

    // WebSocket upgrades (bb's /ws, terminals) can't be cached — proxy directly.
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return stub.fetch(request);
    }
    // Everything else: serve from the edge cache when the origin allows it,
    // otherwise proxy through the tunnel.
    return serveWithCache(request, handle, ctx, () => stub.fetch(request));
  },
} satisfies ExportedHandler<Env>;

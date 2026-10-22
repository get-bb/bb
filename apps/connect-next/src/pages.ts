import { escapeHtmlText } from "@bb/text-utils";
import { BB_ICON_DATA_URI } from "./bb-icon.js";
import { json, text, type Reply } from "./reply.js";

export const TUNNEL_OFFLINE_HEADER = "x-bb-tunnel-offline";

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

function gatePage(
  cardBody: string,
  status: number,
  metaRefreshSeconds?: number,
): Reply {
  const refresh =
    metaRefreshSeconds !== undefined
      ? `<meta http-equiv="refresh" content="${metaRefreshSeconds}">`
      : "";
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
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
  };
}

export function relativeTime(date: Date, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dashboardSignInUrl(appUrl: string, returnTo: string): string {
  const url = new URL("/dashboard", appUrl);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

export function signInPage(
  label: string,
  appUrl: string,
  returnTo: string,
): Reply {
  const host = new URL(appUrl).host;
  const signInUrl = dashboardSignInUrl(appUrl, returnTo);
  return gatePage(
    `<h1>This is <code>${escapeHtmlText(label)}</code>'s bb</h1>
     <p>Sign in with the account that owns this server to open it.</p>
     <a class="btn primary" href="${escapeHtmlText(signInUrl)}">Sign in at ${escapeHtmlText(host)}</a>`,
    401,
  );
}

export function signInRequired(): Reply {
  return text("bb connect: sign in required\n", 401);
}

export function offlinePage(
  lastSeenAt: Date | null,
  kind: "server" | "machine",
): Reply {
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
  const page = gatePage(
    `<div class="glyph"><svg viewBox="0 0 16 16" fill="none" stroke-width="1.5"><path d="M1.5 6.2a9.5 9.5 0 0 1 13 0M3.8 8.7a6 6 0 0 1 8.4 0M6.1 11.2a2.6 2.6 0 0 1 3.8 0" stroke-linecap="round"/><path d="M2 2l12 12" stroke-linecap="round"/><circle cx="8" cy="13.6" r="0.9" fill="currentColor" stroke="none"/></svg></div>
     <h1>${heading}</h1>
     <p>${lastSeen}This page retries automatically when it comes back.</p>
     <p class="note">${note}</p>
     <button class="btn" onclick="location.reload()">Retry now</button>`,
    503,
    10,
  );
  page.headers[TUNNEL_OFFLINE_HEADER] = "1";
  return page;
}

export function offlineText(): Reply {
  const reply = text(
    "bb connect: this server is offline (no tunnel connected)\n",
    503,
  );
  reply.headers[TUNNEL_OFFLINE_HEADER] = "1";
  return reply;
}

export function machinePage(
  label: string,
  accountHandle: string,
  accountAppUrl: string,
  shareBaseDomain: string,
): Reply {
  const appUrl = new URL(accountAppUrl);
  appUrl.hostname = `${accountHandle}.${appUrl.hostname}`;
  const appOrigin = appUrl.origin;
  const appHost = appUrl.host;
  return gatePage(
    `<h1><code>${escapeHtmlText(label)}</code> is a machine</h1>
     <p>This machine is on <code>${escapeHtmlText(accountHandle)}</code>'s account. Its shares appear at <code>${escapeHtmlText(label)}--&lt;port&gt;.${escapeHtmlText(shareBaseDomain)}</code>.</p>
     <a class="btn primary" href="${escapeHtmlText(appOrigin)}">Open the bb app at ${escapeHtmlText(appHost)}</a>`,
    200,
  );
}

export function gateErrorReply(wantsHtml: boolean): Reply {
  if (wantsHtml) {
    return gatePage(
      `<h1>bb connect hit a temporary problem</h1>
       <p>This page retries automatically in a few seconds.</p>
       <button class="btn" onclick="location.reload()">Retry now</button>`,
      502,
      5,
    );
  }
  return json(
    {
      code: "connect_gate_error",
      message: "bb connect hit a temporary problem. Try again in a moment.",
    },
    502,
  );
}

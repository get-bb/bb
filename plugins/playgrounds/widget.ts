export const WIDGET_MESSAGE_SOURCE = "playground";
export const THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "muted",
  "muted-foreground",
  "border",
  "input",
  "ring",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "destructive",
] as const;

export type WidgetTheme = {
  scheme: "light" | "dark";
  font: string;
  tokens: Partial<Record<(typeof THEME_TOKENS)[number], string>>;
};
export const fallbackTheme: WidgetTheme = {
  scheme: "light",
  font: '"Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  tokens: {
    background: "#ffffff",
    foreground: "#111111",
    card: "#ffffff",
    muted: "#f4f4f2",
    "muted-foreground": "#6b6b6b",
    border: "#e6e6e3",
    ring: "#2f80ed",
    primary: "#111111",
    "primary-foreground": "#ffffff",
    accent: "#f4f4f2",
  },
};

const KIT = String.raw`
:root {
  color-scheme: light; --pg-ease: cubic-bezier(.2,.7,.2,1);
  --pg-ink: var(--foreground);
  --pg-body: color-mix(in srgb, var(--foreground) 76%, var(--card));
  --pg-meta: color-mix(in srgb, var(--foreground) 52%, var(--card));
  --pg-stage: color-mix(in srgb, var(--foreground) 4%, var(--card));
  --pg-hairline: color-mix(in srgb, var(--foreground) 9%, var(--card));
  --pg-radius: 16px; --pg-radius-stage: 12px; --pg-radius-photo: 12px;
}
:root[data-scheme=dark] { color-scheme: dark; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body { padding: 20px 22px 22px; font: 13px/1.45 var(--font); color: var(--foreground); -webkit-font-smoothing: antialiased; overflow-wrap: anywhere; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
img, svg { display: block; max-width: 100%; }
.pg-title { margin: 0; font-size: 20px; line-height: 1.2; font-weight: 500; letter-spacing: -.02em; color: var(--pg-ink); }
.pg-subtitle { margin: 3px 0 0; font-size: 12px; line-height: 1.4; color: var(--pg-meta); }
.pg-eyebrow { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--pg-meta); font-weight: 500; }
.pg-h { margin: 0; font-size: 13px; line-height: 1.3; font-weight: 500; color: var(--pg-ink); }
.pg-item-title { margin: 0; font-size: 15px; line-height: 1.3; font-weight: 500; letter-spacing: -.01em; color: var(--pg-ink); }
.pg-body { margin: 0; font-size: 12px; line-height: 1.45; color: var(--pg-body); }
.pg-meta, .pg-muted { font-size: 11px; line-height: 1.4; color: var(--pg-meta); }
.pg-panel { padding: 14px 16px; border: 1px solid var(--pg-hairline); border-radius: var(--pg-radius); background: var(--card); }
.pg-stage { border-radius: var(--pg-radius-stage); background: var(--pg-stage); overflow: hidden; }
.pg-photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.pg-photos img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--pg-radius-photo); }
.pg-seg { display: inline-flex; flex-shrink: 0; gap: 2px; padding: 3px; border-radius: 999px; border: 1px solid var(--pg-hairline); background: var(--card); }
.pg-seg button, .pg-chip { white-space: nowrap; border: 1px solid transparent; background: transparent; border-radius: 999px; padding: 5px 11px; font-size: 11.5px; line-height: 1.2; color: var(--muted-foreground); transition: background .2s, color .2s; }
.pg-chip { border-color: var(--pg-hairline); }
.pg-seg button[aria-pressed=true], .pg-chip[aria-pressed=true] { background: var(--foreground); color: var(--background); border-color: var(--foreground); font-weight: 500; }
.pg-btn, .pg-btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 32px; padding: 6px 14px; border-radius: 999px; border: 1px solid var(--pg-hairline); background: var(--card); font-size: 12px; font-weight: 500; color: var(--pg-ink); transition: opacity .2s, background .2s; }
.pg-btn:hover { background: var(--muted); }
.pg-btn-primary { background: var(--foreground); border-color: var(--foreground); color: var(--background); }
.pg-btn-primary:hover { background: var(--foreground); opacity: .88; }
.pg-btn:disabled, .pg-btn-primary:disabled { opacity: .45; cursor: default; }
.pg-link { border: 0; background: none; padding: 4px 0; font-size: 12px; color: var(--foreground); }
.pg-check { display: grid; grid-template-columns: 16px 1fr; gap: 2px 9px; align-items: start; font-size: 12px; cursor: pointer; }
.pg-check input { width: 14px; height: 14px; margin: 1px 0 0; accent-color: var(--foreground); }
.pg-check small { grid-column: 2; color: var(--muted-foreground); font-size: 11.5px; }
.pg-dots { display: flex; gap: 5px; }
.pg-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--border); transition: background .3s; }
.pg-dots i[aria-current=step] { background: var(--ring); }
.pg-reveal { animation: pg-reveal .38s var(--pg-ease) both; animation-delay: calc(var(--i, 0) * 45ms); }
@keyframes pg-reveal { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0ms !important; transition-duration: 1ms !important; } }
`;

function bridge(id: string, state: unknown, theme: WidgetTheme) {
  return String.raw`(() => {
  const SOURCE = ${JSON.stringify(WIDGET_MESSAGE_SOURCE)}, ID = ${JSON.stringify(id)};
  const post = (type, data) => parent.postMessage({ source: SOURCE, id: ID, type, ...data }, "*");
  const listeners = new Set(), stateListeners = new Set();
  const notify = (set, value) => { for (const callback of set) try { callback(value); } catch (error) { console.error(error); } };
  const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
  const apply = (theme) => {
    const root = document.documentElement;
    root.dataset.scheme = theme.scheme;
    root.style.setProperty("--font", theme.font);
    for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty("--" + name, value);
  };
  let init = {};
  try { if (location.hash.length > 1) init = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch {}
  let theme = init.theme || ${JSON.stringify(theme)};
  apply(theme);
  let state = "state" in init ? init.state : ${JSON.stringify(state ?? null)};
  let version = typeof init.version === "number" ? init.version : 0;
  const actions = new Map();
  window.playground = Object.freeze({
    id: ID,
    get state() { return state; },
    save(value) { try { state = plain(value); post("state", { state, base: version }); } catch {} },
    onState(callback) { stateListeners.add(callback); return () => stateListeners.delete(callback); },
    get theme() { return theme; },
    onTheme(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    expose(map) {
      for (const [name, run] of Object.entries(map || {})) if (typeof run === "function" && /^[A-Za-z][\w.-]*$/.test(name)) actions.set(name, run);
      post("actions", { actions: [...actions.keys()] });
    },
    emit(name, data) { try { post("event", { name: String(name), data: plain(data) }); } catch {} },
    send(label, data) { try { post("send", { label: String(label).slice(0, 80), data: plain(data) }); } catch {} },
  });
  addEventListener("message", async (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.source !== SOURCE) return;
    if (message.type === "theme") { theme = message.theme; apply(theme); notify(listeners, theme); }
    if (message.type === "state") { state = message.state; if (typeof message.version === "number") version = message.version; notify(stateListeners, state); }
    if (message.type === "font" && typeof message.family === "string" && message.data instanceof ArrayBuffer) {
      try { const face = new FontFace(message.family, message.data, { weight: "100 900" }); document.fonts.add(face); face.load().catch(() => {}); } catch {}
    }
    if (message.type === "command") {
      const run = actions.get(message.action);
      try {
        if (!run) throw new Error("Unknown action " + message.action);
        const value = await run(...(Array.isArray(message.args) ? message.args : []));
        post("result", { cmdId: message.cmdId, ok: true, value: value === undefined ? null : plain(value) });
      } catch (error) { post("result", { cmdId: message.cmdId, ok: false, error: String(error && error.message || error).slice(0, 2000) }); }
    }
  });
  let lastActive = 0;
  const active = () => { const now = Date.now(); if (now - lastActive > 4000) { lastActive = now; post("active", {}); } };
  addEventListener("pointerdown", active, true); addEventListener("keydown", active, true);
  const BaseAudio = window.AudioContext || window.webkitAudioContext;
  if (BaseAudio) {
    let silent = null;
    const unlock = () => {
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
      if (silent || !/iP(hone|ad|od)|Macintosh.*Mobile/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))) return;
      const n = 4000, bytes = new Uint8Array(44 + n), view = new DataView(bytes.buffer), text = (o, str) => [...str].forEach((ch, i) => bytes[o + i] = ch.charCodeAt(0));
      text(0, "RIFF"); view.setUint32(4, 36 + n, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); text(36, "data"); view.setUint32(40, n, true); bytes.fill(128, 44);
      silent = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }))); silent.loop = true; silent.setAttribute("playsinline", ""); silent.play().catch(() => { silent = null; });
    };
    class PlaybackAudioContext extends BaseAudio {
      constructor(...args) { super(...args); unlock(); }
      resume() { unlock(); return super.resume(); }
    }
    window.AudioContext = PlaybackAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = PlaybackAudioContext;
  }
  let last = 0;
  const report = () => { const height = Math.ceil(document.documentElement.getBoundingClientRect().height); if (height !== last) { last = height; post("height", { height }); } };
  addEventListener("DOMContentLoaded", () => { new ResizeObserver(report).observe(document.documentElement); report(); });
  addEventListener("load", report);
  addEventListener("click", (event) => {
    const link = event.target instanceof Element && event.target.closest("a[href]");
    if (!link || event.defaultPrevented) return;
    const url = new URL(link.getAttribute("href"), "https://invalid.invalid/");
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    event.preventDefault(); post("open", { url: url.href });
  });
})();`;
}

export const FRAME_PATH = "/frame";
export const IMAGE_HOSTS = ["https://upload.wikimedia.org"] as const;
export const FRAME_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  `img-src data: blob: ${IMAGE_HOSTS.join(" ")}`,
  "media-src data: blob:",
  "font-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");
export const FRAME_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": FRAME_CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "private, max-age=3600",
};

export function buildWidgetDocument({
  id,
  html,
  state,
  theme,
}: {
  id: string;
  html: string;
  state: unknown;
  theme: WidgetTheme;
}): string {
  const script = bridge(id, state, theme).replaceAll("</", "<\\/");
  return `<!doctype html><html data-scheme="${theme.scheme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${KIT}</style><script>${script}</script></head><body>${html}</body></html>`;
}

export const FRAME_MIN_HEIGHT = 80;
export const FRAME_MAX_HEIGHT = 2000;
export const FRAME_HEIGHT_BEFORE_FIRST_REPORT = 224;

export interface FrameTheme {
  appearance: "light" | "dark";
  variables: Readonly<Record<string, string>>;
}

type VariableFromAppToken = readonly [variable: string, appToken: string];

const APP_VARIABLES: readonly VariableFromAppToken[] = [
  ["--background", "--background"],
  ["--foreground", "--foreground"],
  ["--muted", "--muted"],
  ["--muted-foreground", "--muted-foreground"],
  ["--subtle-foreground", "--subtle-foreground"],
  ["--card", "--card"],
  ["--card-foreground", "--foreground"],
  ["--popover", "--popover"],
  ["--popover-foreground", "--popover-foreground"],
  ["--primary", "--primary"],
  ["--primary-foreground", "--primary-foreground"],
  ["--secondary", "--secondary"],
  ["--secondary-foreground", "--secondary-foreground"],
  ["--accent", "--accent"],
  ["--accent-foreground", "--accent-foreground"],
  ["--border", "--border"],
  ["--input", "--input"],
  ["--ring", "--ring"],
  ["--surface-raised", "--surface-raised-solid"],
  ["--surface-recessed", "--surface-recessed-solid"],
  ["--brand", "--timeline-accent"],
  ["--destructive", "--destructive"],
  ["--destructive-foreground", "--destructive-foreground"],
  ["--destructive-text", "--destructive-text"],
  ["--warning", "--warning"],
  ["--warning-text", "--warning-text"],
  ["--success", "--success"],
  ["--attention", "--attention"],
  ["--diff-added", "--diff-added"],
  ["--diff-removed", "--diff-removed"],
  ["--shadow-xs", "--shadow-xs"],
  ["--shadow-sm", "--shadow-sm"],
  ["--shadow-md", "--shadow-md"],
  ["--shadow-lg", "--shadow-lg"],
  ["--radius", "--radius"],
  ["--font-sans", "--font-sans"],
  ["--font-mono", "--font-mono"],
  ["--chart-1", "--timeline-accent"],
];

export const FRAME_THEME_TOKENS = APP_VARIABLES;

const CHART_SERIES_AFTER_THE_ACCENT = {
  light: ["#0d9488", "#d97706", "#9333ea", "#e11d48", "#65a30d"],
  dark: ["#2dd4bf", "#fbbf24", "#c084fc", "#fb7185", "#a3e635"],
};

export function frameTheme(
  appearance: FrameTheme["appearance"],
  readToken: (name: string) => string,
): FrameTheme {
  const variables: Record<string, string> = {};
  for (const [name, token] of FRAME_THEME_TOKENS) {
    const value = readToken(token).trim();
    if (value.length > 0) variables[name] = value;
  }
  CHART_SERIES_AFTER_THE_ACCENT[appearance].forEach((color, index) => {
    variables[`--chart-${index + 2}`] = color;
  });
  return { appearance, variables };
}

export function frameThemesEqual(left: FrameTheme, right: FrameTheme): boolean {
  const names = Object.keys(left.variables);
  return (
    left.appearance === right.appearance &&
    names.length === Object.keys(right.variables).length &&
    names.every((name) => left.variables[name] === right.variables[name])
  );
}

const HOST_CONTEXT_CHANGED_METHOD = "ui/notifications/host-context-changed";
const OPEN_LINK_METHOD = "ui/open-link";
const SIZE_CHANGED_METHOD = "ui/notifications/size-changed";

export function frameThemeMessage(theme: FrameTheme) {
  return {
    jsonrpc: "2.0" as const,
    method: HOST_CONTEXT_CHANGED_METHOD,
    params: { theme: theme.appearance, styles: { variables: theme.variables } },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown, name: string): unknown {
  return isRecord(value) ? value[name] : undefined;
}

export function readFrameContentHeight(data: unknown): number | undefined {
  if (field(data, "jsonrpc") !== "2.0") return undefined;
  if (field(data, "method") !== SIZE_CHANGED_METHOD) return undefined;
  const height = field(field(data, "params"), "height");
  return typeof height === "number" && Number.isFinite(height) && height > 0
    ? height
    : undefined;
}

export function readFrameLinkRequest(
  data: unknown,
): { id: string | number; url: string } | undefined {
  if (field(data, "jsonrpc") !== "2.0") return undefined;
  if (field(data, "method") !== OPEN_LINK_METHOD) return undefined;
  const id = field(data, "id");
  const url = field(field(data, "params"), "url");
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  return typeof url === "string" && /^https?:\/\//i.test(url)
    ? { id, url }
    : undefined;
}

export function frameResult(id: string | number) {
  return { jsonrpc: "2.0" as const, id, result: {} };
}

export function clampFrameHeight(height: number): number {
  return Math.min(
    FRAME_MAX_HEIGHT,
    Math.max(FRAME_MIN_HEIGHT, Math.round(height)),
  );
}

export function frameHeight(input: {
  requested: number | null;
  contentHeight: number | undefined;
  remembered: number | undefined;
}): number {
  const { requested, contentHeight, remembered } = input;
  const fitted = contentHeight ?? remembered;
  if (fitted === undefined) {
    return clampFrameHeight(requested ?? FRAME_HEIGHT_BEFORE_FIRST_REPORT);
  }
  return clampFrameHeight(Math.min(fitted, requested ?? FRAME_MAX_HEIGHT));
}

const SCROLLS_WITHOUT_A_SCROLLBAR =
  "html{scrollbar-width:none}html::-webkit-scrollbar{display:none}";
const FOCUS_OUTLINE_INSIDE_THE_ELEMENT =
  ":where(:focus-visible){outline:2px solid var(--ring)}:focus-visible{outline-width:2px!important;outline-offset:-2px!important}";
const BASE_CSS =
  "html{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}" +
  "body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}" +
  SCROLLS_WITHOUT_A_SCROLLBAR +
  FOCUS_OUTLINE_INSIDE_THE_ELEMENT;

const withoutCssTerminators = (value: string) => value.replace(/[;{}<>]/g, "");

function rootRule(theme: FrameTheme): string {
  const declarations = Object.entries(theme.variables)
    .filter(([name]) => /^--[a-z0-9-]+$/.test(name))
    .map(([name, value]) => `${name}:${withoutCssTerminators(value)};`)
    .join("");
  return `:root{color-scheme:${theme.appearance};${declarations}}`;
}

const BOOTSTRAP_SCRIPT = `(function(){var s=document.getElementById("bb-theme"),n=0;if(!s||window.parent===window)return;var b=${JSON.stringify(BASE_CSS)};function a(t){if(!t||typeof t!=="object"||!t.variables||typeof t.variables!=="object")return;var c=":root{color-scheme:"+(t.appearance==="light"?"light":"dark")+";";for(var k in t.variables){if(/^--[a-z0-9-]+$/.test(k))c+=k+":"+String(t.variables[k]).replace(/[;{}<>]/g,"")+";";}s.textContent=c+"}"+b;}window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;if(e.source===window.parent&&d&&d.jsonrpc==="2.0"&&d.method===${JSON.stringify(HOST_CONTEXT_CHANGED_METHOD)}&&p&&p.styles)a({appearance:p.theme,variables:p.styles.variables});});document.addEventListener("click",function(e){var l=e.isTrusted?e.composedPath().find(function(t){return t&&t.matches&&t.matches("a[href]");}):null,u;if(!l)return;var r=l.getAttribute("href");if(r.charAt(0)==="#"){e.preventDefault();location.hash=r;return;}try{u=new URL(r,document.baseURI);}catch(x){return;}e.preventDefault();if(!/^https?:$/.test(u.protocol))return;window.parent.postMessage({jsonrpc:"2.0",id:"bb-link-"+(++n),method:${JSON.stringify(OPEN_LINK_METHOD)},params:{url:u.href}},"*");},true);var h,o,z=function(){var r=document.documentElement,v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);if(v===h)return;h=v;window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(SIZE_CHANGED_METHOD)},params:{height:v}},"*");};if(window.ResizeObserver){o=new ResizeObserver(z);o.observe(document.documentElement);}document.addEventListener("DOMContentLoaded",function(){if(o&&document.body)o.observe(document.body);z();});window.addEventListener("load",z);})();`;

const attribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export interface FrameDocumentOptions {
  theme: FrameTheme;
  baseHref: string;
  fontCss?: string;
}

function headMarkup(scan: string, options: FrameDocumentOptions): string {
  const fonts = (options.fontCss ?? "").replace(/<\/?style/gi, "");
  return [
    /<meta\s[^>]*charset/i.test(scan.slice(0, 4096))
      ? ""
      : '<meta charset="utf-8">',
    /<meta\s[^>]*name\s*=\s*["']?viewport/i.test(scan)
      ? ""
      : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    /<base\s/i.test(scan) ? "" : `<base href="${attribute(options.baseHref)}">`,
    fonts.length > 0 ? `<style>${fonts}</style>` : "",
    `<style id="bb-theme">${rootRule(options.theme)}${BASE_CSS}</style>`,
    `<script>${BOOTSTRAP_SCRIPT}</script>`,
  ].join("");
}

function blankNonMarkup(html: string): string {
  const scan = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi,
    (match) => " ".repeat(match.length),
  );
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let at = 0;
  for (const match of scan.matchAll(/<(\/?)template(?:\s[^>]*)?\/?>/gi)) {
    if (!match[1]) {
      if (depth++ === 0) start = match.index;
    } else if (depth > 0 && --depth === 0) {
      const end = match.index + match[0].length;
      parts.push(scan.slice(at, start), " ".repeat(end - start));
      at = end;
    }
  }
  if (depth > 0) {
    parts.push(scan.slice(at, start), " ".repeat(scan.length - start));
    at = scan.length;
  }
  parts.push(scan.slice(at));
  return parts.join("");
}

export function frameDocument(
  html: string,
  options: FrameDocumentOptions,
): string {
  const scan = blankNonMarkup(html);
  const markup = headMarkup(scan, options);
  const headOpen = /<head(?:\s[^>]*)?>/i.exec(scan);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + markup + html.slice(at);
  }
  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(scan);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype[0].length;
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`;
  }
  return `<!doctype html><head>${markup}</head>${html}`;
}

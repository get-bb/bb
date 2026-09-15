import HTMLtoDOCX from "html-to-docx";
import { marked } from "marked";
import type { FileExportRequest } from "@bb/server-contract";

export const MAX_FILE_EXPORT_CONTENT_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_EXPORT_OUTPUT_BYTES = 25 * 1024 * 1024;

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PRINT_MIME_TYPE = "text/html; charset=utf-8";

export class FileExportInputError extends Error {
  readonly status: 400 | 413 | 422;

  constructor(message: string, status: 400 | 413 | 422) {
    super(message);
    this.name = "FileExportInputError";
    this.status = status;
  }
}

export interface FileExportResult {
  body: Uint8Array;
  contentType: string;
  fileName: string;
}

const URL_ATTRIBUTE_PATTERN =
  /(\s(?:src|href|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const SRCSET_ATTRIBUTE_PATTERN = /(\ssrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const NON_CONTENT_ELEMENT_PATTERN =
  /<(script|style|noscript|template|iframe|object|embed|title)\b[\s\S]*?<\/\1\s*>/gi;
const NON_CONTENT_VOID_ELEMENT_PATTERN = /<(?:link|meta|base)\b[^>]*>/gi;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

const PRINT_STYLE = [
  "@page { size: A4 portrait; margin: 16mm; }",
  "html, body { margin: 0; padding: 0; }",
  "body { color: #111; background: #fff; font-family: system-ui, sans-serif; }",
  "img, svg, table { max-width: 100%; }",
  "pre { white-space: pre-wrap; word-break: break-word; }",
].join("\n");

const POST_MESSAGE_CHANNEL = "bb-document-export";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function absolutizeUrl(value: string, baseHref: string | null): string {
  const trimmed = value.trim();
  if (
    baseHref === null ||
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    SCHEME_PATTERN.test(trimmed)
  ) {
    return value;
  }
  try {
    return new URL(trimmed, baseHref).toString();
  } catch {
    return value;
  }
}

export function absolutizeHtmlUrls(
  html: string,
  baseHref: string | null,
): string {
  if (baseHref === null) {
    return html;
  }
  const withAttributes = html.replace(
    URL_ATTRIBUTE_PATTERN,
    (
      _match,
      prefix: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
    ) => {
      const quote = doubleQuoted === undefined ? "'" : '"';
      const value = doubleQuoted ?? singleQuoted ?? "";
      return `${prefix}${quote}${absolutizeUrl(value, baseHref)}${quote}`;
    },
  );
  return withAttributes.replace(
    SRCSET_ATTRIBUTE_PATTERN,
    (
      _match,
      prefix: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
    ) => {
      const quote = doubleQuoted === undefined ? "'" : '"';
      const value = doubleQuoted ?? singleQuoted ?? "";
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const parts = candidate.trim().split(/\s+/);
          const url = parts.shift() ?? "";
          return [absolutizeUrl(url, baseHref), ...parts].join(" ").trim();
        })
        .join(", ");
      return `${prefix}${quote}${rewritten}${quote}`;
    },
  );
}

export function stripNonContentHtml(html: string): string {
  return html
    .replace(HTML_COMMENT_PATTERN, "")
    .replace(NON_CONTENT_ELEMENT_PATTERN, "")
    .replace(NON_CONTENT_VOID_ELEMENT_PATTERN, "");
}

function renderMarkdownHtml(markdown: string): string {
  const parsed = marked.parse(markdown, { async: false, gfm: true });
  return typeof parsed === "string" ? parsed : "";
}

function buildDocumentHtml(args: {
  content: string;
  sourceKind: FileExportRequest["sourceKind"];
  baseHref: string | null;
}): string {
  const sourceHtml =
    args.sourceKind === "markdown"
      ? renderMarkdownHtml(args.content)
      : args.content;
  return absolutizeHtmlUrls(sourceHtml, args.baseHref);
}

function injectIntoDocument(
  html: string,
  headInjection: string,
  bodyInjection: string,
): string {
  let result = html;
  if (/<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `${headInjection}</head>`);
  } else if (/<head[^>]*>/i.test(result)) {
    result = result.replace(/(<head[^>]*>)/i, `$1${headInjection}`);
  } else if (/<html[^>]*>/i.test(result)) {
    result = result.replace(/(<html[^>]*>)/i, `$1<head>${headInjection}</head>`);
  } else {
    result = `<head>${headInjection}</head>${result}`;
  }
  if (/<\/body>/i.test(result)) {
    return result.replace(/<\/body>/i, `${bodyInjection}</body>`);
  }
  return `${result}${bodyInjection}`;
}

const SETTLE_SCRIPT = [
  "(function(){",
  `var CHANNEL=${JSON.stringify(POST_MESSAGE_CHANNEL)};`,
  `var MODE=${JSON.stringify("__MODE__")};`,
  "function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}",
  "function onLoad(){",
  'if(document.readyState==="complete"){return Promise.resolve();}',
  "return new Promise(function(resolve){window.addEventListener(\"load\",function(){resolve();},{once:true});});",
  "}",
  "function afterFonts(){",
  "try{if(document.fonts&&document.fonts.ready){return document.fonts.ready.catch(function(){});}}catch(error){}",
  "return Promise.resolve();",
  "}",
  "function canvasSignature(canvas){",
  'try{return canvas.toDataURL("image/png");}catch(error){return "tainted";}',
  "}",
  "function settleCharts(){",
  'var canvases=Array.prototype.slice.call(document.querySelectorAll("canvas"));',
  'var svgs=Array.prototype.slice.call(document.querySelectorAll("svg"));',
  "if(canvases.length===0&&svgs.length===0){return wait(300);}",
  "var last=null;var stable=0;var deadline=Date.now()+6000;",
  "function step(){",
  'var signature=canvases.map(canvasSignature).join("|")+"::"+svgs.map(function(svg){return svg.childElementCount;}).join("|");',
  "if(signature===last){stable+=1;}else{stable=0;last=signature;}",
  "if(stable>=3||Date.now()>deadline){return Promise.resolve();}",
  "return wait(200).then(step);",
  "}",
  "return wait(400).then(step);",
  "}",
  "function rasterizeSvg(svg){",
  "var rect=svg.getBoundingClientRect();",
  "var width=Math.max(1,Math.round(rect.width||svg.clientWidth||600));",
  "var height=Math.max(1,Math.round(rect.height||svg.clientHeight||400));",
  "var clone=svg.cloneNode(true);",
  'if(!clone.getAttribute("xmlns")){clone.setAttribute("xmlns","http://www.w3.org/2000/svg");}',
  'clone.setAttribute("width",String(width));clone.setAttribute("height",String(height));',
  "var source=new XMLSerializer().serializeToString(clone);",
  'var url="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(source);',
  "return new Promise(function(resolve){",
  "var image=new Image();",
  "image.onload=function(){",
  "try{",
  'var canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;',
  'canvas.getContext("2d").drawImage(image,0,0,width,height);',
  'resolve({width:width,height:height,dataUrl:canvas.toDataURL("image/png")});',
  "}catch(error){resolve(null);}",
  "};",
  "image.onerror=function(){resolve(null);};",
  "image.src=url;",
  "});",
  "}",
  "function replaceWithImage(element,result){",
  "if(!result){return;}",
  'var image=document.createElement("img");image.src=result.dataUrl;',
  "image.width=result.width;image.height=result.height;",
  "element.parentNode.replaceChild(image,element);",
  "}",
  "function canvasImage(canvas){",
  "var width=canvas.width||canvas.clientWidth;",
  "var height=canvas.height||canvas.clientHeight;",
  "if(!width||!height){return null;}",
  "var scale=Math.min(1,1600/width);",
  "var targetWidth=Math.max(1,Math.round(width*scale));",
  "var targetHeight=Math.max(1,Math.round(height*scale));",
  'var copy=document.createElement("canvas");copy.width=targetWidth;copy.height=targetHeight;',
  'copy.getContext("2d").drawImage(canvas,0,0,targetWidth,targetHeight);',
  'return {width:targetWidth,height:targetHeight,dataUrl:copy.toDataURL("image/png")};',
  "}",
  "function capture(){",
  'var canvases=Array.prototype.slice.call(document.querySelectorAll("canvas"));',
  "canvases.forEach(function(canvas){",
  "try{replaceWithImage(canvas,canvasImage(canvas));}catch(error){}",
  "});",
  'var svgs=Array.prototype.slice.call(document.querySelectorAll("svg"));',
  "return svgs.reduce(function(chain,svg){",
  "return chain.then(function(){return rasterizeSvg(svg).then(function(result){replaceWithImage(svg,result);});});",
  "},Promise.resolve()).then(function(){",
  'return "<!DOCTYPE html>"+document.documentElement.outerHTML;',
  "});",
  "}",
  "function finish(){",
  'if(MODE==="capture"){',
  "capture().then(function(html){",
  'parent.postMessage({channel:CHANNEL,ok:true,html:html},"*");',
  "}).catch(function(error){",
  'parent.postMessage({channel:CHANNEL,ok:false,error:String((error&&error.message)||error)},"*");',
  "});",
  "return;",
  "}",
  "window.focus();window.print();",
  "}",
  "onLoad().then(afterFonts).then(settleCharts).then(finish).catch(function(){finish();});",
  "})();",
].join("");

export function buildExportDocument(
  html: string,
  baseHref: string | null,
  mode: "print" | "capture",
): string {
  const head = [
    '<meta charset="utf-8">',
    baseHref === null
      ? ""
      : `<base href="${escapeAttribute(baseHref)}">`,
    `<style>${PRINT_STYLE}</style>`,
  ].join("");
  const script = `<script>${SETTLE_SCRIPT.replace(
    JSON.stringify("__MODE__"),
    JSON.stringify(mode),
  )}</script>`;
  const isDocument =
    /<html[\s>]/i.test(html) ||
    /<head[\s>]/i.test(html) ||
    /<body[\s>]/i.test(html);
  if (!isDocument) {
    return `<!DOCTYPE html><html><head>${head}</head><body>${html}${script}</body></html>`;
  }
  return injectIntoDocument(html, head, script);
}

export const buildPrintDocument = (
  html: string,
  baseHref: string | null,
): string => buildExportDocument(html, baseHref, "print");

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new FileExportInputError("Word conversion returned no bytes.", 422);
}

function safeBaseName(filename: string | undefined, fallback: string): string {
  const raw = (filename ?? "").trim();
  const withoutDirectory = raw.split(/[\\/]/).pop() ?? "";
  const withoutExtension = withoutDirectory.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const cleaned = withoutExtension
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim();
  return cleaned.length === 0 ? fallback : cleaned.slice(0, 200);
}

export async function createFileExport(
  request: FileExportRequest,
): Promise<FileExportResult> {
  if (
    Buffer.byteLength(request.content, "utf8") >
    MAX_FILE_EXPORT_CONTENT_BYTES
  ) {
    throw new FileExportInputError(
      `Export content is too large (max ${MAX_FILE_EXPORT_CONTENT_BYTES} bytes).`,
      413,
    );
  }
  const baseHref = request.baseHref ?? null;
  const html = buildDocumentHtml({
    content: request.content,
    sourceKind: request.sourceKind,
    baseHref,
  });
  const baseName = safeBaseName(request.filename, "document");

  if (request.format === "print" || request.format === "capture") {
    const body = new TextEncoder().encode(
      buildExportDocument(html, baseHref, request.format),
    );
    return {
      body,
      contentType: PRINT_MIME_TYPE,
      fileName: `${baseName}.html`,
    };
  }

  let converted: unknown;
  try {
    converted = await HTMLtoDOCX(stripNonContentHtml(html), null, {
      font: "Arial",
      fontSize: 24,
      orientation: "portrait",
      pageSize: { width: 11906, height: 16838 },
      table: { row: { cantSplit: true } },
    });
  } catch (error) {
    throw new FileExportInputError(
      `Word conversion failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      422,
    );
  }
  const body = toUint8Array(converted);
  if (body.byteLength > MAX_FILE_EXPORT_OUTPUT_BYTES) {
    throw new FileExportInputError(
      `Export output is too large (max ${MAX_FILE_EXPORT_OUTPUT_BYTES} bytes).`,
      413,
    );
  }
  return { body, contentType: DOCX_MIME_TYPE, fileName: `${baseName}.docx` };
}

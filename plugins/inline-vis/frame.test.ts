// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  FRAME_HEIGHT_BEFORE_FIRST_REPORT,
  FRAME_MAX_HEIGHT,
  FRAME_MIN_HEIGHT,
  FRAME_THEME_TOKENS,
  frameDocument,
  frameHeight,
  frameResult,
  frameTheme,
  frameThemeMessage,
  frameThemesEqual,
  readFrameContentHeight,
  readFrameLinkRequest,
} from "./frame";

const theme = frameTheme("dark", (token) =>
  token === "--background" ? " oklch(0.2 0 0) " : `value-of(${token})`,
);
const options = {
  theme,
  baseHref: "http://bb.test/api/v1/files/charts/a.html",
};

it("reads every variable from an app token and adds the chart series", () => {
  expect(theme.appearance).toBe("dark");
  expect(theme.variables["--background"]).toBe("oklch(0.2 0 0)");
  expect(theme.variables["--brand"]).toBe("value-of(--timeline-accent)");
  expect(theme.variables["--chart-1"]).toBe("value-of(--timeline-accent)");
  expect(theme.variables["--chart-6"]).toMatch(/^#[0-9a-f]{6}$/);
  expect(Object.keys(theme.variables)).toHaveLength(
    FRAME_THEME_TOKENS.length + 5,
  );
  const missing = frameTheme("light", () => "");
  expect(Object.keys(missing.variables)).toHaveLength(5);
  expect(frameThemesEqual(theme, { ...theme })).toBe(true);
  expect(frameThemesEqual(theme, missing)).toBe(false);
});

it("puts the theme, the base URL and the bootstrap first in the head", () => {
  const page =
    "<!doctype html><html><head><title>t</title><style>:root{--x:1}</style></head><body>hi</body></html>";
  const framed = frameDocument(page, options);
  const head = framed.indexOf("<head>") + "<head>".length;
  const base = framed.indexOf(
    '<base href="http://bb.test/api/v1/files/charts/a.html">',
  );
  const themeStyle = framed.indexOf('<style id="bb-theme">');
  const script = framed.indexOf("<script>");
  const own = framed.indexOf("<style>:root{--x:1}</style>");
  expect(framed.indexOf('<meta charset="utf-8">')).toBe(head);
  expect(base).toBeGreaterThan(head);
  expect(themeStyle).toBeGreaterThan(base);
  expect(script).toBeGreaterThan(themeStyle);
  expect(own).toBeGreaterThan(script);
  expect(framed).toContain(
    ":root{color-scheme:dark;--background:oklch(0.2 0 0);",
  );
  expect(framed.endsWith("<body>hi</body></html>")).toBe(true);
});

it("gives a page without a head one, and keeps a page's own base", () => {
  expect(frameDocument("<p>hi</p>", options)).toMatch(
    /^<!doctype html><head>.*<\/head><p>hi<\/p>$/s,
  );
  expect(frameDocument("<!DOCTYPE html>\n<p>hi</p>", options)).toMatch(
    /^<!DOCTYPE html><head>.*<\/head>\n<p>hi<\/p>$/s,
  );
  expect(frameDocument("<html lang=en><body>x</body></html>", options)).toMatch(
    /^<html lang=en><head>.*<\/head><body>x<\/body><\/html>$/s,
  );
  const own = '<head><base href="/elsewhere/"></head>';
  expect(frameDocument(own, options).match(/<base /g)).toHaveLength(1);
});

it("is not fooled by a head tag inside a comment, script or template", () => {
  const page =
    "<!-- <head> --><script>var s = '<head>';</script><template><head></head></template><html><body>x</body></html>";
  const framed = frameDocument(page, options);
  expect(
    framed.startsWith("<!-- <head> --><script>var s = '<head>';</script>"),
  ).toBe(true);
  expect(framed).toContain('<html><head><meta charset="utf-8">');
  expect(framed.match(/id="bb-theme"/g)).toHaveLength(1);
});

it("keeps a theme value or a font rule from closing the style element", () => {
  const hostile = {
    appearance: "light" as const,
    variables: { "--background": "red;}</style><script>alert(1)</script>" },
  };
  const framed = frameDocument("<p>x</p>", {
    ...options,
    theme: hostile,
    fontCss: "@font-face{}</style><script>alert(2)</script>",
  });
  expect(framed).not.toContain("alert(1)</script>");
  expect(framed).not.toContain("</style><script>alert(2)");
  expect(framed.match(/<script>/g)).toHaveLength(2);
});

it("fits the frame to the page, under the agent's cap", () => {
  const none = {
    requested: null,
    contentHeight: undefined,
    remembered: undefined,
  };
  expect(frameHeight(none)).toBe(FRAME_HEIGHT_BEFORE_FIRST_REPORT);
  expect(frameHeight({ ...none, requested: 480 })).toBe(480);
  expect(frameHeight({ ...none, remembered: 600 })).toBe(600);
  expect(frameHeight({ ...none, contentHeight: 912.4 })).toBe(912);
  expect(frameHeight({ ...none, contentHeight: 300, remembered: 600 })).toBe(
    300,
  );
  expect(frameHeight({ ...none, requested: 480, contentHeight: 300 })).toBe(
    300,
  );
  expect(frameHeight({ ...none, requested: 480, contentHeight: 900 })).toBe(
    480,
  );
  expect(frameHeight({ ...none, contentHeight: 12 })).toBe(FRAME_MIN_HEIGHT);
  expect(frameHeight({ ...none, contentHeight: 9000 })).toBe(FRAME_MAX_HEIGHT);
});

it("reads a page's messages and ignores anything else", () => {
  const size = (height: unknown) => ({
    jsonrpc: "2.0",
    method: "ui/notifications/size-changed",
    params: { height },
  });
  expect(readFrameContentHeight(size(420))).toBe(420);
  for (const data of [size(0), size("420"), size(Infinity), null, "x", {}]) {
    expect(readFrameContentHeight(data)).toBeUndefined();
  }
  const link = (url: unknown, id: unknown = "bb-link-1") => ({
    jsonrpc: "2.0",
    id,
    method: "ui/open-link",
    params: { url },
  });
  expect(readFrameLinkRequest(link("https://example.com/a"))).toEqual({
    id: "bb-link-1",
    url: "https://example.com/a",
  });
  for (const data of [
    link("javascript:alert(1)"),
    link("file:///etc/passwd"),
    link("https://example.com", null),
    size(420),
  ]) {
    expect(readFrameLinkRequest(data)).toBeUndefined();
  }
  expect(frameResult(7)).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  expect(frameThemeMessage(theme)).toMatchObject({
    method: "ui/notifications/host-context-changed",
    params: { theme: "dark", styles: { variables: theme.variables } },
  });
});

it("ships a bootstrap that reports the page size and applies a theme sent by the host only", () => {
  const framed = frameDocument("<p>hi</p>", options);
  const script = /<script>([\s\S]*?)<\/script>/.exec(framed)?.[1] ?? "";
  const page = new DOMParser().parseFromString(framed, "text/html");
  const posted: unknown[] = [];
  const host = { postMessage: (data: unknown) => posted.push(data) };
  const pageWindow = Object.assign(new EventTarget(), { parent: host });
  new Function("window", "document", script)(pageWindow, page);
  const themeStyle = () => page.getElementById("bb-theme")?.textContent ?? "";
  const send = (data: unknown, source: unknown) => {
    pageWindow.dispatchEvent(
      Object.assign(new Event("message"), { data, source }),
    );
  };

  pageWindow.dispatchEvent(new Event("load"));
  expect(posted).toEqual([
    {
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { height: expect.any(Number) },
    },
  ]);

  const light = frameTheme("light", (token) =>
    token === "--background" ? "white;}body{display:none" : "",
  );
  send(frameThemeMessage(light), pageWindow);
  expect(themeStyle()).toContain(":root{color-scheme:dark;");

  send(frameThemeMessage(light), host);
  expect(themeStyle()).toContain(
    ":root{color-scheme:light;--background:whitebodydisplay:none;",
  );
  expect(themeStyle()).toContain("body{margin:0}");
});

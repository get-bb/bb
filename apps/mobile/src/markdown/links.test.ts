import { describe, expect, it } from "vitest";
import {
  classifyMarkdownLink,
  parseLocalFileHref,
  resolveInlineCodeMarkdownFileHref,
} from "./links";

const OPTIONS = { rewriteLocalhostLinks: false, serverHostname: undefined };

describe("parseLocalFileHref", () => {
  it("parses absolute paths with every line-suffix grammar", () => {
    expect(parseLocalFileHref("/repo/src/app.ts")).toEqual({
      path: "/repo/src/app.ts",
      lineRange: null,
    });
    expect(parseLocalFileHref("/repo/src/app.ts:12")).toEqual({
      path: "/repo/src/app.ts",
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
    });
    expect(parseLocalFileHref("/repo/src/app.ts:12:4")).toMatchObject({
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
    });
    expect(parseLocalFileHref("/repo/src/app.ts:3-9")).toMatchObject({
      lineRange: { startLineNumber: 3, endLineNumber: 9 },
    });
    expect(parseLocalFileHref("/repo/src/app.ts#L5-L7")).toMatchObject({
      path: "/repo/src/app.ts",
      lineRange: { startLineNumber: 5, endLineNumber: 7 },
    });
    expect(parseLocalFileHref("/repo/README.md#usage")).toEqual({
      path: "/repo/README.md",
      lineRange: null,
    });
    expect(parseLocalFileHref("file:///repo/a%20b.ts#L2")).toEqual({
      path: "/repo/a b.ts",
      lineRange: { startLineNumber: 2, endLineNumber: 2 },
    });
  });

  it("rejects app-looking paths, directories, hosts, and bad ranges", () => {
    expect(parseLocalFileHref("/settings")).toBeNull();
    expect(parseLocalFileHref("/api/v1/threads")).toBeNull();
    expect(parseLocalFileHref("/repo/src/")).toBeNull();
    expect(parseLocalFileHref("//host/share.txt")).toBeNull();
    expect(parseLocalFileHref("file://host/x.ts")).toBeNull();
    expect(parseLocalFileHref("/repo/a.ts:9-3")).toBeNull();
    expect(parseLocalFileHref("/repo/a.ts?x=1")).toBeNull();
    // Trusted-host rule: bare paths need a file-looking basename, file:// does not.
    expect(parseLocalFileHref("file:///usr/bin/env")).toEqual({
      path: "/usr/bin/env",
      lineRange: null,
    });
  });
});

describe("classifyMarkdownLink", () => {
  it("classifies local files, external urls, and inert relative links", () => {
    expect(classifyMarkdownLink("/repo/src/app.ts:3", OPTIONS)).toMatchObject({
      kind: "local-file",
      path: "/repo/src/app.ts",
      lineRange: { startLineNumber: 3, endLineNumber: 3 },
    });
    expect(classifyMarkdownLink("https://example.com/a", OPTIONS)).toEqual({
      kind: "external",
      href: "https://example.com/a",
      url: "https://example.com/a",
    });
    expect(classifyMarkdownLink("mailto:a@b.c", OPTIONS).kind).toBe("external");
    expect(classifyMarkdownLink("#usage", OPTIONS)).toEqual({
      kind: "relative",
      href: "#usage",
    });
    expect(classifyMarkdownLink("docs/guide.md", OPTIONS).kind).toBe(
      "relative",
    );
    // Line suffix beats scheme detection.
    expect(classifyMarkdownLink("Cargo.lock:14:33", OPTIONS).kind).toBe(
      "relative",
    );
  });

  it("blocks schemes outside the allow-list so they never reach Linking.openURL", () => {
    // Same allow-list as react-markdown's defaultUrlTransform on the web.
    for (const href of [
      "https://example.com/a",
      "HTTP://EXAMPLE.COM/",
      "mailto:a@b.c",
      "irc://irc.example/#bb",
      "xmpp:user@example.com",
    ]) {
      expect(classifyMarkdownLink(href, OPTIONS).kind, href).toBe("external");
    }
    for (const href of [
      "tel:+15555550100",
      "sms:+15555550100?body=hi",
      "facetime:user@example.com",
      "shortcuts://run-shortcut?name=Wipe",
      "bb://connect?code=ABCD-EFGH&apex=https://evil.example",
      "bb://settings/servers/add?serverUrl=https://evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file://host/x.ts",
      "com.example.app://callback",
    ]) {
      expect(classifyMarkdownLink(href, OPTIONS), href).toEqual({
        kind: "blocked",
        href,
      });
    }
  });

  it("rewrites loopback links to the server host only when enabled", () => {
    const enabled = {
      rewriteLocalhostLinks: true,
      serverHostname: "mac.tail1234.ts.net",
    };
    expect(
      classifyMarkdownLink("http://localhost:5173/app?x=1", enabled),
    ).toEqual({
      kind: "external",
      href: "http://mac.tail1234.ts.net:5173/app?x=1",
      url: "http://mac.tail1234.ts.net:5173/app?x=1",
    });
    expect(
      classifyMarkdownLink("http://127.0.0.1:3000/", {
        ...enabled,
        rewriteLocalhostLinks: false,
      }).href,
    ).toBe("http://127.0.0.1:3000/");
    expect(
      classifyMarkdownLink("http://127.0.0.1:3000/", {
        rewriteLocalhostLinks: true,
        serverHostname: undefined,
      }).href,
    ).toBe("http://127.0.0.1:3000/");
    expect(classifyMarkdownLink("https://example.com", enabled).href).toBe(
      "https://example.com",
    );
  });
});

describe("resolveInlineCodeMarkdownFileHref", () => {
  it("only promotes whole absolute markdown paths", () => {
    expect(resolveInlineCodeMarkdownFileHref("/repo/docs/plan.md")).toBe(
      "/repo/docs/plan.md",
    );
    expect(resolveInlineCodeMarkdownFileHref("/repo/src/app.ts")).toBeNull();
    expect(resolveInlineCodeMarkdownFileHref("docs/plan.md")).toBeNull();
    expect(resolveInlineCodeMarkdownFileHref(" /repo/docs/plan.md")).toBeNull();
  });
});

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { registerStaticAppRoutes, renderJsonScriptElement } from "./server.js";

function scriptJson(html: string): unknown {
  const match =
    /<script type="application\/json" id="boot">(.*?)<\/script>/su.exec(html);
  return match === null ? null : JSON.parse(match[1] ?? "");
}

describe("app shell serving", () => {
  const shellHtml =
    "<!doctype html><html><head><title>bb</title></head><body><p>build-a</p></body></html>";
  let dir: string;
  let app: Hono;
  let shellHead: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bb-static-shell-"));
    await writeFile(join(dir, "index.html"), shellHtml);
    shellHead = '<meta name="bb-test" content="one">';
    app = new Hono();
    registerStaticAppRoutes(app, dir, () => shellHead);
  });

  it("serves the shell with the rendered head, directly and on the SPA fallback", async () => {
    for (const path of ["/", "/index.html", "/threads/some-thread"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{32}"$/u);
      expect(await res.text()).toBe(
        '<!doctype html><html><head><title>bb</title><meta name="bb-test" content="one"></head><body><p>build-a</p></body></html>',
      );
    }
  });

  it("answers a matching If-None-Match with an empty 304 on both paths", async () => {
    const first = await app.request("/");
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();

    for (const path of ["/", "/threads/some-thread"]) {
      const res = await app.request(path, {
        headers: { "if-none-match": etag ?? "" },
      });
      expect(res.status).toBe(304);
      expect(res.headers.get("etag")).toBe(etag);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect((await res.arrayBuffer()).byteLength).toBe(0);
    }
  });

  it("rotates the ETag when a new build lands, so old validators refetch", async () => {
    const first = await app.request("/");
    const oldEtag = first.headers.get("etag") ?? "";

    const nextBuild =
      "<!doctype html><html><head><title>bb</title></head><body><p>build-b</p></body></html>";
    await writeFile(join(dir, "index.html"), nextBuild);

    const res = await app.request("/", {
      headers: { "if-none-match": oldEtag },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).not.toBe(oldEtag);
    expect(await res.text()).toContain("build-b");
  });

  it("rotates the ETag when the rendered head changes, so a cached shell never carries a stale plugin list", async () => {
    const first = await app.request("/threads/t");
    const oldEtag = first.headers.get("etag") ?? "";

    shellHead = '<meta name="bb-test" content="two">';
    const res = await app.request("/threads/t", {
      headers: { "if-none-match": oldEtag },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).not.toBe(oldEtag);
    expect(await res.text()).toContain('content="two"');
  });

  it("inserts the rendered head verbatim when it contains replacement patterns", async () => {
    shellHead = renderJsonScriptElement("boot", {
      plugins: [{ id: "p", name: "$' $& $$ $` cost" }],
    });

    const html = await (await app.request("/")).text();

    expect(html).toBe(
      `<!doctype html><html><head><title>bb</title>${shellHead}</head><body><p>build-a</p></body></html>`,
    );
    expect(scriptJson(html)).toEqual({
      plugins: [{ id: "p", name: "$' $& $$ $` cost" }],
    });
  });

  it("keeps /assets/ misses as 404 instead of the SPA fallback", async () => {
    const res = await app.request("/assets/stale-chunk.js");
    expect(res.status).toBe(404);
  });
});

describe("renderJsonScriptElement", () => {
  it("embeds inert JSON that markup inside the value cannot escape", () => {
    const value = {
      plugins: [{ id: "evil", name: "</script><script>alert(1)</script><!--" }],
    };

    const html = renderJsonScriptElement("boot", value);

    expect(html.match(/<\/script>/gu)).toHaveLength(1);
    expect(html).not.toContain("<!--");
    expect(scriptJson(html)).toEqual(value);
  });
});

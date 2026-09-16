import { createServer } from "node:http";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unfurlMeta } from "../landing/site.js";
import { marketplaceOgCard, serveMarketplaceOg } from "./marketplace-og.js";
import { MARKETPLACE_V2_FIXTURE } from "./marketplace-v2.fixture.js";

const entry = MARKETPLACE_V2_FIXTURE.plugins[0]!;

describe("marketplace share cards", () => {
  it("uses the same plugin-specific image for Open Graph and Twitter", () => {
    const meta = unfurlMeta(
      entry.displayName,
      entry.description,
      `/marketplace/${entry.id}`,
      {
        path: `/marketplace/og/${entry.id}`,
        width: 1200,
        height: 630,
        alt: entry.description,
      },
    );
    expect(meta).toContainEqual({
      property: "og:image",
      content: `https://web.test/marketplace/og/${entry.id}`,
    });
    expect(meta).toContainEqual({
      name: "twitter:image",
      content: `https://web.test/marketplace/og/${entry.id}`,
    });
    expect(meta).toContainEqual({
      property: "og:image:width",
      content: "1200",
    });
  });

  it("includes plugin details with and without a screenshot", () => {
    for (const screenshot of [null, "https://example.com/screenshot.png"]) {
      const html = renderToStaticMarkup(marketplaceOgCard(entry, screenshot));
      expect(html).toContain(entry.displayName);
      expect(html).toContain(entry.author.name);
      expect(html.includes("<img")).toBe(screenshot !== null);
    }
  });

  it("does not render a misleading card for missing plugins or unavailable catalogs", async () => {
    expect(
      (await serveMarketplaceOg({ status: "unavailable" }, entry.id)).status,
    ).toBe(503);
    expect(
      (
        await serveMarketplaceOg(
          {
            status: "available",
            manifest: MARKETPLACE_V2_FIXTURE,
            stats: null,
          },
          "missing",
        )
      ).status,
    ).toBe(404);
  });

  it("falls back to a text card when the screenshot is unavailable", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test address");
      const manifest = {
        ...MARKETPLACE_V2_FIXTURE,
        plugins: [
          {
            ...entry,
            screenshots: [`http://127.0.0.1:${address.port}/missing.png`],
          },
        ],
      };
      const response = await serveMarketplaceOg(
        { status: "available", manifest, stats: null },
        entry.id,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("renders an actual PNG for a plugin without screenshots", async () => {
    const response = await serveMarketplaceOg(
      {
        status: "available",
        manifest: {
          ...MARKETPLACE_V2_FIXTURE,
          plugins: [{ ...entry, screenshots: [] }],
        },
        stats: null,
      },
      entry.id,
    );
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    const dimensions = new DataView(bytes.buffer);
    expect(dimensions.getUint32(16)).toBe(1200);
    expect(dimensions.getUint32(20)).toBe(630);
  });
});

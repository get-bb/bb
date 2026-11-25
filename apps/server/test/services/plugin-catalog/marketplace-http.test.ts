import type { LookupAddress, LookupOptions } from "node:dns";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestListener,
} from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assertPublicMarketplaceAddress,
  assertPublicMarketplaceUrl,
  boundedResponseBytes,
  boundedResponseJson,
  createPublicMarketplaceFetch,
  createPublicMarketplaceLookup,
  type MarketplaceFetch,
  type PublicMarketplaceFetchDeps,
} from "../../../src/services/plugin-catalog/marketplace-http.js";

async function withMarketplaceServer(
  handler: RequestListener,
  deps: Omit<PublicMarketplaceFetchDeps, "request">,
  run: (fetchMarketplace: MarketplaceFetch) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(
      createPublicMarketplaceFetch({
        ...deps,
        request: (url, options, callback) =>
          httpRequest(
            { ...options, host: "127.0.0.1", port, path: url.pathname },
            callback,
          ),
      }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const TEST_TIMEOUTS = { responseMs: 2_000, stallMs: 150 };
const CATALOG_URL = "https://marketplace.test/marketplace.json";

function getCatalog(fetchMarketplace: MarketplaceFetch): Promise<Response> {
  return fetchMarketplace(CATALOG_URL, {
    method: "GET",
    headers: new Headers({ accept: "application/json" }),
  });
}

describe("marketplace HTTP policy", () => {
  it.each([
    "https://localhost/marketplace.json",
    "https://catalog.localhost/marketplace.json",
    "https://127.0.0.1/marketplace.json",
    "https://[::1]/marketplace.json",
    "https://example.com:8443/marketplace.json",
    "https://user:secret@example.com/marketplace.json",
  ])("refuses a non-public target before the request: %s", (url) => {
    expect(() => assertPublicMarketplaceUrl(url)).toThrow();
  });

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
  ])("refuses a private or special network address: %s", (address) => {
    expect(() => assertPublicMarketplaceAddress(address)).toThrow(
      /non-public/u,
    );
  });

  it("accepts a public target on the standard HTTPS port", () => {
    expect(
      assertPublicMarketplaceUrl(
        "https://marketplace.example.com/marketplace.json",
      ).toString(),
    ).toBe("https://marketplace.example.com/marketplace.json");
    expect(() => assertPublicMarketplaceAddress("93.184.216.34")).not.toThrow();
    expect(() =>
      assertPublicMarketplaceAddress("2606:2800:220:1:248:1893:25c8:1946"),
    ).not.toThrow();
  });

  it("rejects a DNS answer when any candidate address is private", async () => {
    const lookup = createPublicMarketplaceLookup((_hostname, callback) => {
      callback(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    });
    const result = new Promise<LookupAddress[]>((resolve, reject) => {
      lookup(
        "marketplace.example.com",
        { all: true } as LookupOptions,
        (error, addresses) => {
          if (error !== null) {
            reject(error);
            return;
          }
          resolve(addresses as LookupAddress[]);
        },
      );
    });
    await expect(result).rejects.toThrow(/non-public address 127\.0\.0\.1/u);
  });

  it("refuses registry JSON before an oversized body is read", async () => {
    const response = new Response("{}", {
      headers: { "content-length": "1025" },
    });
    await expect(
      boundedResponseJson(response, 1024, "npm registry metadata"),
    ).rejects.toThrow(/exceeds 1024 bytes/u);
  });

  it("settles a bodyless response so a late timeout cannot abort the socket", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(304);
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;
    const socketErrors: Error[] = [];
    const controller = new AbortController();
    let finishRequest!: () => void;
    const requestClosed = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    const fetchMarketplace = createPublicMarketplaceFetch({
      request: (url, options, callback) => {
        const outgoing = httpRequest(
          { ...options, host: "127.0.0.1", port, path: url.pathname },
          callback,
        );
        outgoing.once("close", finishRequest);
        outgoing.on("socket", (socket) => {
          socket.on("error", (error: Error) => socketErrors.push(error));
        });
        return outgoing;
      },
    });
    try {
      const response = await fetchMarketplace(
        "https://marketplace.test/marketplace.json",
        {
          method: "GET",
          headers: new Headers({ accept: "application/json" }),
          signal: controller.signal,
        },
      );
      expect(response.status).toBe(304);
      await response.body?.cancel();
      await requestClosed;
      controller.abort(new DOMException("Late timeout", "TimeoutError"));
      expect(socketErrors).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps reading a slow body that keeps making progress", async () => {
    const chunks = Array.from({ length: 12 }, (_, index) => `chunk-${index};`);
    await withMarketplaceServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        let index = 0;
        const timer = setInterval(() => {
          const chunk = chunks[index];
          index += 1;
          if (chunk === undefined) {
            clearInterval(timer);
            response.end();
            return;
          }
          response.write(chunk);
        }, 50);
      },
      { timeouts: TEST_TIMEOUTS },
      async (fetchMarketplace) => {
        const started = Date.now();
        const response = await getCatalog(fetchMarketplace);
        expect(await response.text()).toBe(chunks.join(""));
        expect(Date.now() - started).toBeGreaterThan(TEST_TIMEOUTS.stallMs * 3);
      },
    );
  });

  it("aborts a body that stops sending data", async () => {
    await withMarketplaceServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"partial":');
      },
      { timeouts: TEST_TIMEOUTS },
      async (fetchMarketplace) => {
        const response = await getCatalog(fetchMarketplace);
        await expect(response.text()).rejects.toMatchObject({
          name: "TimeoutError",
          message: `request timed out: no data received for ${TEST_TIMEOUTS.stallMs}ms`,
        });
      },
    );
  });

  it("aborts a request whose response never starts", async () => {
    await withMarketplaceServer(
      () => {},
      { timeouts: { responseMs: 100, stallMs: 5_000 } },
      async (fetchMarketplace) => {
        await expect(getCatalog(fetchMarketplace)).rejects.toMatchObject({
          name: "TimeoutError",
          message: "request timed out: no response within 100ms",
        });
      },
    );
  });

  it.each([
    ["gzip", (body: Buffer) => gzipSync(body)],
    ["br", (body: Buffer) => brotliCompressSync(body)],
  ] as const)("requests and decodes a %s body", async (encoding, encode) => {
    const catalog = JSON.stringify({ plugins: ["a".repeat(10_000)] });
    let requestHeaders: IncomingHttpHeaders = {};
    await withMarketplaceServer(
      (request, response) => {
        requestHeaders = request.headers;
        const body = encode(Buffer.from(catalog));
        response.writeHead(200, {
          "content-type": "application/json",
          "content-encoding": encoding,
          "content-length": String(body.byteLength),
          etag: '"v1"',
        });
        response.end(body);
      },
      { timeouts: TEST_TIMEOUTS },
      async (fetchMarketplace) => {
        const response = await getCatalog(fetchMarketplace);
        expect(response.headers.get("content-encoding")).toBeNull();
        expect(response.headers.get("content-length")).toBeNull();
        expect(response.headers.get("etag")).toBe('"v1"');
        expect(await response.text()).toBe(catalog);
      },
    );
    expect(requestHeaders["accept-encoding"]).toBe("gzip, deflate, br");
  });

  it("applies byte caps to the decompressed size", async () => {
    const bomb = gzipSync(Buffer.alloc(4 * 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(16 * 1024);
    await withMarketplaceServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-encoding": "gzip",
          "content-length": String(bomb.byteLength),
        });
        response.end(bomb);
      },
      { timeouts: TEST_TIMEOUTS, maxResponseBytes: 1024 * 1024 },
      async (fetchMarketplace) => {
        await expect(
          boundedResponseBytes(
            await getCatalog(fetchMarketplace),
            256 * 1024,
            "icon",
          ),
        ).rejects.toThrow(/icon exceeds 262144 bytes/u);
        await expect(
          (await getCatalog(fetchMarketplace)).text(),
        ).rejects.toThrow(/marketplace response exceeds 1048576 bytes/u);
      },
    );
  });
});

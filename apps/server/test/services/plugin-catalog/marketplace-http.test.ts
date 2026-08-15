import type { LookupAddress, LookupOptions } from "node:dns";
import { describe, expect, it } from "vitest";
import {
  assertPublicMarketplaceAddress,
  assertPublicMarketplaceUrl,
  boundedResponseJson,
  createPublicMarketplaceLookup,
} from "../../../src/services/plugin-catalog/marketplace-http.js";

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
});

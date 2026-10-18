import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECT_BASE_URL,
  resolveDefaultConnectBaseUrl,
} from "../src/index.js";

describe("resolveDefaultConnectBaseUrl", () => {
  it("uses the local Cloud origin only in development", () => {
    expect(
      resolveDefaultConnectBaseUrl({
        NODE_ENV: "development",
        BB_DEV_CONNECT_BASE_URL: "http://bb.localhost:42745/",
      }),
    ).toBe("http://bb.localhost:42745");
    expect(
      resolveDefaultConnectBaseUrl({
        NODE_ENV: "production",
        BB_DEV_CONNECT_BASE_URL: "http://bb.localhost:42745",
      }),
    ).toBe(DEFAULT_CONNECT_BASE_URL);
    expect(resolveDefaultConnectBaseUrl({ NODE_ENV: "development" })).toBe(
      DEFAULT_CONNECT_BASE_URL,
    );
    expect(
      resolveDefaultConnectBaseUrl({
        NODE_ENV: "development",
        BB_DEV_CONNECT_BASE_URL: "https://vibecodethis.site/",
      }),
    ).toBe("https://vibecodethis.site");
  });

  it("rejects non-local or non-origin development values", () => {
    for (const value of [
      "https://bb.localhost:42745",
      "http://getbb.app:42745",
      "http://bb.localhost:42745/dashboard",
      "http://vibecodethis.site",
      "https://sawyer.vibecodethis.site",
      "https://vibecodethis.site/dashboard",
      "not a url",
    ]) {
      expect(() =>
        resolveDefaultConnectBaseUrl({
          NODE_ENV: "development",
          BB_DEV_CONNECT_BASE_URL: value,
        }),
      ).toThrow(
        "BB_DEV_CONNECT_BASE_URL must be an http://bb.localhost:<port> origin or https://vibecodethis.site",
      );
    }
  });
});

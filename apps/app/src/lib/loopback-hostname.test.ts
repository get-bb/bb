import { describe, expect, it } from "vitest";
import { isLocalOnlyUrl, isLoopbackHostname } from "./loopback-hostname";

describe("isLoopbackHostname", () => {
  it.each([
    "localhost",
    "LOCALHOST.",
    "bb.localhost",
    "pr1608.bb.localhost",
    "127.0.0.1",
    "127.255.255.254",
    "::1",
    "[::1]",
  ])("recognizes %s as loopback", (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(true);
  });

  it.each([
    "localhost.example.com",
    "notlocalhost",
    "127.example.com",
    "127.0.0.256",
    "0127.0.0.1",
    "128.0.0.1",
  ])("does not classify %s as loopback", (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(false);
  });
});

describe("isLocalOnlyUrl", () => {
  it.each([
    "http://127.0.0.1:38886",
    "http://localhost:38886",
    "http://[::1]:38886",
    "http://0.0.0.0:38886",
    "http://[::]:38886",
    "http://[::ffff:127.0.0.1]:38886",
  ])("recognizes %s as local-only", (url) => {
    expect(isLocalOnlyUrl(url)).toBe(true);
  });

  it.each([
    "https://mac.tailnet.ts.net",
    "http://192.168.1.10:38886",
    "http://[::ffff:192.168.1.10]:38886",
    "not a url",
  ])("does not treat %s as local-only", (url) => {
    expect(isLocalOnlyUrl(url)).toBe(false);
  });
});

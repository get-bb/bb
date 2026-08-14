import { describe, expect, it } from "vitest";
import { isLoopbackHostname } from "./loopback-hostname";

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

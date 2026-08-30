import { describe, expect, it } from "vitest";
import {
  isConnectServerUrl,
  isTrustedSwitchOrigin,
} from "../src/connect-target-origin.js";

describe("isConnectServerUrl", () => {
  it("routes a pasted Connect handle URL through Connect authentication", () => {
    expect(isConnectServerUrl("https://sawyer.getbb.app")).toBe(true);
    expect(isConnectServerUrl("https://sawyer.getbb.app/")).toBe(true);
    expect(isConnectServerUrl("https://sawyer--8000.getbb.app")).toBe(true);
    expect(isConnectServerUrl("https://getbb.app")).toBe(true);
  });

  it("leaves non-Connect origins on the unauthenticated path", () => {
    expect(isConnectServerUrl("http://127.0.0.1:8000")).toBe(false);
    expect(isConnectServerUrl("https://example.com")).toBe(false);
    expect(isConnectServerUrl("https://bb.localhost:8000")).toBe(false);
  });

  it("does not treat a lookalike host as a Connect server", () => {
    expect(isConnectServerUrl("https://getbb.app.evil.com")).toBe(false);
    expect(isConnectServerUrl("https://notgetbb.app")).toBe(false);
    expect(isConnectServerUrl("http://sawyer.getbb.app")).toBe(false);
    expect(isConnectServerUrl("not-a-url")).toBe(false);
  });
});

describe("isTrustedSwitchOrigin", () => {
  const localServers = ["http://127.0.0.1:38886", "http://localhost:38886"];

  it("trusts the local builtin server origin", () => {
    expect(
      isTrustedSwitchOrigin("http://127.0.0.1:38886/threads", localServers),
    ).toBe(true);
    expect(isTrustedSwitchOrigin("http://localhost:38886/", localServers)).toBe(
      true,
    );
  });

  it("trusts a getbb.app origin", () => {
    expect(
      isTrustedSwitchOrigin("https://sawyer.getbb.app/threads", localServers),
    ).toBe(true);
    expect(isTrustedSwitchOrigin("https://getbb.app", localServers)).toBe(true);
  });

  it("rejects an arbitrary custom origin", () => {
    expect(isTrustedSwitchOrigin("https://example.com", localServers)).toBe(
      false,
    );
    expect(
      isTrustedSwitchOrigin("https://getbb.app.evil.com", localServers),
    ).toBe(false);
    expect(
      isTrustedSwitchOrigin("http://192.168.1.9:38886", localServers),
    ).toBe(false);
    expect(isTrustedSwitchOrigin("not-a-url", localServers)).toBe(false);
    expect(isTrustedSwitchOrigin("", localServers)).toBe(false);
  });
});

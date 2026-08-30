import { describe, expect, it } from "vitest";
import { isConnectServerUrl } from "../src/connect-target-origin.js";

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

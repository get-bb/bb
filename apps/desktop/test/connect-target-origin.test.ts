import { describe, expect, it } from "vitest";
import {
  isBuiltinServerOrigin,
  isConnectServerUrl,
} from "../src/connect-target-origin.js";

const LOCAL_SERVERS = ["http://127.0.0.1:38886", "http://localhost:38886"];

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

describe("isBuiltinServerOrigin", () => {
  it("accepts only the local server origins", () => {
    expect(
      isBuiltinServerOrigin("http://127.0.0.1:38886/x", LOCAL_SERVERS),
    ).toBe(true);
    expect(isBuiltinServerOrigin("http://localhost:38886", LOCAL_SERVERS)).toBe(
      true,
    );
  });

  it("rejects getbb and allowlisted custom-server origins for target mutations", () => {
    expect(
      isBuiltinServerOrigin("https://sawyer.getbb.app", LOCAL_SERVERS),
    ).toBe(false);
    expect(isBuiltinServerOrigin("https://getbb.app", LOCAL_SERVERS)).toBe(
      false,
    );
    expect(
      isBuiltinServerOrigin("https://office.example.com", LOCAL_SERVERS),
    ).toBe(false);
    expect(isBuiltinServerOrigin("http://10.0.0.5:38886", LOCAL_SERVERS)).toBe(
      false,
    );
  });

  it("rejects lookalike, invalid, and empty frame URLs", () => {
    expect(
      isBuiltinServerOrigin("https://getbb.app.evil.com", LOCAL_SERVERS),
    ).toBe(false);
    expect(isBuiltinServerOrigin("not-a-url", LOCAL_SERVERS)).toBe(false);
    expect(isBuiltinServerOrigin("", LOCAL_SERVERS)).toBe(false);
  });
});

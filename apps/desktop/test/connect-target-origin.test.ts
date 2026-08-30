import { describe, expect, it } from "vitest";
import {
  isBuiltinServerOrigin,
  isConnectServerUrl,
  isTrustedSwitchOrigin,
} from "../src/connect-target-origin.js";

const LOCAL_SERVERS = ["http://127.0.0.1:38886", "http://localhost:38886"];
const CUSTOM_SERVERS = ["https://office.example.com", "http://10.0.0.5:38886"];

function switchAllowed(frameUrl: string, connectTrusted = true): boolean {
  return isTrustedSwitchOrigin({
    connectTrusted,
    frameUrl,
    trustedServerUrls: [...LOCAL_SERVERS, ...CUSTOM_SERVERS],
  });
}

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
  it("trusts the local builtin server origin", () => {
    expect(switchAllowed("http://127.0.0.1:38886/threads")).toBe(true);
    expect(switchAllowed("http://localhost:38886/")).toBe(true);
  });

  it("trusts an origin the user already added to the allowlist", () => {
    expect(switchAllowed("https://office.example.com/threads")).toBe(true);
    expect(switchAllowed("http://10.0.0.5:38886")).toBe(true);
  });

  it("trusts a getbb.app origin only while bb Connect is trusted", () => {
    expect(switchAllowed("https://sawyer.getbb.app/threads")).toBe(true);
    expect(switchAllowed("https://getbb.app")).toBe(true);
    expect(switchAllowed("https://sawyer.getbb.app/threads", false)).toBe(
      false,
    );
    expect(switchAllowed("https://getbb.app", false)).toBe(false);
  });

  it("rejects an origin that is not on the allowlist", () => {
    expect(switchAllowed("https://example.com")).toBe(false);
    expect(switchAllowed("https://getbb.app.evil.com")).toBe(false);
    expect(switchAllowed("http://192.168.1.9:38886")).toBe(false);
    expect(switchAllowed("https://office.example.com.evil.com")).toBe(false);
    expect(switchAllowed("not-a-url")).toBe(false);
    expect(switchAllowed("")).toBe(false);
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

  it("rejects every remote origin, including trusted switch targets", () => {
    expect(
      isBuiltinServerOrigin("https://sawyer.getbb.app", LOCAL_SERVERS),
    ).toBe(false);
    expect(isBuiltinServerOrigin("https://getbb.app", LOCAL_SERVERS)).toBe(
      false,
    );
    expect(
      isBuiltinServerOrigin("https://office.example.com", LOCAL_SERVERS),
    ).toBe(false);
    expect(isBuiltinServerOrigin("not-a-url", LOCAL_SERVERS)).toBe(false);
    expect(isBuiltinServerOrigin("", LOCAL_SERVERS)).toBe(false);
  });
});

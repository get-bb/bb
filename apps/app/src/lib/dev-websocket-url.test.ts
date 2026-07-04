import { afterEach, describe, expect, it } from "vitest";
import { buildDevWebSocketUrl } from "./dev-websocket-url";

const originalWindow = globalThis.window;

function setWindowLocation(url: string): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: new URL(url),
    },
  });
}

function setDevWebSocketPort(port: number | undefined): void {
  Object.defineProperty(globalThis, "__BB_DEV_WS_BROWSER_HOST_PORT__", {
    configurable: true,
    value: port,
  });
}

describe("buildDevWebSocketUrl", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Reflect.deleteProperty(globalThis, "__BB_DEV_WS_BROWSER_HOST_PORT__");
  });

  it("connects directly to the dev server port on HTTP origins", () => {
    setWindowLocation("http://jmb-1100.tail46e47a.ts.net:18565/projects");
    setDevWebSocketPort(26565);

    expect(buildDevWebSocketUrl({ path: "/ws/terminals/term_1" })).toBe(
      "ws://jmb-1100.tail46e47a.ts.net:26565/ws/terminals/term_1",
    );
  });

  it("falls back to same-origin websocket handling on HTTPS origins", () => {
    setWindowLocation("https://jmb-1100.tail46e47a.ts.net/projects");
    setDevWebSocketPort(26565);

    expect(buildDevWebSocketUrl({ path: "/ws/terminals/term_1" })).toBe(
      undefined,
    );
  });
});

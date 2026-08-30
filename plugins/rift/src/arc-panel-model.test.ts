import { describe, expect, it } from "vitest";
import {
  availableArcActions,
  createArcId,
  createCoalescedAsyncRunner,
  httpPortalHref,
} from "./arc-panel-model.js";

describe("createArcId", () => {
  it("creates a stable valid Arc ULID from explicit entropy", () => {
    expect(createArcId(0, new Uint8Array(16).fill(31))).toBe(
      "arc_0000000000ZZZZZZZZZZZZZZZZ",
    );
  });
});

describe("availableArcActions", () => {
  it("requires both the provider capability and a compatible Arc state", () => {
    expect(
      availableArcActions("ready", {
        start: true,
        pause: true,
        stop: false,
        destroy: true,
      }),
    ).toEqual({ start: false, pause: true, stop: false, destroy: true });

    expect(
      availableArcActions("stopped", {
        start: true,
        pause: true,
        stop: true,
        destroy: false,
      }),
    ).toEqual({ start: true, pause: false, stop: false, destroy: false });

    expect(
      availableArcActions("stopped", {
        start: false,
        pause: true,
        stop: true,
        destroy: true,
      }),
    ).toEqual({ start: false, pause: false, stop: false, destroy: true });
  });
});

describe("httpPortalHref", () => {
  it("allows HTTP portals and rejects other or malformed schemes", () => {
    expect(httpPortalHref("https://arc.example.test/path?q=1")).toBe(
      "https://arc.example.test/path?q=1",
    );
    expect(httpPortalHref("http://127.0.0.1:8080/")).toBe(
      "http://127.0.0.1:8080/",
    );
    expect(httpPortalHref("javascript:alert(1)")).toBeNull();
    expect(httpPortalHref("data:text/html,unsafe")).toBeNull();
    expect(httpPortalHref("not a URL")).toBeNull();
  });
});

describe("createCoalescedAsyncRunner", () => {
  it("runs one request at a time and keeps only the newest queued refresh", async () => {
    const runner = createCoalescedAsyncRunner();
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runner.run(async () => {
      calls.push("first:start");
      await firstBlocked;
      calls.push("first:end");
    });
    const replaced = runner.run(async () => {
      calls.push("replaced");
    });
    const newest = runner.run(async () => {
      calls.push("newest");
    });

    expect(calls).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, replaced, newest]);
    expect(calls).toEqual(["first:start", "first:end", "newest"]);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connectedDensityFixture } from "./elk-benchmark.js";
import { installElkWorker, runElkLayout } from "./elk-worker.js";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "./types.js";

const foundationDir = dirname(fileURLToPath(import.meta.url));
const productSecurityDir = resolve(foundationDir, "../..");

describe("WP-31 ELK foundation", () => {
  it("completes the worker protocol deterministically after progress", async () => {
    const posted: LayoutWorkerResponse[] = [];
    let complete = (
      _message: Extract<LayoutWorkerResponse, { type: "result" }>,
    ): void => undefined;
    const completion = new Promise<
      Extract<LayoutWorkerResponse, { type: "result" }>
    >((resolveCompletion) => {
      complete = resolveCompletion;
    });
    let dispatch = (_event: MessageEvent<unknown>): void => {
      throw new Error("ELK worker listener was not installed");
    };
    installElkWorker({
      addEventListener(_type, nextListener) {
        dispatch = nextListener;
      },
      postMessage(message) {
        posted.push(message);
        if (message.type === "result") complete(message);
      },
    });

    const request: LayoutWorkerRequest = {
      type: "layout",
      requestId: "stable-layout",
      request: connectedDensityFixture(30, 3),
    };
    dispatch(new MessageEvent("message", { data: request }));
    const result = await completion;

    expect(posted.at(-1)).toBe(result);
    expect(Object.keys(result.result.positions)).toHaveLength(30);
    for (const position of Object.values(result.result.positions)) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
    const uniquePositions = new Set(
      Object.values(result.result.positions).map(
        (position) => `${position.x}:${position.y}`,
      ),
    );
    expect(uniquePositions.size).toBe(30);
    expect(posted[0]).toMatchObject({ type: "progress", progress: 0.1 });
  });

  it("reports worker failure without inventing a result", async () => {
    const posted: LayoutWorkerResponse[] = [];
    let complete = (
      _message: Extract<LayoutWorkerResponse, { type: "error" }>,
    ): void => undefined;
    const completion = new Promise<
      Extract<LayoutWorkerResponse, { type: "error" }>
    >((resolveCompletion) => {
      complete = resolveCompletion;
    });
    let dispatch = (_event: MessageEvent<unknown>): void => undefined;
    installElkWorker(
      {
        addEventListener(_type, nextListener) {
          dispatch = nextListener;
        },
        postMessage(message) {
          posted.push(message);
          if (message.type === "error") complete(message);
        },
      },
      async () => {
        throw new Error("representative worker crash");
      },
    );
    dispatch(
      new MessageEvent("message", {
        data: {
          type: "layout",
          requestId: "crash-layout",
          request: connectedDensityFixture(30, 3),
        } satisfies LayoutWorkerRequest,
      }),
    );
    const error = await completion;
    expect(posted.at(-1)).toBe(error);
    expect(error).toMatchObject({
      type: "error",
      message: "representative worker crash",
    });
    expect(posted.some((message) => message.type === "result")).toBe(false);
  });

  it("cancels an opaque ELK run and discards its late result", async () => {
    const posted: LayoutWorkerResponse[] = [];
    let complete = (
      _message: Extract<LayoutWorkerResponse, { type: "cancelled" }>,
    ): void => undefined;
    const completion = new Promise<
      Extract<LayoutWorkerResponse, { type: "cancelled" }>
    >((resolveCompletion) => {
      complete = resolveCompletion;
    });
    let dispatch = (_event: MessageEvent<unknown>): void => undefined;
    let resolveLayout = (
      _result: Awaited<ReturnType<typeof runElkLayout>>,
    ): void => undefined;
    const pending = new Promise<Awaited<ReturnType<typeof runElkLayout>>>(
      (resolvePromise) => {
        resolveLayout = resolvePromise;
      },
    );
    installElkWorker(
      {
        addEventListener(_type, nextListener) {
          dispatch = nextListener;
        },
        postMessage(message) {
          posted.push(message);
          if (message.type === "cancelled") complete(message);
        },
      },
      () => pending,
    );
    const request = connectedDensityFixture(30, 3);
    dispatch(
      new MessageEvent("message", {
        data: { type: "layout", requestId: "cancel-layout", request },
      }),
    );
    dispatch(
      new MessageEvent("message", {
        data: { type: "cancel", requestId: "cancel-layout" },
      }),
    );
    await completion;
    resolveLayout({ positions: {}, durationMs: 5 });
    await Promise.resolve();
    await Promise.resolve();
    expect(posted.at(-1)?.type).toBe("cancelled");
    expect(posted.some((message) => message.type === "result")).toBe(false);
  });

  it("builds connected fixed-200 fixtures at every requested density", () => {
    for (const edgesPerNode of [3, 6, 10, 15]) {
      const fixture = connectedDensityFixture(200, edgesPerNode);
      expect(fixture.nodes).toHaveLength(200);
      expect(fixture.edges).toHaveLength(200 * edgesPerNode);
      expect(
        fixture.edges.filter(({ source }) => source === "node-0"),
      ).toHaveLength(edgesPerNode);
      expect(
        fixture.edges.every(({ source, target }) => source !== target),
      ).toBe(true);
    }
  });

  it("lays out a dense cyclic graph without relying on exact coordinates", async () => {
    const result = await runElkLayout(connectedDensityFixture(30, 15));
    expect(Object.keys(result.positions)).toHaveLength(30);
    expect(
      Object.values(result.positions).every(
        ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
      ),
    ).toBe(true);
  });
});

describe("WP-31 portability guard", () => {
  it("keeps product-security source free of forbidden platform imports and raw color", () => {
    const files = readdirSync(productSecurityDir, {
      recursive: true,
      encoding: "utf8",
    }).filter((path) => [".ts", ".tsx"].includes(extname(path)));
    const source = files
      .map((path) => readFileSync(join(productSecurityDir, path), "utf8"))
      .join("\n");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*(?:import|export)\b/u.test(line))
      .join("\n");

    expect(importLines).not.toMatch(
      /next(?:\/|-themes)|supabase|lucide|forge/iu,
    );
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|oklch\s*\(/iu);
  });
});

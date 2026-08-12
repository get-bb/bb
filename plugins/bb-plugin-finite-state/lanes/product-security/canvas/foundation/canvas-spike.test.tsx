import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { installElkWorker, runElkLayout } from "./elk-worker.js";
import { shouldAutoLayout } from "./CanvasShell.js";
import type {
  LayoutRequest,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "./types.js";

const foundationDir = dirname(fileURLToPath(import.meta.url));
const productSecurityDir = resolve(foundationDir, "../..");

export function representativeFixture(nodeCount: number): LayoutRequest {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    width: 216,
    height: 112,
  }));
  const edges: LayoutRequest["edges"] = [];

  for (let sourceIndex = 0; sourceIndex < nodeCount; sourceIndex += 1) {
    const targets = [
      (sourceIndex + 1) % nodeCount,
      (sourceIndex * 17 + 31) % nodeCount,
      (sourceIndex * 31 + 73) % nodeCount,
    ];
    for (const candidate of targets) {
      const targetIndex =
        candidate === sourceIndex ? (candidate + 1) % nodeCount : candidate;
      edges.push({
        source: `node-${sourceIndex}`,
        target: `node-${targetIndex}`,
      });
    }
  }

  return { nodes, edges, direction: "RIGHT" };
}

describe("WP-31 ELK foundation", () => {
  it("returns stable, non-overlapping positions through the worker protocol", async () => {
    const posted: LayoutWorkerResponse[] = [];
    let dispatch = (_event: MessageEvent<unknown>): void => {
      throw new Error("ELK worker listener was not installed");
    };
    installElkWorker({
      addEventListener(_type, nextListener) {
        dispatch = nextListener;
      },
      postMessage(message) {
        posted.push(message);
      },
    });

    const request: LayoutWorkerRequest = {
      type: "layout",
      requestId: "stable-layout",
      request: representativeFixture(30),
    };
    dispatch(new MessageEvent("message", { data: request }));
    await vi.waitFor(() => expect(posted.at(-1)?.type).toBe("result"));

    const result = posted.find(
      (message): message is Extract<LayoutWorkerResponse, { type: "result" }> =>
        message.type === "result",
    );
    expect(Object.keys(result?.result.positions ?? {})).toHaveLength(30);
    for (const position of Object.values(result?.result.positions ?? {})) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
    const uniquePositions = new Set(
      Object.values(result?.result.positions ?? {}).map(
        (position) => `${position.x}:${position.y}`,
      ),
    );
    expect(uniquePositions.size).toBe(30);
    expect(posted[0]).toMatchObject({ type: "progress", progress: 0.1 });
  });

  it("reports worker failure without inventing a result", async () => {
    const posted: LayoutWorkerResponse[] = [];
    let dispatch = (_event: MessageEvent<unknown>): void => undefined;
    installElkWorker(
      {
        addEventListener(_type, nextListener) {
          dispatch = nextListener;
        },
        postMessage(message) {
          posted.push(message);
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
          request: representativeFixture(30),
        } satisfies LayoutWorkerRequest,
      }),
    );
    await vi.waitFor(() => expect(posted.at(-1)?.type).toBe("error"));
    expect(posted.at(-1)).toMatchObject({
      type: "error",
      message: "representative worker crash",
    });
    expect(posted.some((message) => message.type === "result")).toBe(false);
  });

  it("cancels an opaque ELK run and discards its late result", async () => {
    const posted: LayoutWorkerResponse[] = [];
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
        },
      },
      () => pending,
    );
    const request = representativeFixture(30);
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
    resolveLayout({ positions: {}, durationMs: 5 });
    await vi.waitFor(() => expect(posted.at(-1)?.type).toBe("cancelled"));
    expect(posted.some((message) => message.type === "result")).toBe(false);
  });

  it(
    "keeps the representative 200-node crossing graph inside the layout budget",
    { retry: 2 },
    async () => {
      const fixture = representativeFixture(200);
      expect(fixture.edges).toHaveLength(600);
      const result = await runElkLayout(fixture);
      expect(Object.keys(result.positions)).toHaveLength(200);
      expect(result.durationMs).toBeLessThan(2_000);
    },
  );

  it("never opts 500 nodes into automatic layout", () => {
    expect(shouldAutoLayout(200)).toBe(true);
    expect(shouldAutoLayout(201)).toBe(false);
    expect(shouldAutoLayout(500)).toBe(false);
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

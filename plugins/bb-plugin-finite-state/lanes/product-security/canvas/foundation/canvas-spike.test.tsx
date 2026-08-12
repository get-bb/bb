import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { rpcContract } from "../../../../shared/contract.js";
import { installElkWorker, runElkLayout } from "./elk-worker.js";
import type {
  LayoutRequest,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "./types.js";

const foundationDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(foundationDir, "../../../..");
const repositoryRoot = resolve(pluginRoot, "../..");

function chainFixture(nodeCount: number): LayoutRequest {
  return {
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `node-${index}`,
      width: 216,
      height: 112,
    })),
    edges: Array.from({ length: Math.max(0, nodeCount - 1) }, (_, index) => ({
      source: `node-${index}`,
      target: `node-${index + 1}`,
    })),
    direction: "RIGHT",
  };
}

describe("WP-31 ELK spike", () => {
  it("returns stable positions through the worker protocol", async () => {
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
      request: chainFixture(3),
    };
    dispatch(new MessageEvent("message", { data: request }));
    await vi.waitFor(() => {
      expect(posted.at(-1)?.type).toBe("result");
    });

    const first = posted.find(
      (message): message is Extract<LayoutWorkerResponse, { type: "result" }> =>
        message.type === "result",
    );
    expect(first?.result.positions).toEqual({
      "node-0": { x: 12, y: 12 },
      "node-1": { x: 300, y: 12 },
      "node-2": { x: 588, y: 12 },
    });
    expect(posted.map((message) => message.type)).toEqual([
      "progress",
      "progress",
      "result",
    ]);
  });

  it("lays out the 200-node gate fixture within two seconds", async () => {
    const result = await runElkLayout(chainFixture(200));
    expect(Object.keys(result.positions)).toHaveLength(200);
    expect(result.durationMs).toBeLessThan(2_000);
  });
});

describe("WP-31 reproducible gate blockers", () => {
  it("proves the frozen taraList input loses kind and filters from its inferred type", () => {
    type TaraListInput = z.input<(typeof rpcContract)["taraList"]["input"]>;
    const inferredHasKind: "kind" extends keyof TaraListInput ? true : false =
      false;
    const inferredHasFilters: "filters" extends keyof TaraListInput
      ? true
      : false = false;

    const parsed = rpcContract.taraList.input.parse({
      projectId: "project-1",
      projectVersionId: null,
      kind: "component",
      filters: {},
      pageSize: 200,
      continuation: null,
    });

    expect(parsed).toMatchObject({ kind: "component", filters: {} });
    expect({ inferredHasKind, inferredHasFilters }).toEqual({
      inferredHasKind: false,
      inferredHasFilters: false,
    });
  });

  it("proves the required shared UI is not a direct plugin dependency", () => {
    const manifest = JSON.parse(
      readFileSync(join(pluginRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.["@bb/shared-ui"]).toBeUndefined();
  });

  it("proves the plugin app build cannot emit a lazy TARA chunk or worker asset", () => {
    const buildSource = readFileSync(
      join(repositoryRoot, "packages/plugin-build/src/build-plugin-app.ts"),
      "utf8",
    );

    expect(buildSource).toContain("single ESM file");
    expect(buildSource).toContain("outfile: stagedJsPath");
    expect(buildSource).not.toMatch(/\bsplitting:\s*true\b/u);
    expect(buildSource).not.toMatch(/\bchunkNames\s*:/u);
  });
});

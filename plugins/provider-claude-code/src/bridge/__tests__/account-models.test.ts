import http from "node:http";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { addAccountModels } from "../model-list.js";

const cliModels: ModelInfo[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default",
    description: "Opus 5.5",
  },
  {
    value: "claude-fable-5-1[1m]",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    description: "Fable 5.1",
  },
];

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

async function serveModels(
  respond: (url: URL) => { status: number; body?: unknown },
): Promise<{ url: string; requests: Array<{ url: string; auth?: string }> }> {
  const requests: Array<{ url: string; auth?: string }> = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://hub.test");
    requests.push({
      url: `${url.pathname}${url.search}`,
      ...(request.headers.authorization === undefined
        ? {}
        : { auth: request.headers.authorization }),
    });
    const { status, body } = respond(url);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake hub did not bind a TCP port.");
  }
  closers.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return {
    url: `http://127.0.0.1:${address.port}/hub/claude/v1/models`,
    requests,
  };
}

function apiModel(id: string, efforts: Record<string, boolean> = {}) {
  return {
    id,
    display_name: id,
    capabilities: {
      effort: Object.fromEntries(
        Object.entries(efforts).map(([level, supported]) => [
          level,
          { supported },
        ]),
      ),
    },
  };
}

describe("addAccountModels", () => {
  it("adds every page of the pooled accounts' models the CLI did not list", async () => {
    const hub = await serveModels((url) =>
      url.searchParams.get("after_id") === null
        ? {
            status: 200,
            body: {
              data: [
                apiModel("claude-fable-5-2", { high: true, xhigh: true }),
                apiModel("claude-opus-5-5", { high: true }),
              ],
              has_more: true,
              last_id: "claude-opus-5-5",
            },
          }
        : {
            status: 200,
            body: {
              data: [apiModel("claude-fable-5-1"), apiModel("claude-haiku-4")],
              has_more: false,
              last_id: "claude-haiku-4",
            },
          },
    );

    const models = await addAccountModels(cliModels, {
      BB_CLAUDE_MODELS_URL: hub.url,
      ANTHROPIC_AUTH_TOKEN: "hub-token",
    });

    expect(models.map((model) => model.value)).toEqual([
      "default",
      "claude-fable-5-1[1m]",
      "claude-fable-5-2",
      "claude-haiku-4",
    ]);
    expect(models[2]?.supportedEffortLevels).toEqual(["high", "xhigh"]);
    expect(hub.requests).toEqual([
      {
        url: "/hub/claude/v1/models?limit=1000",
        auth: "Bearer hub-token",
      },
      {
        url: "/hub/claude/v1/models?limit=1000&after_id=claude-opus-5-5",
        auth: "Bearer hub-token",
      },
    ]);
  });

  it("keeps the CLI list when the hub has no Claude model route", async () => {
    const hub = await serveModels(() => ({ status: 404 }));

    await expect(
      addAccountModels(cliModels, {
        BB_CLAUDE_MODELS_URL: hub.url,
        ANTHROPIC_AUTH_TOKEN: "hub-token",
      }),
    ).resolves.toEqual(cliModels);
  });

  it("fails instead of publishing a partial list when the hub errors", async () => {
    const hub = await serveModels(() => ({ status: 503 }));

    await expect(
      addAccountModels(cliModels, {
        BB_CLAUDE_MODELS_URL: hub.url,
        ANTHROPIC_AUTH_TOKEN: "hub-token",
      }),
    ).rejects.toThrow("HTTP 503");
  });
});

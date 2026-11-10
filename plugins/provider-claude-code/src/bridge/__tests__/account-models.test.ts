import http from "node:http";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { buildClaudeCodeModels } from "../../model-list.js";
import { listAccountModels, preferAccountModels } from "../model-list.js";

const cliModels: ModelInfo[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default (recommended)",
    description: "Opus 5.5",
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    description: "For complex work and everyday tasks",
  },
  {
    value: "claude-fable-5-1[1m]",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    description: "Fable 5.1",
  },
  {
    value: "claude-retired-4[1m]",
    resolvedModel: "claude-retired-4",
    displayName: "Retired",
    description: "Retired 4",
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

function apiModel(id: string, efforts: string[] = []) {
  return {
    id,
    display_name: id,
    capabilities: {
      effort: Object.fromEntries(
        ["low", "medium", "high", "xhigh", "max"].map((level) => [
          level,
          { supported: efforts.includes(level) },
        ]),
      ),
    },
  };
}

function pooledEnv(url: string): NodeJS.ProcessEnv {
  return { BB_CLAUDE_MODELS_URL: url, ANTHROPIC_AUTH_TOKEN: "hub-token" };
}

describe("pooled Claude account models", () => {
  it("lists the accounts' models newest first, default first, and keeps Claude Code's aliases", async () => {
    const hub = await serveModels((url) =>
      url.searchParams.get("after_id") === null
        ? {
            status: 200,
            body: {
              data: [
                apiModel("claude-fable-5-2", ["high", "xhigh"]),
                apiModel("claude-opus-5-5", ["high"]),
              ],
              has_more: true,
              last_id: "claude-opus-5-5",
            },
          }
        : {
            status: 200,
            body: {
              data: [apiModel("claude-fable-5-1", ["low"])],
              has_more: false,
              last_id: "claude-fable-5-1",
            },
          },
    );

    const accountModels = await listAccountModels(pooledEnv(hub.url));
    if (accountModels === null) throw new Error("Expected account models");
    const { models, selectedOnlyModels } = buildClaudeCodeModels(
      preferAccountModels(cliModels, accountModels),
    );

    expect(
      models.map((model) => [model.model, model.isDefault, model.description]),
    ).toEqual([
      ["claude-opus-5-5", true, "For complex work and everyday tasks"],
      ["claude-fable-5-2", false, "claude-fable-5-2"],
      ["claude-fable-5-1", false, "Fable 5.1"],
    ]);
    expect(
      models[1]?.supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      ),
    ).toEqual(["high", "xhigh", "ultracode"]);
    expect(selectedOnlyModels.map((model) => model.model)).toEqual([
      "opus",
      "claude-fable-5-1[1m]",
    ]);
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

  it("leaves Claude Code's list in place when the hub has no Claude model route", async () => {
    const hub = await serveModels(() => ({ status: 404 }));

    await expect(listAccountModels(pooledEnv(hub.url))).resolves.toBeNull();
  });

  it.each([
    { status: 503, body: {}, message: "HTTP 503" },
    {
      status: 200,
      body: { data: [], has_more: false, last_id: null },
      message: "returned no models",
    },
  ])(
    "fails instead of publishing a partial list on $message",
    async ({ status, body, message }) => {
      const hub = await serveModels(() => ({ status, body }));

      await expect(listAccountModels(pooledEnv(hub.url))).rejects.toThrow(
        message,
      );
    },
  );
});

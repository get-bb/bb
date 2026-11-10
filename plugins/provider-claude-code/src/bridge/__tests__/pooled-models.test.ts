import { afterEach, describe, expect, it, vi } from "vitest";
import { listClaudeCodeBridgeModels } from "../model-list.js";

vi.mock("../initialization-probe.js", () => ({
  probeClaudeInitialization: async () => ({
    models: [
      {
        value: "default",
        resolvedModel: "claude-opus-5-5",
        displayName: "Default",
        description: "Default",
      },
      {
        value: "claude-opus-5-5",
        displayName: "Opus",
        description: "Opus",
        supportedEffortLevels: ["low", "high"],
      },
      { value: "claude-fable-5-1", displayName: "Fable", description: "Fable" },
    ],
  }),
}));

const env = {
  BB_CLAUDE_MODEL_CATALOG_URL: "http://pool.example/claude/v1/models",
  ANTHROPIC_AUTH_TOKEN: "hub-token",
};
const model = {
  id: "claude-fable-5-2",
  display_name: "Claude Fable 5.2",
  capabilities: {
    effort: {
      low: { supported: true },
      high: { supported: true },
      max: { supported: true },
    },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("pooled Claude discovery", () => {
  it("adds a newly served model and its efforts to the stale CLI catalog without changing the default", async () => {
    const request = vi.fn(async () =>
      Response.json({ data: [model], has_more: false, last_id: model.id }),
    );
    vi.stubGlobal("fetch", request);
    const result = await listClaudeCodeBridgeModels(env);
    expect(
      result.models.find((entry) => entry.model === model.id),
    ).toMatchObject({
      displayName: "Fable 5.2",
      isDefault: false,
      supportedReasoningEfforts: [
        { reasoningEffort: "low" },
        { reasoningEffort: "high" },
        { reasoningEffort: "max" },
      ],
    });
    expect(
      result.models
        .filter((entry) => entry.isDefault)
        .map((entry) => entry.model),
    ).toEqual(["claude-opus-5-5"]);
    expect(request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({ authorization: "Bearer hub-token" }),
      }),
    );
  });

  it("follows pagination and deduplicates models already reported by the CLI", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ ...model, id: "claude-opus-5-5" }],
          has_more: true,
          last_id: "claude-opus-5-5",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [model], has_more: false, last_id: model.id }),
      );
    vi.stubGlobal("fetch", request);
    const result = await listClaudeCodeBridgeModels(env);
    expect(result.models.map((entry) => entry.model)).toEqual([
      "claude-opus-5-5",
      "claude-fable-5-1",
      model.id,
    ]);
    expect(request.mock.calls[1]?.[0].searchParams.get("after_id")).toBe(
      "claude-opus-5-5",
    );
  });

  it.each(["unauthorized", "malformed", "unreachable", "repeated-cursor"])(
    "retains CLI models when the pooled catalog is %s",
    async (failure) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (failure === "unreachable") throw new Error("unreachable");
          if (failure === "unauthorized")
            return new Response(null, { status: 401 });
          if (failure === "malformed") return Response.json({ data: "bad" });
          return Response.json({
            data: [model],
            has_more: true,
            last_id: model.id,
          });
        }),
      );
      const result = await listClaudeCodeBridgeModels(env);
      expect(result.models.map((entry) => entry.model)).toEqual([
        "claude-opus-5-5",
        "claude-fable-5-1",
      ]);
    },
  );

  it("does not fetch a catalog for an unpooled session", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await listClaudeCodeBridgeModels({});
    expect(request).not.toHaveBeenCalled();
  });
});

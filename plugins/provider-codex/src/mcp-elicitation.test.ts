import { expect, it } from "vitest";
import {
  decodeCodexInteractiveRequest,
  buildCodexInteractiveResponse,
} from "./interactive-requests.js";

const params = {
  threadId: "codex-thread",
  serverName: "travel",
  mode: "form",
  message: "Choose a destination",
  requestedSchema: {
    type: "object",
    properties: {
      city: { type: "string", enum: ["Paris", "Tokyo"] },
      count: { type: "integer", minimum: 1, maximum: 4 },
      confirmed: { type: "boolean" },
    },
    required: ["city", "count", "confirmed"],
  },
};

it.each([
  { city: "Paris", count: 2, confirmed: false },
  { city: "Tokyo", count: 4, confirmed: true },
])("preserves typed accepted content %j", (content) => {
  const request = decodeCodexInteractiveRequest({
    id: 1,
    method: "mcpServer/elicitation/request",
    params,
  });
  expect(request).not.toBeNull();
  expect(
    buildCodexInteractiveResponse({
      payload: request!.payload,
      resolution: {
        kind: "request_answer",
        value: { action: "accept", content },
      },
    } as never),
  ).toEqual({ action: "accept", content, _meta: null });
});

it.each([
  { city: "Berlin", count: 2, confirmed: true },
  { city: "Paris", count: 0, confirmed: true },
  { city: "Paris", count: 1.5, confirmed: true },
  { city: "Paris", count: "2", confirmed: true },
  { city: "Paris", count: 2 },
  { city: "Paris", count: 2, confirmed: true, extra: "hidden" },
])("rejects invalid accepted content %j", (content) => {
  const request = decodeCodexInteractiveRequest({
    id: 1,
    method: "mcpServer/elicitation/request",
    params,
  });
  expect(request).not.toBeNull();
  expect(() =>
    buildCodexInteractiveResponse({
      payload: request!.payload,
      resolution: {
        kind: "request_answer",
        value: { action: "accept", content },
      },
    } as never),
  ).toThrow();
});

it.each([
  { ...params, mode: "url", url: "https://example.com", elicitationId: "x" },
  { ...params, mode: "openai/userVerification" },
  {
    ...params,
    requestedSchema: {
      type: "object",
      properties: { secret: { type: "object" } },
    },
  },
  { ...params, requestedSchema: { ...params.requestedSchema, allOf: [] } },
  {
    ...params,
    requestedSchema: { type: "object", properties: {}, required: ["missing"] },
  },
])("explicitly rejects unsupported elicitation %j", (input) => {
  expect(() =>
    decodeCodexInteractiveRequest({
      id: 1,
      method: "mcpServer/elicitation/request",
      params: input,
    }),
  ).toThrow(/unsupported|invalid/i);
});

it.each(["always", undefined, "forever"])(
  "rejects an unoffered persistence scope %s",
  (persist) => {
    const request = decodeCodexInteractiveRequest({
      id: 1,
      method: "mcpServer/elicitation/request",
      params: { ...params, _meta: { persist: ["session"] } },
    });
    expect(() =>
      buildCodexInteractiveResponse({
        payload: request!.payload,
        resolution: {
          kind: "request_answer",
          value: {
            action: "accept",
            content: { city: "Paris", count: 2, confirmed: false },
            persist,
          },
        },
      } as never),
    ).toThrow();
  },
);
it("keeps provider thread identity and a missing turn correlation", () => {
  expect(
    decodeCodexInteractiveRequest({
      id: 7,
      method: "mcpServer/elicitation/request",
      params,
    }),
  ).toMatchObject({
    requestId: 7,
    providerThreadId: "codex-thread",
    turnId: null,
  });
});

it("rejects a prototype property instead of silently dropping it", () => {
  expect(() =>
    decodeCodexInteractiveRequest({
      id: 1,
      method: "mcpServer/elicitation/request",
      params: {
        ...params,
        requestedSchema: {
          type: "object",
          properties: { ["__proto__"]: { type: "boolean" } },
        },
      },
    }),
  ).toThrow(/unsupported/i);
});

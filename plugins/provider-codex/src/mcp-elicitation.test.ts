import { describe, expect, it } from "vitest";
import {
  ProviderRequestDecodeError,
  ProviderResponseEncodeError,
  type JsonValue,
  type ProviderInteractionOutcome,
} from "@get-bb/plugin-sdk/provider-bridge";
import computerUseElicitation from "./fixtures/computer-use-elicitation.json";
import computerUseActiveTurnElicitation from "./fixtures/computer-use-active-turn-elicitation.json";
import {
  buildCodexInteractiveResponse,
  decodeCodexInteractiveRequest,
} from "./interactive-requests.js";
import {
  CODEX_MCP_ELICITATION_KIND,
  normalizeCodexMcpElicitation,
  buildCodexMcpElicitationResponse,
  type CodexComputerUsePermission,
} from "./mcp-elicitation.js";

const capturedParams = computerUseElicitation.params;
const permission: CodexComputerUsePermission = {
  kind: "computer_use",
  serverName: "cua_repl",
  app: { id: "com.apple.calculator", name: "Calculator", iconDataUrl: null },
  message: capturedParams.message,
  scopes: ["session", "always"],
  warning: null,
  riskLevel: "low",
};

function outcome(
  value: JsonValue,
  scopes: CodexComputerUsePermission["scopes"] = permission.scopes,
): Extract<
  ProviderInteractionOutcome,
  { resolution: { kind: "request_answer" } }
> {
  return {
    payload: {
      kind: CODEX_MCP_ELICITATION_KIND,
      title: permission.message,
      data: { ...permission, scopes },
    },
    resolution: { kind: "request_answer", value },
  };
}

describe("Computer Use elicitation decoding", () => {
  it("decodes captured active-turn metadata without passing it to the permission UI", () => {
    expect(
      decodeCodexInteractiveRequest(computerUseActiveTurnElicitation),
    ).toEqual({
      requestId: computerUseActiveTurnElicitation.id,
      method: computerUseActiveTurnElicitation.method,
      providerThreadId: computerUseActiveTurnElicitation.params.threadId,
      turnId: computerUseActiveTurnElicitation.params.turnId,
      payload: {
        kind: CODEX_MCP_ELICITATION_KIND,
        title: permission.message,
        data: permission,
      },
    });
  });

  it("strips additive transport metadata without changing the permission", () => {
    expect(
      decodeCodexInteractiveRequest({
        ...computerUseElicitation,
        params: {
          ...capturedParams,
          _meta: {
            ...capturedParams._meta,
            "transport/request-id": "transport-request-1",
          },
        },
      }),
    ).toEqual(decodeCodexInteractiveRequest(computerUseElicitation));
  });

  it("preserves native warnings and the offered scope during an active turn", () => {
    expect(
      decodeCodexInteractiveRequest({
        ...computerUseElicitation,
        params: {
          ...capturedParams,
          turnId: "turn-app-permission",
          _meta: {
            ...capturedParams._meta,
            persist: ["session"],
            riskLevel: "high",
            subtitle: "This app can change system settings.",
            tool_call_id: "call-app-permission",
          },
        },
      }),
    ).toMatchObject({
      turnId: "turn-app-permission",
      payload: {
        data: {
          ...permission,
          scopes: ["session"],
          warning: "This app can change system settings.",
          riskLevel: "high",
        },
      },
    });
  });

  it.each([
    ["URL mode", { ...capturedParams, mode: "url" }],
    ["OpenAI form mode", { ...capturedParams, mode: "openai/form" }],
    [
      "a form containing fields",
      {
        ...capturedParams,
        requestedSchema: {
          type: "object",
          properties: { confirmation: { type: "boolean" } },
        },
      },
    ],
    [
      "unrecognized form requirements",
      {
        ...capturedParams,
        requestedSchema: {
          ...capturedParams.requestedSchema,
          required: ["confirmation"],
        },
      },
    ],
    [
      "a different connector",
      {
        ...capturedParams,
        _meta: { ...capturedParams._meta, connector_id: "other-connector" },
      },
    ],
    [
      "an unknown permission scope",
      {
        ...capturedParams,
        _meta: { ...capturedParams._meta, persist: ["global"] },
      },
    ],
    [
      "no permission scopes",
      {
        ...capturedParams,
        _meta: { ...capturedParams._meta, persist: [] },
      },
    ],
    [
      "duplicate permission scopes",
      {
        ...capturedParams,
        _meta: { ...capturedParams._meta, persist: ["session", "session"] },
      },
    ],
    [
      "missing app identity",
      {
        ...capturedParams,
        _meta: { ...capturedParams._meta, tool_params: {} },
      },
    ],
    [
      "an empty app identity",
      {
        ...capturedParams,
        _meta: { ...capturedParams._meta, tool_params: { app: " " } },
      },
    ],
    [
      "missing app presentation",
      {
        ...capturedParams,
        _meta: { ...capturedParams._meta, tool_params_display: [] },
      },
    ],
    [
      "a different approval kind",
      {
        ...capturedParams,
        _meta: {
          ...capturedParams._meta,
          codex_approval_kind: "sensitive_action",
        },
      },
    ],
  ])(
    "keeps %s unsupported instead of allowing generic form acceptance",
    (_name, params) => {
      const decoded = normalizeCodexMcpElicitation(params);
      expect(decoded.elicitation.kind).toBe("unsupported");
      expect(() =>
        buildCodexMcpElicitationResponse(decoded.elicitation, {
          action: "accept",
          content: {},
        }),
      ).toThrow(/only be declined or cancelled/);
      expect(
        buildCodexMcpElicitationResponse(decoded.elicitation, {
          action: "cancel",
        }),
      ).toEqual({ action: "cancel", content: null, _meta: null });
    },
  );

  it("rejects an invalid request envelope before creating an interaction", () => {
    expect(() =>
      decodeCodexInteractiveRequest({
        ...computerUseElicitation,
        params: { ...capturedParams, turnId: undefined },
      }),
    ).toThrowError(ProviderRequestDecodeError);
  });

  it("recognizes Computer Use through connector identity on another server", () => {
    expect(
      normalizeCodexMcpElicitation({
        ...capturedParams,
        serverName: "native-computer",
      }).elicitation,
    ).toEqual({ ...permission, serverName: "native-computer" });
  });
});

describe("Computer Use elicitation responses", () => {
  it.each(["session", "always"])(
    "encodes the offered %s scope in native response metadata",
    (persist) => {
      expect(
        buildCodexInteractiveResponse(outcome({ action: "accept", persist })),
      ).toEqual({ action: "accept", content: {}, _meta: { persist } });
    },
  );

  it.each(["decline", "cancel"])(
    "encodes %s without form content or persistence metadata",
    (action) => {
      expect(buildCodexInteractiveResponse(outcome({ action }))).toEqual({
        action,
        content: null,
        _meta: null,
      });
    },
  );

  it("rejects remembered permission when the native request only offers session", () => {
    expect(() =>
      buildCodexInteractiveResponse(
        outcome({ action: "accept", persist: "always" }, ["session"]),
      ),
    ).toThrowError(/did not offer the requested scope: always/);
  });

  const malformedResponses: JsonValue[] = [
    null,
    { action: "accept" },
    { action: "accept", persist: "global" },
    { action: "accept", persist: "session", app: "com.apple.Terminal" },
    { action: "decline", persist: "always" },
    { action: "cancel", persist: "session" },
    { action: "approve", persist: "session" },
  ];
  it.each(malformedResponses)("rejects malformed response %j", (value) => {
    expect(() => buildCodexInteractiveResponse(outcome(value))).toThrowError(
      ProviderResponseEncodeError,
    );
  });

  it("rejects outcomes from another extension", () => {
    const args = outcome({ action: "accept", persist: "always" });
    expect(() =>
      buildCodexInteractiveResponse({
        ...args,
        payload: {
          kind: "provider-codex/other-interaction",
          title: permission.message,
          data: permission,
        },
      }),
    ).toThrowError(ProviderResponseEncodeError);
  });
});

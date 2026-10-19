import { describe, expect, it } from "vitest";
import {
  ProviderRequestDecodeError,
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
  ProviderResponseEncodeError,
  type JsonValue,
  type ProviderInteractionOutcome,
} from "@get-bb/plugin-sdk/provider-bridge";
import computerUseElicitation from "./fixtures/computer-use-elicitation.json";
import computerUseActiveTurnElicitation from "./fixtures/computer-use-active-turn-elicitation.json";
import mcpToolApprovalElicitation from "./fixtures/mcp-tool-approval-elicitation.json";
import spoofedComputerUseElicitation from "./fixtures/spoofed-computer-use-elicitation.json";
import {
  buildCodexInteractiveResponse,
  decodeCodexInteractiveRequest,
} from "./interactive-requests.js";
import {
  CODEX_MCP_ELICITATION_KIND,
  normalizeCodexMcpElicitation,
  buildCodexMcpElicitationResponse,
  type CodexComputerUsePermission,
  type CodexMcpToolApproval,
} from "./mcp-elicitation.js";
import { codexMcpElicitationTitle } from "./mcp-elicitation-title.js";

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

const toolApproval: CodexMcpToolApproval = {
  kind: "tool_approval",
  serverName: "elicit_e2e",
  message: mcpToolApprovalElicitation.params.message,
  toolName: null,
  toolDescription: "Delete a widget by id. Destructive.",
  params: [
    { name: "force", label: "force", value: "true" },
    { name: "widget_id", label: "widget_id", value: "w-42" },
  ],
  omittedParamCount: 0,
  scopes: ["session", "always"],
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
        title: `Allow Codex to use ${permission.app.name}?`,
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

  it.each([
    ["another server", { ...capturedParams, serverName: "native-computer" }],
    [
      "the captured spoof from a third-party server",
      spoofedComputerUseElicitation.params,
    ],
    [
      "the Computer Use server without the Computer Use connector",
      {
        ...capturedParams,
        _meta: { ...capturedParams._meta, connector_id: "other-connector" },
      },
    ],
  ])(
    "shows Computer Use metadata from %s as a plain tool approval",
    (_name, params) => {
      const { elicitation } = normalizeCodexMcpElicitation(params);
      expect(elicitation).toMatchObject({
        kind: "tool_approval",
        serverName: params.serverName,
        toolName: "get_app_state",
        scopes: ["session", "always"],
      });
      expect(codexMcpElicitationTitle(elicitation)).toBe(params.message);
    },
  );
});

describe("MCP tool-call approval decoding", () => {
  it("decodes the approval Codex sends before an MCP tool call", () => {
    expect(decodeCodexInteractiveRequest(mcpToolApprovalElicitation)).toEqual({
      requestId: 0,
      method: "mcpServer/elicitation/request",
      providerThreadId: mcpToolApprovalElicitation.params.threadId,
      turnId: mcpToolApprovalElicitation.params.turnId,
      payload: {
        kind: CODEX_MCP_ELICITATION_KIND,
        title: mcpToolApprovalElicitation.params.message,
        data: toolApproval,
      },
    });
  });

  it("offers no remembered scope when Codex offers none", () => {
    const { persist: _persist, ...meta } =
      mcpToolApprovalElicitation.params._meta;
    expect(
      normalizeCodexMcpElicitation({
        ...mcpToolApprovalElicitation.params,
        _meta: meta,
      }).elicitation,
    ).toMatchObject({ kind: "tool_approval", scopes: [] });
  });

  it("drops scopes BB cannot encode", () => {
    expect(
      normalizeCodexMcpElicitation({
        ...mcpToolApprovalElicitation.params,
        _meta: {
          ...mcpToolApprovalElicitation.params._meta,
          persist: ["forever", "session", "session"],
        },
      }).elicitation,
    ).toMatchObject({ kind: "tool_approval", scopes: ["session"] });
  });

  it("falls back to raw tool params and bounds long or numerous values", () => {
    const toolParams = Object.fromEntries(
      Array.from({ length: 52 }, (_, index) => [
        `arg_${index}`,
        index === 0 ? "x".repeat(3000) : { nested: [index] },
      ]),
    );
    const { elicitation } = normalizeCodexMcpElicitation({
      ...mcpToolApprovalElicitation.params,
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        tool_title: "Bulk update",
        tool_params: toolParams,
      },
    });
    if (elicitation.kind !== "tool_approval")
      throw new Error("Expected a tool approval");
    expect(elicitation.toolName).toBe("Bulk update");
    expect(elicitation.toolDescription).toBeNull();
    expect(elicitation.params).toHaveLength(50);
    expect(elicitation.omittedParamCount).toBe(2);
    expect(elicitation.params[0]?.value).toHaveLength(2000);
    expect(elicitation.params[0]?.value.endsWith("…")).toBe(true);
    expect(elicitation.params[1]).toEqual({
      name: "arg_1",
      label: "arg_1",
      value: '{"nested":[1]}',
    });
  });

  it("keeps the shown arguments within a byte budget the interaction limit allows", () => {
    const { elicitation } = normalizeCodexMcpElicitation({
      ...mcpToolApprovalElicitation.params,
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        tool_params: Object.fromEntries(
          Array.from({ length: 40 }, (_, index) => [
            `arg_${index}`,
            "界".repeat(3000),
          ]),
        ),
      },
    });
    if (elicitation.kind !== "tool_approval")
      throw new Error("Expected a tool approval");
    expect(elicitation.params.length).toBeGreaterThan(0);
    expect(elicitation.params.length + elicitation.omittedParamCount).toBe(40);
    expect(
      new TextEncoder().encode(JSON.stringify(elicitation)).length,
    ).toBeLessThanOrEqual(32 * 1024 + 1024);
  });

  it("keeps an approval-tagged form with fields as a normal form", () => {
    expect(
      normalizeCodexMcpElicitation({
        ...mcpToolApprovalElicitation.params,
        requestedSchema: {
          type: "object",
          properties: { reason: { type: "string" } },
        },
      }).elicitation,
    ).toMatchObject({ kind: "form" });
  });

  it.each([
    [{ action: "accept" }, { action: "accept", content: {}, _meta: null }],
    [
      { action: "accept", persist: "session" },
      { action: "accept", content: {}, _meta: { persist: "session" } },
    ],
    [
      { action: "accept", persist: "always" },
      { action: "accept", content: {}, _meta: { persist: "always" } },
    ],
    [{ action: "decline" }, { action: "decline", content: null, _meta: null }],
  ] as const)("encodes %j for Codex", (response, native) => {
    expect(buildCodexMcpElicitationResponse(toolApproval, response)).toEqual(
      native,
    );
  });

  it.each([
    [{ action: "accept", persist: "always" }, /did not offer/],
    [{ action: "accept", content: {} }, /does not include form values/],
  ] as const)("rejects %j", (response, message) => {
    expect(() =>
      buildCodexMcpElicitationResponse(
        { ...toolApproval, scopes: ["session"] },
        response,
      ),
    ).toThrowError(message);
  });
});

describe("MCP elicitation titles", () => {
  it("bounds titles to the interaction limit without splitting surrogate pairs", () => {
    const message = `${"a".repeat(PLUGIN_INTERACTION_MAX_TITLE_LENGTH - 2)}😀😀 tail`;
    const title = codexMcpElicitationTitle({
      kind: "form",
      serverName: "emoji",
      message,
      fields: [],
    });
    expect(title.length).toBeLessThanOrEqual(
      PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
    );
    expect(title).toBe(
      `${"a".repeat(PLUGIN_INTERACTION_MAX_TITLE_LENGTH - 2)}…`,
    );
  });

  it("keeps a title that fits", () => {
    expect(
      codexMcpElicitationTitle({
        kind: "form",
        serverName: "short",
        message: "Pick one 😀",
        fields: [],
      }),
    ).toBe("Pick one 😀");
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

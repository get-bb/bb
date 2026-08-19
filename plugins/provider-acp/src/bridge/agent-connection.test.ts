import { describe, expect, it } from "vitest";
import { formatAgentError } from "./agent-connection.js";

describe("formatAgentError", () => {
  it("appends error.data.details to the generic JSON-RPC message", () => {
    expect(
      formatAgentError({
        code: -32603,
        message: "Internal error",
        data: { details: "bb-bridge: Transport closed" },
      }),
    ).toBe("Internal error: bb-bridge: Transport closed");
  });

  it("keeps the message alone when there is no usable data", () => {
    expect(formatAgentError({ message: "Internal error" })).toBe(
      "Internal error",
    );
    expect(formatAgentError({ message: "Internal error", data: "  " })).toBe(
      "Internal error",
    );
    expect(formatAgentError({ code: -32600 })).toBe(
      "ACP agent returned error code -32600",
    );
  });

  it("serializes structured data without a details string", () => {
    expect(
      formatAgentError({ message: "Invalid params", data: { field: "cwd" } }),
    ).toBe('Invalid params: {"field":"cwd"}');
  });
});
